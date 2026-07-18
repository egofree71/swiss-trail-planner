/**
 * Business context: owns worker-side swissTLM3D routing state. It loads bounded
 * cells, keeps raw geometries and derived graphs inside the dedicated worker,
 * and performs graph construction, snapping, and A* without blocking the map UI.
 */
import type { Coordinate } from 'ol/coordinate.js';
import {
  NoWalkableNetworkError,
  RoutingNetwork,
  type RoutedNetworkPath,
} from './networkRouter';
import {
  combinedExtent,
  createCorridorCellKeys,
  createLocalCellKeys,
  extentForCellKey,
  type CellKey,
} from './routingGrid';
import {
  RoutingAreaTooLargeError,
  type DiagnosedDynamicRoutingResult,
  type DynamicRoutingCacheStats,
  type DynamicRoutingPhaseTimings,
} from './dynamicRoutingProtocol';
import {
  fetchSwissTlmNetworkData,
  type SwissTlmLineFeature,
  type SwissTlmNetworkData,
} from './swissTlmApi';

/** Corridor radius in cells for the first route attempt. */
const ROUTE_CELL_RADIUS = 1;
/** Wider corridor radius in cells used only when the first graph is disconnected. */
const ROUTE_RETRY_CELL_RADIUS = 2;
/**
 * Safety limit per snap/route operation. It prevents very long segments from
 * triggering excessive API traffic and memory use.
 */
const MAX_CELLS_PER_OPERATION = 80;
/** Number of combined RoutingNetwork instances retained in the session LRU cache. */
const NETWORK_CACHE_LIMIT = 8;
/** Number of cells loaded concurrently inside the worker. */
const CELL_LOAD_CONCURRENCY = 2;

/** Completed cell retained in worker memory for the current page session. */
interface LoadedCell {
  /** Deduplicated swissTLM3D road and hiking features for this cell. */
  data: SwissTlmNetworkData;
}

/** Cached graph built for one exact set of cell keys. */
interface CachedNetwork {
  /** Sorted cell-key signature used for exact cache lookup. */
  key: string;
  /** Immutable graph built from those cells. */
  network: RoutingNetwork;
}

/** In-flight cell request shared by concurrent consumers. */
interface PendingCell {
  /** Promise resolving to the completed cell. */
  promise: Promise<LoadedCell>;
  /** Signal that owns the request, used to reject reuse after cancellation. */
  signal: AbortSignal;
}

/** Creates an empty accumulator so retry phases can be added consistently. */
function createRoutingPhaseTimings(): DynamicRoutingPhaseTimings {
  return {
    graphCacheLookupDurationMs: 0,
    rawCellAccessDurationMs: 0,
    featureMergeDurationMs: 0,
    graphBuildDurationMs: 0,
    startSnapDurationMs: 0,
    endSnapDurationMs: 0,
    aStarDurationMs: 0,
    routeReconstructionDurationMs: 0,
    graphCacheHits: 0,
    graphCacheMisses: 0,
    routeAttempts: 0,
    retryUsed: false,
  };
}

/** Maps cells with a bounded worker pool to protect the public API and browser. */
async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

/**
 * Merges cell features by stable ID because geometries crossing cell boundaries
 * may be returned by several identify requests.
 */
function mergeFeatures(
  cells: LoadedCell[],
  selector: (data: SwissTlmNetworkData) => SwissTlmLineFeature[],
): SwissTlmLineFeature[] {
  const features = new Map<string, SwissTlmLineFeature>();

  for (const cell of cells) {
    for (const feature of selector(cell.data)) {
      features.set(feature.id, feature);
    }
  }

  return [...features.values()];
}

/**
 * Session-scoped dynamic loader for swissTLM3D routing graphs.
 *
 * Completed cells remain cached for the page lifetime. Each route segment first
 * uses a narrow corridor and retries once with a wider corridor when the graph
 * is disconnected. Combined graphs are cached by their exact cell set.
 */
export class DynamicRoutingNetworkEngine {
  /** Raw feature cells already completed during this page session. */
  private readonly loadedCells = new Map<CellKey, LoadedCell>();
  /** In-flight cell requests shared to avoid duplicate GeoAdmin traffic. */
  private readonly pendingCells = new Map<CellKey, PendingCell>();
  /** Small most-recent-first cache of graphs for exact corridor cell sets. */
  private readonly networkCache: CachedNetwork[] = [];

  /**
   * Clears only derived corridor graphs while preserving downloaded raw cells.
   * This is useful for deterministic diagnostics that must measure graph
   * reconstruction without repeating GeoAdmin traffic.
   */
  clearNetworkCache(): void {
    this.networkCache.length = 0;
  }

  /** Returns current session cache sizes without exposing mutable cache entries. */
  getCacheStats(): DynamicRoutingCacheStats {
    return {
      loadedCells: this.loadedCells.size,
      pendingCells: this.pendingCells.size,
      cachedNetworks: this.networkCache.length,
    };
  }

  /**
   * Loads a neighbourhood around a point and snaps it to the local network.
   * @param coordinate - User-selected coordinate in EPSG:2056.
   * @param signal - Abort signal owned by the route-creation session.
   * @returns The snapped coordinate, or `null` when coverage is empty or no segment is close enough.
   * @throws {RoutingAreaTooLargeError} If the generated neighbourhood exceeds the safety limit.
   * @throws {Error} When GeoAdmin loading or graph construction fails.
   */
  async snap(
    coordinate: Coordinate,
    signal: AbortSignal,
  ): Promise<Coordinate | null> {
    const cellKeys = createLocalCellKeys(coordinate);

    try {
      const network = await this.getNetwork(cellKeys, signal);
      return network.snap(coordinate);
    } catch (error) {
      // Empty cells are expected outside swissTLM3D coverage. Returning null
      // lets the editor place the point freely instead of treating it as an
      // API failure.
      if (error instanceof NoWalkableNetworkError) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Routes between two waypoints using an on-demand corridor of swissTLM3D cells.
   * @param startCoordinate - Existing route endpoint in EPSG:2056.
   * @param endCoordinate - Newly selected destination in EPSG:2056.
   * @param signal - Abort signal owned by the route-creation session.
   * @returns A routed path, or `null` when both corridor widths lack usable coverage or connectivity.
   * @throws {RoutingAreaTooLargeError} If either corridor exceeds the safety limit.
   * @throws {Error} When GeoAdmin loading or graph construction fails.
   */
  async route(
    startCoordinate: Coordinate,
    endCoordinate: Coordinate,
    signal: AbortSignal,
  ): Promise<RoutedNetworkPath | null> {
    return this.routeInternal(startCoordinate, endCoordinate, signal);
  }

  /**
   * Routes one section while exposing CPU phase timings to the local benchmark.
   * The normal application deliberately calls `route()` and pays no diagnostic
   * clock-reading overhead.
   */
  async routeWithDiagnostics(
    startCoordinate: Coordinate,
    endCoordinate: Coordinate,
    signal: AbortSignal,
  ): Promise<DiagnosedDynamicRoutingResult> {
    const timings = createRoutingPhaseTimings();
    const path = await this.routeInternal(
      startCoordinate,
      endCoordinate,
      signal,
      timings,
    );
    return { path, timings };
  }

  /** Executes the shared narrow-corridor and optional wider-retry workflow. */
  private async routeInternal(
    startCoordinate: Coordinate,
    endCoordinate: Coordinate,
    signal: AbortSignal,
    timings?: DynamicRoutingPhaseTimings,
  ): Promise<RoutedNetworkPath | null> {
    const initialCellKeys = createCorridorCellKeys(
      startCoordinate,
      endCoordinate,
      ROUTE_CELL_RADIUS,
    );
    let initialPath: RoutedNetworkPath | null = null;

    if (timings) {
      timings.routeAttempts += 1;
    }

    try {
      const initialNetwork = await this.getNetwork(
        initialCellKeys,
        signal,
        timings,
      );

      initialPath = initialNetwork.route(
        startCoordinate,
        endCoordinate,
        timings,
      );
    } catch (error) {
      // A narrow corridor can be entirely outside swissTLM3D coverage. The
      // wider retry may still reach a usable network near a national border.
      if (!(error instanceof NoWalkableNetworkError)) {
        throw error;
      }
    }

    if (initialPath) {
      return initialPath;
    }

    // A wider retry allows realistic detours around barriers without paying
    // that loading cost for every segment.
    if (timings) {
      timings.retryUsed = true;
    }

    const retryCellKeys = createCorridorCellKeys(
      startCoordinate,
      endCoordinate,
      ROUTE_RETRY_CELL_RADIUS,
    );

    if (timings) {
      timings.routeAttempts += 1;
    }

    try {
      const retryNetwork = await this.getNetwork(
        retryCellKeys,
        signal,
        timings,
      );

      return retryNetwork.route(startCoordinate, endCoordinate, timings);
    } catch (error) {
      // No walkable data after both attempts is a normal coverage miss. The
      // route editor can preserve continuity with a straight fallback segment.
      if (error instanceof NoWalkableNetworkError) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Returns a graph for one exact set of cells, loading and merging missing data.
   * @throws {RoutingAreaTooLargeError} When the set exceeds the per-operation cell limit.
   */
  private async getNetwork(
    cellKeys: Set<CellKey>,
    signal: AbortSignal,
    timings?: DynamicRoutingPhaseTimings,
  ): Promise<RoutingNetwork> {
    if (cellKeys.size > MAX_CELLS_PER_OPERATION) {
      throw new RoutingAreaTooLargeError();
    }

    // Sorting makes the cache key independent of insertion order.
    const cacheLookupStartedAt = timings ? performance.now() : 0;
    const cacheKey = [...cellKeys].sort().join('|');
    const cachedNetwork = this.networkCache.find(
      (entry) => entry.key === cacheKey,
    );

    if (timings) {
      timings.graphCacheLookupDurationMs +=
        performance.now() - cacheLookupStartedAt;
    }

    if (cachedNetwork) {
      if (timings) {
        timings.graphCacheHits += 1;
      }

      return cachedNetwork.network;
    }

    if (timings) {
      timings.graphCacheMisses += 1;
    }

    const rawCellAccessStartedAt = timings ? performance.now() : 0;
    const cells = await mapWithConcurrency(
      [...cellKeys],
      CELL_LOAD_CONCURRENCY,
      (key) => this.loadCell(key, signal),
    );

    if (timings) {
      timings.rawCellAccessDurationMs +=
        performance.now() - rawCellAccessStartedAt;
    }

    const featureMergeStartedAt = timings ? performance.now() : 0;
    const data: SwissTlmNetworkData = {
      roads: mergeFeatures(cells, (cellData) => cellData.roads),
      hikingTrails: mergeFeatures(
        cells,
        (cellData) => cellData.hikingTrails,
      ),
    };

    if (timings) {
      timings.featureMergeDurationMs +=
        performance.now() - featureMergeStartedAt;
    }

    const graphBuildStartedAt = timings ? performance.now() : 0;
    let network: RoutingNetwork;

    try {
      network = RoutingNetwork.fromSwissTlm(combinedExtent(cellKeys), data);
    } finally {
      // Empty coverage throws from graph construction but still represents CPU
      // work that matters for border and disconnected benchmark scenarios.
      if (timings) {
        timings.graphBuildDurationMs += performance.now() - graphBuildStartedAt;
      }
    }

    // Most-recently-built graphs stay at the front. This small cache avoids
    // rebuilding common local corridors.
    this.networkCache.unshift({ key: cacheKey, network });

    if (this.networkCache.length > NETWORK_CACHE_LIMIT) {
      this.networkCache.pop();
    }

    return network;
  }

  /**
   * Returns a completed cell or shares an active request for the same key.
   * Aborted requests are removed so a later route operation can retry cleanly.
   */
  private loadCell(
    key: CellKey,
    signal: AbortSignal,
  ): Promise<LoadedCell> {
    const loadedCell = this.loadedCells.get(key);

    if (loadedCell) {
      return Promise.resolve(loadedCell);
    }

    // Sharing a live promise prevents duplicate API traffic when neighbouring graph builds overlap.
    const pendingCell = this.pendingCells.get(key);

    if (pendingCell && !pendingCell.signal.aborted) {
      return pendingCell.promise;
    }

    if (pendingCell) {
      this.pendingCells.delete(key);
    }

    const extent = extentForCellKey(key);
    let promise: Promise<LoadedCell>;

    promise = fetchSwissTlmNetworkData(extent, signal, {
      allowEmpty: true,
    })
      .then((data): LoadedCell => {
        const cell = { data };
        this.loadedCells.set(key, cell);
        return cell;
      })
      .finally(() => {
        // Only the promise currently registered for this key may clear the pending entry.
        if (this.pendingCells.get(key)?.promise === promise) {
          this.pendingCells.delete(key);
        }
      });

    this.pendingCells.set(key, { promise, signal });
    return promise;
  }
}

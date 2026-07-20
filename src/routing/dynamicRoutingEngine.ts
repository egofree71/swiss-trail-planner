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
import { RoutingAreaTooLargeError } from './dynamicRoutingProtocol';
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

/** Session callbacks emitted by the worker-owned routing engine. */
export interface DynamicRoutingNetworkEngineOptions {
  /**
   * Initial provider choice. Defaults to `true`; local development may start in
   * roads-only mode to exercise the fallback without a real provider failure.
   */
  initialHikingEnrichmentEnabled?: boolean;
  /** Called once when optional hiking enrichment is disabled for the session. */
  onHikingEnrichmentUnavailable?: () => void;
}

/**
 * Maps cells with a bounded worker pool to protect the public API and browser.
 * @param values - Ordered inputs to process.
 * @param concurrency - Maximum number of active mapper promises.
 * @param mapper - Asynchronous operation applied once to each input.
 * @returns Results in the same order as the input values.
 * @throws {Error} Propagates the first mapper rejection.
 */
async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

/**
 * Merges cell features by stable ID because geometries crossing cell boundaries
 * may be returned by several identify requests.
 * @param cells - Completed raw cells contributing features.
 * @param selector - Chooses roads or hiking geometries from one cell.
 * @returns Deduplicated features in stable insertion order.
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
   * Whether new cells should still request the optional hiking layer. Once a
   * layer-specific rejection occurs, roads alone are used for the remaining
   * worker session so every new waypoint does not repeat the same failure.
   */
  private hikingEnrichmentEnabled: boolean;
  /** Session callbacks and initial provider policy. */
  private readonly options: DynamicRoutingNetworkEngineOptions;
  /** Prevents repeated UI notices after roads-only mode has been reported. */
  private hikingEnrichmentUnavailableReported = false;

  constructor(options: DynamicRoutingNetworkEngineOptions = {}) {
    this.options = options;
    this.hikingEnrichmentEnabled =
      options.initialHikingEnrichmentEnabled ?? true;
  }

  /** Reports roads-only mode after a routing request has started. */
  private reportHikingEnrichmentUnavailable(): void {
    if (this.hikingEnrichmentUnavailableReported) {
      return;
    }

    this.hikingEnrichmentUnavailableReported = true;
    this.options.onHikingEnrichmentUnavailable?.();
  }

  /** Disables optional hiking requests and reports the transition only once. */
  private disableHikingEnrichment(): void {
    if (!this.hikingEnrichmentEnabled) {
      return;
    }

    this.hikingEnrichmentEnabled = false;
    this.reportHikingEnrichmentUnavailable();
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
    if (!this.hikingEnrichmentEnabled) {
      // Emitting after the first operation arrives avoids losing the local-test
      // notice while the Worker module is still starting up.
      this.reportHikingEnrichmentUnavailable();
    }

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
    if (!this.hikingEnrichmentEnabled) {
      // A route request can be the first Worker operation after local startup.
      this.reportHikingEnrichmentUnavailable();
    }

    return this.routeInternal(startCoordinate, endCoordinate, signal);
  }

  /**
   * Executes the shared narrow-corridor and optional wider-retry workflow.
   * @param startCoordinate - Existing route endpoint in EPSG:2056.
   * @param endCoordinate - Newly selected destination in EPSG:2056.
   * @param signal - Abort signal owned by the caller.
   * @returns Routed path, or `null` after normal coverage/connectivity misses.
   * @throws {RoutingAreaTooLargeError} If either corridor exceeds the safety limit.
   * @throws {Error} When provider loading or graph construction fails.
   */
  private async routeInternal(
    startCoordinate: Coordinate,
    endCoordinate: Coordinate,
    signal: AbortSignal,
  ): Promise<RoutedNetworkPath | null> {
    const initialCellKeys = createCorridorCellKeys(
      startCoordinate,
      endCoordinate,
      ROUTE_CELL_RADIUS,
    );
    let initialPath: RoutedNetworkPath | null = null;

    try {
      const initialNetwork = await this.getNetwork(
        initialCellKeys,
        signal,
      );

      initialPath = initialNetwork.route(startCoordinate, endCoordinate);
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

    const retryCellKeys = createCorridorCellKeys(
      startCoordinate,
      endCoordinate,
      ROUTE_RETRY_CELL_RADIUS,
    );

    try {
      const retryNetwork = await this.getNetwork(
        retryCellKeys,
        signal,
      );

      return retryNetwork.route(startCoordinate, endCoordinate);
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
   * @param cellKeys - Exact corridor cells required by this routing attempt.
   * @param signal - Abort signal shared by cell requests.
   * @returns Cached or newly built immutable routing graph.
   * @throws {RoutingAreaTooLargeError} When the set exceeds the per-operation cell limit.
   * @throws {Error} When cell loading or graph construction fails.
   */
  private async getNetwork(
    cellKeys: Set<CellKey>,
    signal: AbortSignal,
  ): Promise<RoutingNetwork> {
    if (cellKeys.size > MAX_CELLS_PER_OPERATION) {
      throw new RoutingAreaTooLargeError();
    }

    // Sorting makes the cache key independent of insertion order.
    const cacheKey = [...cellKeys].sort().join('|');
    const cachedNetworkIndex = this.networkCache.findIndex(
      (entry) => entry.key === cacheKey,
    );
    const cachedNetwork = this.networkCache[cachedNetworkIndex];

    if (cachedNetwork) {

      // Promote a reused graph so the bounded cache evicts the least-recently
      // used corridor rather than the oldest corridor regardless of access.
      if (cachedNetworkIndex > 0) {
        this.networkCache.splice(cachedNetworkIndex, 1);
        this.networkCache.unshift(cachedNetwork);
      }

      return cachedNetwork.network;
    }

    const cells = await mapWithConcurrency(
      [...cellKeys],
      CELL_LOAD_CONCURRENCY,
      (key) => this.loadCell(key, signal),
    );

    const data: SwissTlmNetworkData = {
      roads: mergeFeatures(cells, (cellData) => cellData.roads),
      hikingTrails: mergeFeatures(
        cells,
        (cellData) => cellData.hikingTrails,
      ),
    };

    const network = RoutingNetwork.fromSwissTlm(combinedExtent(cellKeys), data);

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
   * @param key - Stable routing-cell identifier.
   * @param signal - Abort signal that owns a newly created provider request.
   * @returns Completed cell or the shared in-flight promise.
   * @throws {Error} Propagates GeoAdmin request and parsing failures.
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
      shouldRequestHikingEnrichment: () =>
        this.hikingEnrichmentEnabled,
      onHikingEnrichmentUnavailable: () =>
        this.disableHikingEnrichment(),
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

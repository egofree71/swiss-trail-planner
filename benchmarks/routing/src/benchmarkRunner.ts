/**
 * Business context: replays synthetic route clicks against the real dynamic
 * swissTLM3D worker. A warm-up pass downloads every cell the scenario needs;
 * the measured pass then keeps raw cells in worker memory, records worker-side
 * graph phases, and measures end-to-end latency plus main-thread responsiveness.
 */
import type { Coordinate } from 'ol/coordinate.js';
import {
  DynamicRoutingNetworkLoader,
  type DynamicRoutingPhaseTimings,
} from '../../../src/routing/dynamicRoutingNetwork';
import { connectRoutedSegmentEndpoint, createStraightRouteStep } from '../../../src/routing/routeEditing';
import type { RouteStep } from '../../../src/map/routeState';
import type { RoutingBenchmarkScenario } from './gpxScenario';

/** Graph-cache policy used during the measured worker pass. */
export type GraphCacheMode =
  | 'session-cache'
  | 'rebuild-each-segment';

/** Progress notification displayed by the local benchmark page. */
export interface BenchmarkProgress {
  /** Current pass: data preparation or measured replay. */
  phase: 'warmup' | 'measure';
  /** One-based section number currently being processed. */
  current: number;
  /** Total number of sections in the selected scenario. */
  total: number;
}

/** One segment input resolved during warm-up. */
interface WarmedSegment {
  /** Actual snapped start used by the live routing sequence. */
  startCoordinate: Coordinate;
  /** Synthetic GPX-derived click that ends this section. */
  clickedCoordinate: Coordinate;
  /** Straight LV95 distance between the routed start and the synthetic click. */
  directDistanceMeters: number;
  /** Whether the warm-up resolved a network path instead of a straight fallback. */
  warmupFoundPath: boolean;
  /** Number of raw cells added while preparing this section. */
  newCellsLoaded: number;
}

/** Measured result for one synthetic click after the first waypoint. */
export interface RoutingSegmentBenchmarkResult {
  /** One-based section number in scenario order. */
  segmentIndex: number;
  /** Straight LV95 distance between the section endpoints. */
  directDistanceMeters: number;
  /** Worker time spent deriving and searching the exact graph-cache key. */
  graphCacheLookupDurationMs: number;
  /** Worker time spent resolving raw cells already prepared by warm-up. */
  rawCellAccessDurationMs: number;
  /** Worker time spent deduplicating features shared by neighbouring cells. */
  featureMergeDurationMs: number;
  /** Worker time spent building graph nodes, edges, and spatial indexes. */
  graphBuildDurationMs: number;
  /** Worker time spent snapping the section start to the graph. */
  startSnapDurationMs: number;
  /** Worker time spent snapping the section destination to the graph. */
  endSnapDurationMs: number;
  /** Worker time spent in A* after both endpoints are snapped. */
  aStarDurationMs: number;
  /** Worker time spent rebuilding the ordered route coordinate array. */
  routeReconstructionDurationMs: number;
  /** End-to-end routing time not covered by explicit worker phase clocks. */
  routingOverheadDurationMs: number;
  /** Main-thread elapsed time from request dispatch to worker response. */
  routeDurationMs: number;
  /** Delay of an animation frame requested immediately before routing. */
  frameDelayMs: number;
  /** Main-thread time spent creating the immutable RouteStep snapshot. */
  stateCommitDurationMs: number;
  /** Number of exact graph-cache hits used by this section. */
  graphCacheHits: number;
  /** Number of exact graph-cache misses used by this section. */
  graphCacheMisses: number;
  /** Number of narrow and optional wider corridor attempts. */
  routeAttempts: number;
  /** Whether the wider fallback corridor was required. */
  retryUsed: boolean;
  /** Whether the routing engine returned a network path. */
  foundPath: boolean;
  /** Number of coordinates returned, or two for the simulated straight fallback. */
  outputCoordinateCount: number;
  /** Number of derived graphs retained after this section. */
  networkCacheEntriesAfter: number;
  /** Cells unexpectedly loaded during the measured pass. */
  unexpectedNewCells: number;
  /** Cells loaded for this section during the preparation pass. */
  warmupNewCells: number;
  /** Longest main-thread task overlapping this request, when supported. */
  longTaskDurationMs: number | null;
}

/** Aggregated measured CPU phases across every route section. */
export interface RoutingBenchmarkPhaseTotals {
  /** Sum of exact graph-cache lookup time in the worker. */
  graphCacheLookupDurationMs: number;
  /** Sum of raw-cell access time in the worker. */
  rawCellAccessDurationMs: number;
  /** Sum of feature merge and deduplication time in the worker. */
  featureMergeDurationMs: number;
  /** Sum of graph construction time in the worker. */
  graphBuildDurationMs: number;
  /** Sum of start-endpoint snapping time in the worker. */
  startSnapDurationMs: number;
  /** Sum of destination-endpoint snapping time in the worker. */
  endSnapDurationMs: number;
  /** Sum of A* search time in the worker. */
  aStarDurationMs: number;
  /** Sum of route-coordinate reconstruction time in the worker. */
  routeReconstructionDurationMs: number;
  /** Sum of unclassified end-to-end routing overhead. */
  routingOverheadDurationMs: number;
  /** Total exact graph-cache hits. */
  graphCacheHits: number;
  /** Total exact graph-cache misses. */
  graphCacheMisses: number;
  /** Total narrow and wider corridor attempts. */
  routeAttempts: number;
  /** Number of sections that required the wider corridor. */
  retryCount: number;
}

/** Complete benchmark report for one GPX-derived scenario. */
export interface RoutingBenchmarkReport {
  /** Execution boundary used for network loading and routing CPU work. */
  executionMode: 'dedicated-worker';
  /** GPX-derived synthetic clicks replayed by this benchmark. */
  scenario: RoutingBenchmarkScenario;
  /** Graph-cache policy applied during the measured pass. */
  graphCacheMode: GraphCacheMode;
  /** Complete preparation-pass duration, including network and routing work. */
  warmupDurationMs: number;
  /** Raw cells retained after the preparation pass. */
  warmupLoadedCells: number;
  /** Whether the first synthetic click found a nearby swissTLM3D segment. */
  firstWaypointSnapped: boolean;
  /** Detailed result for every route section. */
  segments: RoutingSegmentBenchmarkResult[];
  /** Aggregated worker phases and cache counters. */
  phaseTotals: RoutingBenchmarkPhaseTotals;
  /** Sum of end-to-end measured route durations. */
  totalRouteDurationMs: number;
  /** Slowest end-to-end route request. */
  maximumRouteDurationMs: number;
  /** Largest animation-frame delay observed on the UI thread. */
  maximumFrameDelayMs: number;
  /** Whether this browser exposes the main-thread Long Tasks API. */
  longTaskApiSupported: boolean;
  /** Largest overlapping long task, or `null` when none was observed. */
  maximumLongTaskDurationMs: number | null;
  /** Total cells loaded during measurement, which should remain zero. */
  unexpectedNetworkCellLoads: number;
}

/** Returns horizontal LV95 distance in metres. */
function coordinateDistance(first: Coordinate, second: Coordinate): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

/**
 * Returns the phases explicitly timed inside the dynamic routing pipeline.
 * @param timings - Worker-side phase accumulator for one section.
 * @returns Sum used to isolate scheduling and structured-clone overhead.
 */
function measuredPhaseDuration(timings: DynamicRoutingPhaseTimings): number {
  return (
    timings.graphCacheLookupDurationMs +
    timings.rawCellAccessDurationMs +
    timings.featureMergeDurationMs +
    timings.graphBuildDurationMs +
    timings.startSnapDurationMs +
    timings.endSnapDurationMs +
    timings.aStarDurationMs +
    timings.routeReconstructionDurationMs
  );
}

/**
 * Adds every segment's timings to report-level comparison totals.
 * @param segments - Measured route sections in scenario order.
 * @returns Aggregate phase durations and cache counters.
 */
function aggregatePhaseTotals(
  segments: RoutingSegmentBenchmarkResult[],
): RoutingBenchmarkPhaseTotals {
  return segments.reduce<RoutingBenchmarkPhaseTotals>(
    (totals, segment) => ({
      graphCacheLookupDurationMs:
        totals.graphCacheLookupDurationMs + segment.graphCacheLookupDurationMs,
      rawCellAccessDurationMs:
        totals.rawCellAccessDurationMs + segment.rawCellAccessDurationMs,
      featureMergeDurationMs:
        totals.featureMergeDurationMs + segment.featureMergeDurationMs,
      graphBuildDurationMs:
        totals.graphBuildDurationMs + segment.graphBuildDurationMs,
      startSnapDurationMs:
        totals.startSnapDurationMs + segment.startSnapDurationMs,
      endSnapDurationMs:
        totals.endSnapDurationMs + segment.endSnapDurationMs,
      aStarDurationMs: totals.aStarDurationMs + segment.aStarDurationMs,
      routeReconstructionDurationMs:
        totals.routeReconstructionDurationMs +
        segment.routeReconstructionDurationMs,
      routingOverheadDurationMs:
        totals.routingOverheadDurationMs + segment.routingOverheadDurationMs,
      graphCacheHits: totals.graphCacheHits + segment.graphCacheHits,
      graphCacheMisses: totals.graphCacheMisses + segment.graphCacheMisses,
      routeAttempts: totals.routeAttempts + segment.routeAttempts,
      retryCount: totals.retryCount + (segment.retryUsed ? 1 : 0),
    }),
    {
      graphCacheLookupDurationMs: 0,
      rawCellAccessDurationMs: 0,
      featureMergeDurationMs: 0,
      graphBuildDurationMs: 0,
      startSnapDurationMs: 0,
      endSnapDurationMs: 0,
      aStarDurationMs: 0,
      routeReconstructionDurationMs: 0,
      routingOverheadDurationMs: 0,
      graphCacheHits: 0,
      graphCacheMisses: 0,
      routeAttempts: 0,
      retryCount: 0,
    },
  );
}

/** Waits for one animation frame so the delay can reveal main-thread blocking. */
function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * Starts a long-task observer when the browser exposes that diagnostics API.
 * @returns Observer state and a cleanup callback; unsupported browsers return an inert result.
 */
function observeLongTasks(): {
  supported: boolean;
  entries: PerformanceEntry[];
  disconnect: () => void;
} {
  const entries: PerformanceEntry[] = [];

  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes.includes('longtask')
  ) {
    return { supported: false, entries, disconnect: () => undefined };
  }

  const observer = new PerformanceObserver((list) => {
    entries.push(...list.getEntries());
  });
  observer.observe({ entryTypes: ['longtask'] });

  return {
    supported: true,
    entries,
    disconnect: () => observer.disconnect(),
  };
}

/**
 * Finds the longest observed task overlapping one measured route operation.
 * @param entries - Long-task entries collected on the main thread.
 * @param startTime - Route request start in the Performance timeline.
 * @param endTime - Route response time in the Performance timeline.
 * @returns Longest overlapping duration, or `null` when none was observed.
 */
function maximumOverlappingLongTask(
  entries: PerformanceEntry[],
  startTime: number,
  endTime: number,
): number | null {
  const durations = entries
    .filter(
      (entry) =>
        entry.startTime < endTime && entry.startTime + entry.duration > startTime,
    )
    .map((entry) => entry.duration);

  return durations.length > 0 ? Math.max(...durations) : null;
}

/**
 * Warms the raw-cell cache by replaying the same route sequence once.
 * Resolved network endpoints are retained because each later live click starts
 * from the previous snapped waypoint, not from the original GPX sample.
 * @param loader - Session-scoped worker facade whose raw cells must be prepared.
 * @param scenario - Deterministic synthetic clicks to replay.
 * @param signal - Cancellation signal shared with the benchmark run.
 * @param onProgress - Optional UI progress callback.
 * @returns Snapped first point and section inputs resolved by the warm-up pass.
 * @throws {Error} Propagates loading, routing, and cancellation failures.
 */
async function warmScenario(
  loader: DynamicRoutingNetworkLoader,
  scenario: RoutingBenchmarkScenario,
  signal: AbortSignal,
  onProgress?: (progress: BenchmarkProgress) => void,
): Promise<{
  firstWaypoint: Coordinate;
  firstWaypointSnapped: boolean;
  segments: WarmedSegment[];
}> {
  const [firstClick, ...remainingClicks] = scenario.waypointsLv95;
  const snappedFirst = await loader.snap(firstClick, signal);
  let currentCoordinate = snappedFirst ?? [...firstClick];
  const segments: WarmedSegment[] = [];

  for (let index = 0; index < remainingClicks.length; index += 1) {
    onProgress?.({
      phase: 'warmup',
      current: index + 1,
      total: remainingClicks.length,
    });
    const clickedCoordinate = remainingClicks[index];
    const before = await loader.getCacheStats();
    const routedPath = await loader.route(
      currentCoordinate,
      clickedCoordinate,
      signal,
    );
    const after = await loader.getCacheStats();

    segments.push({
      startCoordinate: [...currentCoordinate],
      clickedCoordinate: [...clickedCoordinate],
      directDistanceMeters: coordinateDistance(
        currentCoordinate,
        clickedCoordinate,
      ),
      warmupFoundPath: Boolean(routedPath),
      newCellsLoaded: Math.max(0, after.loadedCells - before.loadedCells),
    });

    currentCoordinate = routedPath
      ? [...routedPath.coordinates[routedPath.coordinates.length - 1]]
      : [...clickedCoordinate];
  }

  return {
    firstWaypoint: [...(snappedFirst ?? firstClick)],
    firstWaypointSnapped: Boolean(snappedFirst),
    segments,
  };
}

/**
 * Simulates the immutable route-step work performed after one routing result.
 * @param steps - Previously committed route steps.
 * @param routedCoordinates - Worker result, or `null` for a straight fallback.
 * @param clickedCoordinate - Synthetic destination selected by the scenario.
 * @returns A new route-step array matching the editable-route update pattern.
 */
function commitMeasuredStep(
  steps: RouteStep[],
  routedCoordinates: Coordinate[] | null,
  clickedCoordinate: Coordinate,
): RouteStep[] {
  const previousStep = steps[steps.length - 1];
  let step: RouteStep;

  if (!routedCoordinates || routedCoordinates.length < 2) {
    step = createStraightRouteStep(previousStep, clickedCoordinate);
  } else {
    const segment = routedCoordinates.map((coordinate): Coordinate => [
      ...coordinate,
    ]);
    connectRoutedSegmentEndpoint(segment, previousStep.waypoint, 'start');
    step = {
      waypoint: [...segment[segment.length - 1]],
      segment,
      mode: 'network',
    };
  }

  return [...steps, step];
}

/**
 * Runs a worker-focused benchmark with network data already present in memory.
 * @param scenario - GPX-derived synthetic clicks to prepare and replay.
 * @param graphCacheMode - Cache policy applied only during the measured pass.
 * @param signal - Cancellation signal for worker and benchmark operations.
 * @param onProgress - Optional UI progress callback.
 * @returns Complete per-section and aggregate performance report.
 * @throws {Error} Propagates GPX routing, loading, parsing, and cancellation failures.
 */
export async function runRoutingBenchmark(
  scenario: RoutingBenchmarkScenario,
  graphCacheMode: GraphCacheMode,
  signal: AbortSignal,
  onProgress?: (progress: BenchmarkProgress) => void,
): Promise<RoutingBenchmarkReport> {
  if (scenario.waypointsLv95.length < 2) {
    throw new Error('A benchmark scenario needs at least two synthetic clicks.');
  }

  const loader = new DynamicRoutingNetworkLoader();

  try {
    const warmupStart = performance.now();
    const warmed = await warmScenario(loader, scenario, signal, onProgress);
    const warmupDurationMs = performance.now() - warmupStart;
    const warmupLoadedCells = (await loader.getCacheStats()).loadedCells;

    // The measured pass intentionally keeps raw cells but discards derived graphs.
    await loader.clearNetworkCache();
    let routeSteps: RouteStep[] = [
      {
        waypoint: [...warmed.firstWaypoint],
        segment: null,
        mode: warmed.firstWaypointSnapped ? 'network' : 'straight',
      },
    ];
    const longTasks = observeLongTasks();
    const results: RoutingSegmentBenchmarkResult[] = [];
    const measurementWindows: Array<{ startTime: number; endTime: number }> = [];

    try {
      for (let index = 0; index < warmed.segments.length; index += 1) {
        onProgress?.({
          phase: 'measure',
          current: index + 1,
          total: warmed.segments.length,
        });

        if (graphCacheMode === 'rebuild-each-segment') {
          await loader.clearNetworkCache();
        }

        const segment = warmed.segments[index];
        const before = await loader.getCacheStats();
        await nextAnimationFrame();
        const frameRequestTime = performance.now();
        const framePromise = nextAnimationFrame();
        const routeStart = performance.now();
        const diagnosedRoute = await loader.routeWithDiagnostics(
          segment.startCoordinate,
          segment.clickedCoordinate,
          signal,
        );
        const routeEnd = performance.now();
        const routedPath = diagnosedRoute.path;
        const routingOverheadDurationMs = Math.max(
          0,
          routeEnd - routeStart - measuredPhaseDuration(diagnosedRoute.timings),
        );
        const nextFrameTime = await framePromise;
        const commitStart = performance.now();
        routeSteps = commitMeasuredStep(
          routeSteps,
          routedPath?.coordinates ?? null,
          segment.clickedCoordinate,
        );
        const stateCommitDurationMs = performance.now() - commitStart;
        const after = await loader.getCacheStats();

        results.push({
          segmentIndex: index + 1,
          directDistanceMeters: segment.directDistanceMeters,
          graphCacheLookupDurationMs:
            diagnosedRoute.timings.graphCacheLookupDurationMs,
          rawCellAccessDurationMs: diagnosedRoute.timings.rawCellAccessDurationMs,
          featureMergeDurationMs: diagnosedRoute.timings.featureMergeDurationMs,
          graphBuildDurationMs: diagnosedRoute.timings.graphBuildDurationMs,
          startSnapDurationMs: diagnosedRoute.timings.startSnapDurationMs,
          endSnapDurationMs: diagnosedRoute.timings.endSnapDurationMs,
          aStarDurationMs: diagnosedRoute.timings.aStarDurationMs,
          routeReconstructionDurationMs:
            diagnosedRoute.timings.routeReconstructionDurationMs,
          routingOverheadDurationMs,
          routeDurationMs: routeEnd - routeStart,
          frameDelayMs: Math.max(0, nextFrameTime - frameRequestTime),
          stateCommitDurationMs,
          graphCacheHits: diagnosedRoute.timings.graphCacheHits,
          graphCacheMisses: diagnosedRoute.timings.graphCacheMisses,
          routeAttempts: diagnosedRoute.timings.routeAttempts,
          retryUsed: diagnosedRoute.timings.retryUsed,
          foundPath: Boolean(routedPath),
          outputCoordinateCount: routedPath?.coordinates.length ?? 2,
          networkCacheEntriesAfter: after.cachedNetworks,
          unexpectedNewCells: Math.max(0, after.loadedCells - before.loadedCells),
          warmupNewCells: segment.newCellsLoaded,
          longTaskDurationMs: null,
        });
        measurementWindows.push({ startTime: routeStart, endTime: routeEnd });
      }

      // PerformanceObserver delivery is asynchronous; one task boundary makes
      // completed long-task entries available before they are assigned to rows.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

      for (let index = 0; index < results.length; index += 1) {
        const window = measurementWindows[index];
        results[index].longTaskDurationMs = maximumOverlappingLongTask(
          longTasks.entries,
          window.startTime,
          window.endTime,
        );
      }
    } finally {
      longTasks.disconnect();
    }

    const routeDurations = results.map((result) => result.routeDurationMs);
    const frameDelays = results.map((result) => result.frameDelayMs);
    const observedLongTasks = results
      .map((result) => result.longTaskDurationMs)
      .filter((duration): duration is number => duration !== null);

    return {
      scenario,
      executionMode: 'dedicated-worker',
      graphCacheMode,
      warmupDurationMs,
      warmupLoadedCells,
      firstWaypointSnapped: warmed.firstWaypointSnapped,
      segments: results,
      phaseTotals: aggregatePhaseTotals(results),
      totalRouteDurationMs: routeDurations.reduce(
        (sum, duration) => sum + duration,
        0,
      ),
      maximumRouteDurationMs: Math.max(0, ...routeDurations),
      maximumFrameDelayMs: Math.max(0, ...frameDelays),
      longTaskApiSupported: longTasks.supported,
      maximumLongTaskDurationMs:
        observedLongTasks.length > 0 ? Math.max(...observedLongTasks) : null,
      unexpectedNetworkCellLoads: results.reduce(
        (sum, result) => sum + result.unexpectedNewCells,
        0,
      ),
    };
  } finally {
    loader.dispose();
  }
}

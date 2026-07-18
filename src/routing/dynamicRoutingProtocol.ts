/**
 * Business context: defines the structured-clone contract between the map UI
 * and the dedicated dynamic-routing worker. Only plain data crosses this
 * boundary; swissTLM3D cells, graphs, and spatial indexes remain worker-owned.
 */
import type { Coordinate } from 'ol/coordinate.js';
import type {
  RoutedNetworkPath,
  RoutingNetworkPhaseTimings,
} from './networkRouter';

/** Session cache sizes exposed for diagnostics and the local benchmark. */
export interface DynamicRoutingCacheStats {
  /** Raw swissTLM3D cells retained for the current page session. */
  loadedCells: number;
  /** Cell requests currently in flight. */
  pendingCells: number;
  /** Exact corridor graphs retained by the small LRU cache. */
  cachedNetworks: number;
}

/** Detailed local timings collected only by the routing benchmark. */
export interface DynamicRoutingPhaseTimings extends RoutingNetworkPhaseTimings {
  /** Time spent calculating the exact graph-cache key and searching the LRU. */
  graphCacheLookupDurationMs: number;
  /** Time spent resolving already-cached raw cells into the requested corridor. */
  rawCellAccessDurationMs: number;
  /** Time spent deduplicating and merging road and hiking features from cells. */
  featureMergeDurationMs: number;
  /** Time spent constructing RoutingNetwork nodes, edges, and spatial indexes. */
  graphBuildDurationMs: number;
  /** Number of exact corridor graphs reused from the session LRU. */
  graphCacheHits: number;
  /** Number of exact corridor graphs that had to be constructed. */
  graphCacheMisses: number;
  /** Number of narrow or retry corridor route attempts. */
  routeAttempts: number;
  /** Whether the wider fallback corridor was required. */
  retryUsed: boolean;
}

/** Routed result together with phase timings for one benchmarked section. */
export interface DiagnosedDynamicRoutingResult {
  /** Routed geometry, or `null` when both corridors fail. */
  path: RoutedNetworkPath | null;
  /** Aggregated timings across the initial and optional retry corridor. */
  timings: DynamicRoutingPhaseTimings;
}

/** Signals that a route corridor exceeded the bounded browser safety limit. */
export class RoutingAreaTooLargeError extends Error {
  constructor(
    message = 'The requested dynamic routing area contains too many swissTLM3D cells.',
  ) {
    super(message);
    this.name = 'RoutingAreaTooLargeError';
  }
}

/** Request that snaps one first waypoint. */
export interface SnapWorkerRequest {
  type: 'request';
  requestId: number;
  operation: 'snap';
  coordinate: Coordinate;
}

/** Request that routes one section. */
export interface RouteWorkerRequest {
  type: 'request';
  requestId: number;
  operation: 'route';
  startCoordinate: Coordinate;
  endCoordinate: Coordinate;
}

/** Benchmark-only route request that returns worker-side phase timings. */
export interface DiagnosedRouteWorkerRequest {
  type: 'request';
  requestId: number;
  operation: 'routeWithDiagnostics';
  startCoordinate: Coordinate;
  endCoordinate: Coordinate;
}

/** Request that clears only derived graphs while retaining downloaded cells. */
export interface ClearNetworkCacheWorkerRequest {
  type: 'request';
  requestId: number;
  operation: 'clearNetworkCache';
}

/** Request that reads worker-owned cache sizes. */
export interface CacheStatsWorkerRequest {
  type: 'request';
  requestId: number;
  operation: 'getCacheStats';
}

/** Cancels one outstanding operation. */
export interface CancelRoutingWorkerRequest {
  type: 'cancel';
  requestId: number;
}

/** Every message accepted by the worker. */
export type RoutingWorkerRequest =
  | SnapWorkerRequest
  | RouteWorkerRequest
  | DiagnosedRouteWorkerRequest
  | ClearNetworkCacheWorkerRequest
  | CacheStatsWorkerRequest
  | CancelRoutingWorkerRequest;

/** Serialized error safe to pass through structured clone. */
export interface SerializedRoutingWorkerError {
  name: string;
  message: string;
  stack?: string;
}

/** Successful worker response. */
export interface RoutingWorkerSuccessResponse {
  type: 'success';
  requestId: number;
  result: unknown;
}

/** Failed worker response. */
export interface RoutingWorkerErrorResponse {
  type: 'error';
  requestId: number;
  error: SerializedRoutingWorkerError;
}

/** Every response emitted by the worker. */
export type RoutingWorkerResponse =
  | RoutingWorkerSuccessResponse
  | RoutingWorkerErrorResponse;

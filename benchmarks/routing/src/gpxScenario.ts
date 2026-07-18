/**
 * Business context: converts a detailed read-only GPX trace into deterministic
 * synthetic clicks for the browser routing benchmark. GPX track vertices are
 * display geometry, not the sparse decisions a hiker would make in a planner,
 * so the benchmark samples a controlled subset along one continuous segment.
 */
import type { Coordinate } from 'ol/coordinate.js';
import { parseGpxRoute } from '../../../src/import/gpx';
import { fromWgs84, toWgs84 } from '../../../src/map/projection';

/** Maximum generated route sections, preventing accidental benchmark overload. */
const MAX_GENERATED_SEGMENTS = 24;
/** Typical click spacing in metres used by the adaptive strategy. */
const ADAPTIVE_TARGET_SPACING_METERS = 500;

/** Supported deterministic waypoint-generation strategies. */
export type WaypointGenerationStrategy =
  | {
      /** Chooses a route-length-dependent segment count around 500-metre sections. */
      kind: 'adaptive';
    }
  | {
      /** Places clicks at one fixed ground interval, including very short tests. */
      kind: 'regular';
      /** Requested distance in metres between consecutive synthetic clicks. */
      spacingMeters: number;
    }
  | {
      /** Varies section lengths around a configured average with a stable seed. */
      kind: 'irregular';
      /** Mean section length in metres before deterministic variation is applied. */
      averageSpacingMeters: number;
      /** Seed that keeps the generated irregular pattern stable between runs. */
      seed: number;
    };

/** Reproducible browser-routing scenario generated from one GPX segment. */
export interface RoutingBenchmarkScenario {
  /** Display name inherited from the GPX document. */
  name: string;
  /** Original uploaded filename. */
  sourceFilename: string;
  /** Strategy that produced the synthetic clicks. */
  strategy: WaypointGenerationStrategy;
  /** Total selected GPX segment length in LV95 metres. */
  sourceLengthMeters: number;
  /** Number of detailed vertices in the selected GPX segment. */
  sourcePointCount: number;
  /** Number of additional disconnected GPX segments deliberately ignored. */
  ignoredSegmentCount: number;
  /** Synthetic user clicks in native LV95 map coordinates. */
  waypointsLv95: Coordinate[];
  /** Cumulative distance of every synthetic click along the source trace. */
  waypointDistancesMeters: number[];
}

/** Portable JSON representation suitable for committing as a future fixture. */
export interface SerializedRoutingBenchmarkScenario {
  /** Display name inherited from the GPX document. */
  name: string;
  /** Original uploaded filename retained for traceability. */
  sourceFilename: string;
  /** Strategy that produced the serialized click sequence. */
  strategy: WaypointGenerationStrategy;
  /** Total selected GPX segment length in metres. */
  sourceLengthMeters: number;
  /** Number of detailed vertices in the selected source segment. */
  sourcePointCount: number;
  /** Number of disconnected GPX segments excluded from this scenario. */
  ignoredSegmentCount: number;
  /** Synthetic clicks stored as WGS 84 longitude/latitude pairs. */
  waypointsWgs84: Coordinate[];
  /** Cumulative ground distance of each synthetic click. */
  waypointDistancesMeters: number[];
}

/** Returns horizontal LV95 distance in metres. */
function coordinateDistance(first: Coordinate, second: Coordinate): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

/** Calculates cumulative ground distances for one continuous LV95 polyline. */
function cumulativeDistances(coordinates: Coordinate[]): number[] {
  const distances = [0];

  for (let index = 1; index < coordinates.length; index += 1) {
    distances.push(
      distances[index - 1] +
        coordinateDistance(coordinates[index - 1], coordinates[index]),
    );
  }

  return distances;
}

/** Small deterministic generator; benchmark scenarios must not change between runs. */
function createSeededRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** Keeps an integer inside inclusive limits. */
function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/**
 * Validates a user-configurable ground interval.
 * @param value - Requested spacing in metres.
 * @returns The unchanged spacing when it is finite and supported.
 * @throws {Error} When the interval is below 50 metres or not finite.
 */
function validatedSpacing(value: number): number {
  if (!Number.isFinite(value) || value < 50) {
    throw new Error('Waypoint spacing must be at least 50 metres.');
  }

  return value;
}

/**
 * Generates cumulative sample distances along a trace.
 * @param totalDistanceMeters - Complete continuous trace length.
 * @param strategy - Deterministic spacing strategy.
 * @returns Ordered distances beginning at zero and ending at the trace length.
 * @throws {Error} When the trace length or selected spacing cannot produce a bounded scenario.
 */
export function generateWaypointDistances(
  totalDistanceMeters: number,
  strategy: WaypointGenerationStrategy,
): number[] {
  if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) {
    throw new Error('The selected GPX segment has no measurable length.');
  }

  if (strategy.kind === 'regular') {
    const spacingMeters = validatedSpacing(strategy.spacingMeters);
    const requiredSegments = Math.ceil(totalDistanceMeters / spacingMeters);

    if (requiredSegments > MAX_GENERATED_SEGMENTS) {
      throw new Error(
        `This interval would generate ${requiredSegments} sections; use a shorter GPX or an interval of at least ${Math.ceil(
          totalDistanceMeters / MAX_GENERATED_SEGMENTS,
        )} metres.`,
      );
    }

    const distances = [0];

    for (
      let distance = spacingMeters;
      distance < totalDistanceMeters;
      distance += spacingMeters
    ) {
      distances.push(distance);
    }

    distances.push(totalDistanceMeters);
    return distances;
  }

  const averageSpacingMeters =
    strategy.kind === 'irregular'
      ? validatedSpacing(strategy.averageSpacingMeters)
      : ADAPTIVE_TARGET_SPACING_METERS;
  const segmentCount = clampInteger(
    totalDistanceMeters / averageSpacingMeters,
    1,
    MAX_GENERATED_SEGMENTS,
  );

  if (strategy.kind === 'adaptive') {
    return Array.from(
      { length: segmentCount + 1 },
      (_, index) => (totalDistanceMeters * index) / segmentCount,
    );
  }

  const random = createSeededRandom(strategy.seed);
  // A 55-145% spread creates visibly irregular sections without producing one
  // pathological micro-segment next to a very long corridor.
  const weights = Array.from(
    { length: segmentCount },
    () => 0.55 + random() * 0.9,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const distances = [0];
  let cumulativeWeight = 0;

  for (let index = 0; index < weights.length - 1; index += 1) {
    cumulativeWeight += weights[index];
    distances.push((totalDistanceMeters * cumulativeWeight) / totalWeight);
  }

  distances.push(totalDistanceMeters);
  return distances;
}

/**
 * Interpolates one LV95 coordinate at a cumulative ground distance.
 * @param coordinates - Continuous source polyline in EPSG:2056.
 * @param distances - Cumulative metres matching the source coordinates.
 * @param targetDistance - Requested cumulative distance in metres.
 * @returns Interpolated coordinate, clamped to the source endpoints.
 */
function coordinateAtDistance(
  coordinates: Coordinate[],
  distances: number[],
  targetDistance: number,
): Coordinate {
  if (targetDistance <= 0) {
    return [...coordinates[0]];
  }

  const totalDistance = distances[distances.length - 1];

  if (targetDistance >= totalDistance) {
    return [...coordinates[coordinates.length - 1]];
  }

  let upperIndex = 1;

  while (distances[upperIndex] < targetDistance) {
    upperIndex += 1;
  }

  const lowerIndex = upperIndex - 1;
  const sectionDistance = distances[upperIndex] - distances[lowerIndex];
  const fraction =
    sectionDistance === 0
      ? 0
      : (targetDistance - distances[lowerIndex]) / sectionDistance;
  const start = coordinates[lowerIndex];
  const end = coordinates[upperIndex];

  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ];
}

/**
 * Selects the longest continuous GPX segment so deliberate gaps stay disconnected.
 * @param segments - Projected GPX segments that must not be joined together.
 * @returns Selected coordinates and their cumulative distances.
 * @throws {Error} When the GPX contains no continuous segment.
 */
function selectLongestSegment(segments: Coordinate[][]): {
  coordinates: Coordinate[];
  distances: number[];
} {
  let selectedCoordinates: Coordinate[] | null = null;
  let selectedDistances: number[] | null = null;
  let selectedLength = -1;

  for (const coordinates of segments) {
    const distances = cumulativeDistances(coordinates);
    const length = distances[distances.length - 1];

    if (length > selectedLength) {
      selectedCoordinates = coordinates;
      selectedDistances = distances;
      selectedLength = length;
    }
  }

  if (!selectedCoordinates || !selectedDistances) {
    throw new Error('The GPX contains no continuous segment.');
  }

  return { coordinates: selectedCoordinates, distances: selectedDistances };
}

/**
 * Parses a GPX and generates deterministic synthetic route-creation clicks.
 * @param xml - Complete GPX XML text.
 * @param filename - Uploaded source filename.
 * @param strategy - Click-spacing strategy selected for the benchmark.
 * @returns Reproducible LV95 click scenario based on the longest GPX segment.
 * @throws {Error} When GPX parsing or deterministic sampling fails.
 */
export function createScenarioFromGpx(
  xml: string,
  filename: string,
  strategy: WaypointGenerationStrategy,
): RoutingBenchmarkScenario {
  const route = parseGpxRoute(xml, filename);
  const projectedSegments = route.segments.map((segment) =>
    segment.coordinates.map(fromWgs84),
  );
  const selected = selectLongestSegment(projectedSegments);
  const totalDistance = selected.distances[selected.distances.length - 1];
  const waypointDistancesMeters = generateWaypointDistances(
    totalDistance,
    strategy,
  );

  return {
    name: route.name,
    sourceFilename: filename,
    strategy,
    sourceLengthMeters: totalDistance,
    sourcePointCount: selected.coordinates.length,
    ignoredSegmentCount: Math.max(0, projectedSegments.length - 1),
    waypointsLv95: waypointDistancesMeters.map((distance) =>
      coordinateAtDistance(selected.coordinates, selected.distances, distance),
    ),
    waypointDistancesMeters,
  };
}

/**
 * Converts a generated scenario to stable, human-readable JSON data.
 * @param scenario - In-memory LV95 benchmark scenario.
 * @returns Portable WGS 84 representation suitable for a committed fixture.
 */
export function serializeScenario(
  scenario: RoutingBenchmarkScenario,
): SerializedRoutingBenchmarkScenario {
  return {
    name: scenario.name,
    sourceFilename: scenario.sourceFilename,
    strategy: scenario.strategy,
    sourceLengthMeters: scenario.sourceLengthMeters,
    sourcePointCount: scenario.sourcePointCount,
    ignoredSegmentCount: scenario.ignoredSegmentCount,
    waypointsWgs84: scenario.waypointsLv95.map(toWgs84),
    waypointDistancesMeters: scenario.waypointDistancesMeters,
  };
}

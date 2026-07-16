/**
 * Business context: links the compact elevation profile back to the map without
 * turning the chart into a second navigation surface. The distance index is
 * built once per route, then pointer movement can place a transient marker in
 * constant time apart from a small binary search.
 */
import type { Coordinate } from 'ol/coordinate.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { getDistance } from 'ol/sphere.js';
import { toWgs84 } from './projection';
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
} from 'ol/style.js';

/** One independently measurable route segment in the profile distance index. */
interface RouteProfileIndexedSegment {
  /** Original projected route vertices. */
  coordinates: Coordinate[];
  /** Geodesic distance from the segment start at each matching vertex. */
  cumulativeDistancesMeters: number[];
  /** Cumulative route distance before this segment. */
  startDistanceMeters: number;
  /** Measurable length of this segment. */
  distanceMeters: number;
}

/** Precomputed route geometry used to translate between profile and map positions. */
export interface RouteProfilePositionIndex {
  /** Independent route sections, preserving deliberate GPX gaps. */
  segments: RouteProfileIndexedSegment[];
  /** Sum of all indexed segment lengths. */
  totalDistanceMeters: number;
}

/** Closest indexed route position returned for one map pointer coordinate. */
export interface RouteProfilePosition {
  /** Projected coordinate snapped to the displayed route geometry. */
  coordinate: Coordinate;
  /** Cumulative geodesic distance from the start of the itinerary. */
  distanceMeters: number;
}

/** OpenLayers resources for the transient route/profile position marker. */
export interface RouteProfileMarker {
  /** Feature whose geometry is removed while neither map nor profile is hovered. */
  feature: Feature<Point>;
  /** Layer kept above route and location symbols. */
  layer: VectorLayer<VectorSource<Feature<Point>>>;
}

/**
 * Exact overlap ties use route order so repeated paths map to the latest
 * passage.
 */
const ROUTE_PROFILE_OVERLAP_TIE_TOLERANCE_SQUARED = 1e-6;

/** Dark centre and white casing stay legible over every official background. */
const ROUTE_PROFILE_MARKER_STYLE = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({
      color: '#222a31',
    }),
    stroke: new Stroke({
      color: '#ffffff',
      width: 3,
    }),
  }),
});

/** Creates a hidden marker that can follow pointer movement over map or profile. */
export function createRouteProfileMarker(): RouteProfileMarker {
  const feature = new Feature<Point>();
  const source = new VectorSource<Feature<Point>>({
    features: [feature],
  });
  const layer = new VectorLayer({
    source,
    zIndex: 21,
    style: ROUTE_PROFILE_MARKER_STYLE,
  });

  return { feature, layer };
}

/** Shows the marker at one map coordinate, or hides it when the coordinate is null. */
export function updateRouteProfileMarker(
  marker: RouteProfileMarker,
  coordinate: Coordinate | null,
): void {
  marker.feature.setGeometry(coordinate ? new Point(coordinate) : undefined);
}

/** Measures one route segment geodesically at each original map vertex. */
function measureSegment(coordinates: Coordinate[]): {
  cumulativeDistancesMeters: number[];
  distanceMeters: number;
} {
  const cumulativeDistancesMeters = [0];
  const lonLatCoordinates = coordinates.map((coordinate) =>
    toWgs84(coordinate),
  );

  for (let index = 1; index < lonLatCoordinates.length; index += 1) {
    cumulativeDistancesMeters.push(
      cumulativeDistancesMeters[cumulativeDistancesMeters.length - 1] +
        getDistance(lonLatCoordinates[index - 1], lonLatCoordinates[index]),
    );
  }

  return {
    cumulativeDistancesMeters,
    distanceMeters:
      cumulativeDistancesMeters[cumulativeDistancesMeters.length - 1] ?? 0,
  };
}

/** Builds an efficient lookup while keeping separate GPX track segments independent. */
export function createRouteProfilePositionIndex(
  routeSegments: Coordinate[][],
): RouteProfilePositionIndex {
  const segments: RouteProfileIndexedSegment[] = [];
  let totalDistanceMeters = 0;

  for (const coordinates of routeSegments) {
    if (coordinates.length < 2) {
      continue;
    }

    const { cumulativeDistancesMeters, distanceMeters } =
      measureSegment(coordinates);

    if (distanceMeters <= 0) {
      continue;
    }

    segments.push({
      coordinates,
      cumulativeDistancesMeters,
      startDistanceMeters: totalDistanceMeters,
      distanceMeters,
    });
    totalDistanceMeters += distanceMeters;
  }

  return { segments, totalDistanceMeters };
}

/** Finds the first cumulative vertex distance greater than or equal to the target. */
function findUpperDistanceIndex(
  cumulativeDistancesMeters: number[],
  targetDistanceMeters: number,
): number {
  let lowerIndex = 0;
  let upperIndex = cumulativeDistancesMeters.length - 1;

  while (lowerIndex < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);

    if (cumulativeDistancesMeters[middleIndex] < targetDistanceMeters) {
      lowerIndex = middleIndex + 1;
    } else {
      upperIndex = middleIndex;
    }
  }

  return lowerIndex;
}

/** Interpolates one projected coordinate at a distance inside a measured segment. */
function coordinateInsideSegment(
  segment: RouteProfileIndexedSegment,
  distanceMeters: number,
): Coordinate {
  if (distanceMeters <= 0) {
    return [...segment.coordinates[0]];
  }

  if (distanceMeters >= segment.distanceMeters) {
    return [...segment.coordinates[segment.coordinates.length - 1]];
  }

  const upperIndex = findUpperDistanceIndex(
    segment.cumulativeDistancesMeters,
    distanceMeters,
  );
  const lowerIndex = Math.max(0, upperIndex - 1);
  const lowerDistance = segment.cumulativeDistancesMeters[lowerIndex];
  const upperDistance = segment.cumulativeDistancesMeters[upperIndex];
  const distanceSpan = upperDistance - lowerDistance;
  const fraction =
    distanceSpan > 0 ? (distanceMeters - lowerDistance) / distanceSpan : 0;
  const lowerCoordinate = segment.coordinates[lowerIndex];
  const upperCoordinate = segment.coordinates[upperIndex];

  return [
    lowerCoordinate[0] +
      (upperCoordinate[0] - lowerCoordinate[0]) * fraction,
    lowerCoordinate[1] +
      (upperCoordinate[1] - lowerCoordinate[1]) * fraction,
  ];
}

/**
 * Converts cumulative profile distance to the matching displayed route position.
 * Deliberate gaps between imported GPX segments are never interpolated.
 */
export function getRouteProfileCoordinate(
  index: RouteProfilePositionIndex,
  distanceMeters: number,
): Coordinate | null {
  if (index.segments.length === 0 || !Number.isFinite(distanceMeters)) {
    return null;
  }

  const boundedDistance = Math.min(
    index.totalDistanceMeters,
    Math.max(0, distanceMeters),
  );

  for (const segment of index.segments) {
    const segmentEndDistance =
      segment.startDistanceMeters + segment.distanceMeters;

    if (boundedDistance <= segmentEndDistance) {
      return coordinateInsideSegment(
        segment,
        boundedDistance - segment.startDistanceMeters,
      );
    }
  }

  const lastSegment = index.segments[index.segments.length - 1];
  return [...lastSegment.coordinates[lastSegment.coordinates.length - 1]];
}

/** Returns the closest point and interpolation fraction on one projected segment. */
function closestPointOnProjectedSegment(
  coordinate: Coordinate,
  start: Coordinate,
  end: Coordinate,
): {
  coordinate: Coordinate;
  fraction: number;
  distanceSquared: number;
} {
  const segmentX = end[0] - start[0];
  const segmentY = end[1] - start[1];
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    const deltaX = coordinate[0] - start[0];
    const deltaY = coordinate[1] - start[1];

    return {
      coordinate: [...start],
      fraction: 0,
      distanceSquared: deltaX * deltaX + deltaY * deltaY,
    };
  }

  const projection =
    ((coordinate[0] - start[0]) * segmentX +
      (coordinate[1] - start[1]) * segmentY) /
    segmentLengthSquared;
  const fraction = Math.max(0, Math.min(1, projection));
  const closestCoordinate: Coordinate = [
    start[0] + fraction * segmentX,
    start[1] + fraction * segmentY,
  ];
  const deltaX = coordinate[0] - closestCoordinate[0];
  const deltaY = coordinate[1] - closestCoordinate[1];

  return {
    coordinate: closestCoordinate,
    fraction,
    distanceSquared: deltaX * deltaX + deltaY * deltaY,
  };
}

/**
 * Finds the nearest displayed route position for one projected map coordinate.
 *
 * The pointer tolerance is supplied in map units so the caller can keep a
 * stable screen-pixel hit area at every zoom. Perfectly overlapping passages
 * resolve to the latest cumulative position in route order, matching direct
 * route-section editing.
 */
export function getClosestRouteProfilePosition(
  index: RouteProfilePositionIndex,
  coordinate: Coordinate,
  maximumDistanceMapUnits: number,
): RouteProfilePosition | null {
  if (
    index.segments.length === 0 ||
    !Number.isFinite(maximumDistanceMapUnits) ||
    maximumDistanceMapUnits < 0
  ) {
    return null;
  }

  const maximumDistanceSquared = maximumDistanceMapUnits ** 2;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  let closestPosition: RouteProfilePosition | null = null;

  for (const segment of index.segments) {
    for (
      let coordinateIndex = 1;
      coordinateIndex < segment.coordinates.length;
      coordinateIndex += 1
    ) {
      const candidate = closestPointOnProjectedSegment(
        coordinate,
        segment.coordinates[coordinateIndex - 1],
        segment.coordinates[coordinateIndex],
      );
      const lowerDistance =
        segment.cumulativeDistancesMeters[coordinateIndex - 1];
      const upperDistance =
        segment.cumulativeDistancesMeters[coordinateIndex];
      const candidateRouteDistance =
        segment.startDistanceMeters +
        lowerDistance +
        (upperDistance - lowerDistance) * candidate.fraction;
      const distanceDifference =
        candidate.distanceSquared - closestDistanceSquared;
      const isCloser =
        distanceDifference < -ROUTE_PROFILE_OVERLAP_TIE_TOLERANCE_SQUARED;
      const isSameVisiblePositionLaterInRoute =
        Math.abs(distanceDifference) <=
          ROUTE_PROFILE_OVERLAP_TIE_TOLERANCE_SQUARED &&
        closestPosition !== null &&
        candidateRouteDistance > closestPosition.distanceMeters;

      if (isCloser || isSameVisiblePositionLaterInRoute) {
        closestDistanceSquared = candidate.distanceSquared;
        closestPosition = {
          coordinate: candidate.coordinate,
          distanceMeters: candidateRouteDistance,
        };
      }
    }
  }

  return closestDistanceSquared <= maximumDistanceSquared
    ? closestPosition
    : null;
}


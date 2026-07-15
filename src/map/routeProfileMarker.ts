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
import { toLonLat } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import { getDistance } from 'ol/sphere.js';
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

/** Precomputed route geometry used to translate profile distance to map position. */
export interface RouteProfilePositionIndex {
  /** Independent route sections, preserving deliberate GPX gaps. */
  segments: RouteProfileIndexedSegment[];
  /** Sum of all indexed segment lengths. */
  totalDistanceMeters: number;
}

/** OpenLayers resources for the transient profile-hover marker. */
export interface RouteProfileMarker {
  /** Feature whose geometry is removed while the profile is not hovered. */
  feature: Feature<Point>;
  /** Layer kept above route and location symbols. */
  layer: VectorLayer<VectorSource<Feature<Point>>>;
}

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

/** Creates a hidden marker that can follow pointer movement over the profile. */
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
    toLonLat(coordinate),
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

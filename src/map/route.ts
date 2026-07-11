/**
 * Business context: owns the OpenLayers representation of the route currently
 * edited by the user. Route history remains immutable React data, while this
 * module rebuilds a lightweight red line and waypoint layer from that history
 * after add, undo, or redo operations.
 */
import type { Coordinate } from 'ol/coordinate.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
} from 'ol/style.js';

/** Geometry source used when one route step was created. */
export type RouteMode =
  /** Direct line between waypoints. */
  | 'straight'
  /** Geometry calculated on the swissTLM3D routing network. */
  | 'network';

/** Immutable history entry representing one user waypoint and its incoming segment. */
export interface RouteStep {
  /**
   * Effective waypoint coordinate; network mode replaces the original click
   * with the snapped coordinate.
   */
  waypoint: Coordinate;
  /** Geometry from the previous waypoint to this one, or `null` for the first point. */
  segment: Coordinate[] | null;
  /** Whether the incoming segment is straight or network-routed. */
  mode: RouteMode;
}

/** OpenLayers resources used to render the current route. */
export interface RouteDisplay {
  /** Vector layer inserted above map tiles and below transient markers. */
  layer: VectorLayer<VectorSource>;
  /** Mutable feature source rebuilt whenever immutable route history changes. */
  source: VectorSource;
}

/** Swiss-red route colour chosen to stay distinct from blue hydrography. */
const ROUTE_COLOR = '#d52b1e';
/** Squared distance in square map units below which route vertices are duplicates. */
const DUPLICATE_COORDINATE_DISTANCE_SQUARED = 0.01;

/**
 * Route line styles in screen pixels. The 11 px white casing separates the
 * 7 px red centre line from red hiking-trail symbology and dense map details.
 */
const ROUTE_LINE_STYLE = [
  new Style({
    stroke: new Stroke({
      color: 'rgba(255, 255, 255, 0.95)',
      width: 11,
    }),
  }),
  new Style({
    stroke: new Stroke({
      color: ROUTE_COLOR,
      width: 7,
    }),
  }),
];

/** Waypoint style in screen pixels; a white centre keeps points readable over the red line. */
const ROUTE_WAYPOINT_STYLE = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({
      color: '#ffffff',
    }),
    stroke: new Stroke({
      color: ROUTE_COLOR,
      width: 3,
    }),
  }),
});

/** Returns squared horizontal distance in map units to avoid a square root during deduplication. */
function coordinateDistanceSquared(
  first: Coordinate,
  second: Coordinate,
): number {
  const deltaX = first[0] - second[0];
  const deltaY = first[1] - second[1];
  return deltaX * deltaX + deltaY * deltaY;
}

/** Appends a coordinate unless it would create a sub-decimetre duplicate vertex. */
function appendCoordinate(
  coordinates: Coordinate[],
  coordinate: Coordinate,
): void {
  const previousCoordinate = coordinates[coordinates.length - 1];

  if (
    !previousCoordinate ||
    coordinateDistanceSquared(previousCoordinate, coordinate) >
      DUPLICATE_COORDINATE_DISTANCE_SQUARED
  ) {
    coordinates.push([...coordinate]);
  }
}

/**
 * Flattens incoming step geometries into one continuous display line.
 * @param steps - Ordered immutable route history.
 * @returns Deduplicated route coordinates in display order.
 */
function collectRouteCoordinates(steps: RouteStep[]): Coordinate[] {
  const coordinates: Coordinate[] = [];

  for (const step of steps) {
    if (step.segment && step.segment.length >= 2) {
      for (const coordinate of step.segment) {
        appendCoordinate(coordinates, coordinate);
      }
    } else {
      appendCoordinate(coordinates, step.waypoint);
    }
  }

  return coordinates;
}

/**
 * Creates the vector layer used for the route currently being edited.
 * @returns Layer/source pair owned by the root map component.
 */
export function createRouteDisplay(): RouteDisplay {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    zIndex: 18,
  });

  return {
    layer,
    source,
  };
}

/**
 * Rebuilds the small route layer from immutable route steps.
 *
 * Keeping history outside OpenLayers makes undo and redo independent from
 * mutable features. Each step stores its exact generated geometry, so redo does
 * not repeat a network request and cannot produce a subtly different route.
 *
 * @param display - OpenLayers route resources to update in place.
 * @param steps - Current ordered route history.
 */
export function updateRouteDisplay(
  display: RouteDisplay,
  steps: RouteStep[],
): void {
  const features: Feature[] = [];
  const routeCoordinates = collectRouteCoordinates(steps);

  if (routeCoordinates.length >= 2) {
    const line = new Feature({
      geometry: new LineString(routeCoordinates),
    });
    line.setStyle(ROUTE_LINE_STYLE);
    features.push(line);
  }

  for (const step of steps) {
    const waypoint = new Feature({
      geometry: new Point(step.waypoint),
    });
    waypoint.setStyle(ROUTE_WAYPOINT_STYLE);
    features.push(waypoint);
  }

  display.source.clear();
  display.source.addFeatures(features);
}

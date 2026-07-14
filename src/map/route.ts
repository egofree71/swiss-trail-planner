/**
 * Business context: owns the OpenLayers representation and direct waypoint
 * interaction for the route currently edited by the user. Route history stays
 * immutable React data, while this module rebuilds the lightweight red route
 * layer and provides a bounded drag interaction for existing waypoints.
 */
import type { Coordinate } from 'ol/coordinate.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import PointerInteraction from 'ol/interaction/Pointer.js';
import VectorLayer from 'ol/layer/Vector.js';
import type Map from 'ol/Map.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type { Pixel } from 'ol/pixel.js';
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

/** Callbacks used by the pointer interaction without owning route state. */
export interface RouteWaypointDragCallbacks {
  /** Returns whether a new drag may begin at this moment. */
  canStart: () => boolean;
  /** Called once when an existing waypoint is pressed. */
  onStart: (waypointIndex: number, coordinate: Coordinate) => void;
  /** Called for visual previews while the pointer moves. */
  onDrag: (waypointIndex: number, coordinate: Coordinate) => void;
  /** Called once on release so the application can recalculate adjacent sections. */
  onEnd: (waypointIndex: number, coordinate: Coordinate) => void;
}

/** Swiss-red route colour chosen to stay distinct from blue hydrography. */
const ROUTE_COLOR = '#d52b1e';
/** Feature property used to distinguish draggable waypoints from the route line. */
const ROUTE_WAYPOINT_INDEX_PROPERTY = 'routeWaypointIndex';
/** Squared distance in square map units below which route vertices are duplicates. */
const DUPLICATE_COORDINATE_DISTANCE_SQUARED = 0.01;
/** Pointer tolerance in screen pixels, deliberately larger than the visible point on touch screens. */
const ROUTE_WAYPOINT_HIT_TOLERANCE_PX = 12;

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

/** The dragged waypoint grows slightly so the active edit remains visible under the pointer. */
const ACTIVE_ROUTE_WAYPOINT_STYLE = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({
      color: '#ffffff',
    }),
    stroke: new Stroke({
      color: ROUTE_COLOR,
      width: 4,
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

/** Returns a waypoint index only when the hit feature is one of the route points. */
function getWaypointIndex(feature: Feature): number | null {
  const waypointIndex = feature.get(ROUTE_WAYPOINT_INDEX_PROPERTY);
  return Number.isInteger(waypointIndex) ? (waypointIndex as number) : null;
}

/** Updates the map target cursor classes without overriding the busy cursor. */
function updateWaypointCursor(
  map: Map,
  isHovering: boolean,
  isDragging: boolean,
): void {
  const target = map.getTargetElement();
  target.classList.toggle('map--route-waypoint-hover', isHovering);
  target.classList.toggle('map--route-waypoint-dragging', isDragging);
}

/**
 * Flattens incoming step geometries into one continuous display line.
 * @param steps - Ordered immutable route history.
 * @returns Deduplicated route coordinates in display order.
 */
export function collectRouteCoordinates(steps: RouteStep[]): Coordinate[] {
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
 * Reverses waypoint order and every stored incoming section without routing again.
 *
 * Each original section belongs to its destination step. After reversal, that
 * same section belongs to the former start waypoint, so both the geometry and
 * owning step must be rebuilt in the opposite direction.
 *
 * @param steps - Applied route steps in their current display order.
 * @returns A new immutable step array representing the same geometry backwards.
 */
export function reverseRouteSteps(steps: RouteStep[]): RouteStep[] {
  if (steps.length === 0) {
    return [];
  }

  const lastStep = steps[steps.length - 1];
  const reversedSteps: RouteStep[] = [
    {
      waypoint: [...lastStep.waypoint],
      segment: null,
      mode: lastStep.mode,
    },
  ];

  for (let index = steps.length - 1; index > 0; index -= 1) {
    const sourceStep = steps[index];
    const destinationStep = steps[index - 1];
    const reversedSegment = sourceStep.segment
      ? sourceStep.segment
          .slice()
          .reverse()
          .map((coordinate): Coordinate => [...coordinate])
      : [[...sourceStep.waypoint], [...destinationStep.waypoint]];

    reversedSteps.push({
      waypoint: [...destinationStep.waypoint],
      segment: reversedSegment,
      mode: sourceStep.mode,
    });
  }

  return reversedSteps;
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
 * Returns the route waypoint under one screen pixel, ignoring the route line.
 * @param map - OpenLayers map that owns the route layer.
 * @param display - Route display whose waypoint features may be selected.
 * @param pixel - Screen pixel from an OpenLayers browser event.
 * @param hitTolerance - Additional pointer tolerance in screen pixels.
 */
export function getRouteWaypointIndexAtPixel(
  map: Map,
  display: RouteDisplay,
  pixel: Pixel,
  hitTolerance = ROUTE_WAYPOINT_HIT_TOLERANCE_PX,
): number | null {
  const encodedWaypointIndex = map.forEachFeatureAtPixel(
    pixel,
    (feature) => {
      const waypointIndex = getWaypointIndex(feature as Feature);
      // OpenLayers stops on a truthy callback result. Encoding the index keeps
      // waypoint zero selectable instead of treating it like "not found".
      return waypointIndex === null ? undefined : waypointIndex + 1;
    },
    {
      hitTolerance,
      layerFilter: (layer) => layer === display.layer,
    },
  );

  return encodedWaypointIndex === undefined
    ? null
    : encodedWaypointIndex - 1;
}

/**
 * Creates an interaction that drags existing waypoint features only.
 *
 * The interaction owns no route data. During dragging it reports coordinates
 * to the application, which draws a temporary straight preview and performs
 * network recalculation only after release. Returning `true` on pointer down
 * also prevents OpenLayers DragPan from moving the map beneath the waypoint.
 */
export function createRouteWaypointDragInteraction(
  display: RouteDisplay,
  callbacks: RouteWaypointDragCallbacks,
): PointerInteraction {
  let draggedWaypointIndex: number | null = null;

  return new PointerInteraction({
    handleDownEvent: (event: MapBrowserEvent) => {
      if (!callbacks.canStart()) {
        return false;
      }

      const waypointIndex = getRouteWaypointIndexAtPixel(
        event.map,
        display,
        event.pixel,
      );

      if (waypointIndex === null) {
        return false;
      }

      draggedWaypointIndex = waypointIndex;
      updateWaypointCursor(event.map, false, true);
      callbacks.onStart(waypointIndex, [...event.coordinate]);
      return true;
    },
    handleDragEvent: (event: MapBrowserEvent) => {
      if (draggedWaypointIndex === null) {
        return;
      }

      callbacks.onDrag(draggedWaypointIndex, [...event.coordinate]);
    },
    handleMoveEvent: (event: MapBrowserEvent) => {
      if (!callbacks.canStart()) {
        updateWaypointCursor(event.map, false, false);
        return;
      }

      const waypointIndex = getRouteWaypointIndexAtPixel(
        event.map,
        display,
        event.pixel,
      );
      updateWaypointCursor(event.map, waypointIndex !== null, false);
    },
    handleUpEvent: (event: MapBrowserEvent) => {
      if (draggedWaypointIndex === null) {
        return false;
      }

      const waypointIndex = draggedWaypointIndex;
      draggedWaypointIndex = null;
      updateWaypointCursor(event.map, false, false);
      callbacks.onEnd(waypointIndex, [...event.coordinate]);
      return false;
    },
    stopDown: (handled) => handled,
  });
}

/** Removes cursor state if route editing is left during an active drag. */
export function clearRouteWaypointDragCursor(map: Map): void {
  updateWaypointCursor(map, false, false);
}

/**
 * Rebuilds the small route layer from immutable route steps.
 *
 * Keeping history outside OpenLayers makes undo and redo independent from
 * mutable features. Each committed state stores exact generated geometry, so
 * redo does not repeat network requests and cannot produce a different route.
 *
 * @param display - OpenLayers route resources to update in place.
 * @param steps - Current ordered route history.
 * @param activeWaypointIndex - Optional waypoint highlighted during a drag preview.
 */
export function updateRouteDisplay(
  display: RouteDisplay,
  steps: RouteStep[],
  activeWaypointIndex: number | null = null,
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

  steps.forEach((step, waypointIndex) => {
    const waypoint = new Feature({
      geometry: new Point(step.waypoint),
    });
    waypoint.set(ROUTE_WAYPOINT_INDEX_PROPERTY, waypointIndex);
    waypoint.setStyle(
      waypointIndex === activeWaypointIndex
        ? ACTIVE_ROUTE_WAYPOINT_STYLE
        : ROUTE_WAYPOINT_STYLE,
    );
    features.push(waypoint);
  });

  display.source.clear();
  display.source.addFeatures(features);
}

/**
 * Draws a fast local preview while a waypoint is dragged.
 *
 * Only the two adjacent sections are replaced with straight lines. The exact
 * route history remains untouched and network routing is deferred until the
 * pointer is released.
 */
export function updateRouteWaypointDragPreview(
  display: RouteDisplay,
  steps: RouteStep[],
  waypointIndex: number,
  coordinate: Coordinate,
): void {
  if (waypointIndex < 0 || waypointIndex >= steps.length) {
    updateRouteDisplay(display, steps);
    return;
  }

  const previewCoordinate: Coordinate = [...coordinate];
  const previewSteps = steps.slice();
  const movedStep = steps[waypointIndex];
  const previousStep = steps[waypointIndex - 1];

  previewSteps[waypointIndex] = {
    ...movedStep,
    waypoint: previewCoordinate,
    segment: previousStep
      ? [[...previousStep.waypoint], previewCoordinate]
      : null,
  };

  const nextStep = steps[waypointIndex + 1];

  if (nextStep) {
    previewSteps[waypointIndex + 1] = {
      ...nextStep,
      segment: [previewCoordinate, [...nextStep.waypoint]],
    };
  }

  updateRouteDisplay(display, previewSteps, waypointIndex);
}

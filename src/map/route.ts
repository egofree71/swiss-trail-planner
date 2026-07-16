/**
 * Business context: owns the OpenLayers representation and direct drag
 * interaction for the route currently edited by the user. Route history stays
 * immutable React data, while this module rebuilds the lightweight red route
 * layer and lets users move or delete existing waypoints, or pull a new
 * waypoint from an existing route section.
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
import {
  createItineraryEndpointFeatures,
  ITINERARY_ENDPOINT_ROLE_PROPERTY,
  type ItineraryEndpointRole,
} from './itineraryEndpoints';

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

/** Optional final section that connects the last waypoint back to the first. */
export interface RouteClosure {
  /** Exact displayed geometry from the last waypoint to the first waypoint. */
  segment: Coordinate[];
  /** Whether the closing section is straight or network-routed. */
  mode: RouteMode;
}

/** Complete immutable route geometry used by display and direct editing. */
export interface RouteState {
  /** Ordered user waypoints and their normal incoming sections. */
  steps: RouteStep[];
  /** Dedicated loop-closing section, without a duplicate waypoint marker. */
  closure: RouteClosure | null;
}

/** OpenLayers resources used to render the current route. */
export interface RouteDisplay {
  /** Vector layer inserted above map tiles and below transient markers. */
  layer: VectorLayer<VectorSource>;
  /** Mutable feature source rebuilt whenever immutable route history changes. */
  source: VectorSource;
}

/** Existing waypoint or incoming route section selected for one drag edit. */
export type RouteDragTarget =
  | {
      /** Move an already committed waypoint. */
      type: 'waypoint';
      /** Index of the waypoint in immutable route history. */
      waypointIndex: number;
      /** Exact committed coordinate at pointer down. */
      coordinate: Coordinate;
    }
  | {
      /** Insert a waypoint into an existing incoming section. */
      type: 'segment';
      /**
       * Index of the destination step whose incoming section was selected.
       * `steps.length` represents the dedicated closing section.
       */
      stepIndex: number;
      /** Closest coordinate on the stored section at pointer down. */
      coordinate: Coordinate;
    };

/** Route element exposed to contextual hover guidance. */
export type RouteHoverTarget = RouteDragTarget['type'];

/** Closest selectable route section under one pointer pixel. */
export interface RouteSegmentHit {
  /**
   * Destination step whose incoming geometry contains the hit.
   * `steps.length` represents the dedicated closing section.
   */
  stepIndex: number;
  /** Nearest coordinate on the stored section. */
  coordinate: Coordinate;
}

/** Callbacks used by the pointer interaction without owning route state. */
export interface RouteDragCallbacks {
  /** Returns whether a new drag may begin at this moment. */
  canStart: () => boolean;
  /** Returns the current immutable route state for line hit detection. */
  getRouteState: () => RouteState;
  /** Called once when an existing waypoint or route section is pressed. */
  onStart: (target: RouteDragTarget) => void;
  /** Called for visual previews while the pointer moves. */
  onDrag: (target: RouteDragTarget, coordinate: Coordinate) => void;
  /** Reports the route element under a hover-capable pointer. */
  onHover: (target: RouteHoverTarget | null, pixel: Pixel | null) => void;
  /** Called once on release so the application can recalculate affected sections. */
  onEnd: (
    target: RouteDragTarget,
    coordinate: Coordinate,
    didDrag: boolean,
    pixel: Pixel,
  ) => void;
}

/** Swiss-red route colour chosen to stay distinct from blue hydrography. */
const ROUTE_COLOR = '#d52b1e';
/** Feature property used to distinguish draggable waypoints from the route line. */
const ROUTE_WAYPOINT_INDEX_PROPERTY = 'routeWaypointIndex';
/** Squared distance in square map units below which route vertices are duplicates. */
const DUPLICATE_COORDINATE_DISTANCE_SQUARED = 0.01;
/** Pointer tolerance in screen pixels, deliberately larger than the visible point on touch screens. */
const ROUTE_WAYPOINT_HIT_TOLERANCE_PX = 12;
/** Route-line tolerance in screen pixels, matching the white casing around the red line. */
const ROUTE_SEGMENT_HIT_TOLERANCE_PX = 7;
/** Visually indistinguishable section distances use route order as a stable tie-breaker. */
const ROUTE_SEGMENT_OVERLAP_TIE_TOLERANCE_PX = 0.1;
/** Minimum screen movement that distinguishes a drag edit from a click. */
const ROUTE_EDIT_DRAG_DISTANCE_PX = 3;

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

/** Returns the closest XY coordinate on one finite segment and its squared distance. */
function getClosestPointOnSegment(
  coordinate: Coordinate,
  start: Coordinate,
  end: Coordinate,
): { coordinate: Coordinate; distanceSquared: number } {
  const segmentX = end[0] - start[0];
  const segmentY = end[1] - start[1];
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    return {
      coordinate: [start[0], start[1]],
      distanceSquared: coordinateDistanceSquared(coordinate, start),
    };
  }

  const projection =
    ((coordinate[0] - start[0]) * segmentX +
      (coordinate[1] - start[1]) * segmentY) /
    segmentLengthSquared;
  const boundedProjection = Math.max(0, Math.min(1, projection));
  const closestCoordinate: Coordinate = [
    start[0] + boundedProjection * segmentX,
    start[1] + boundedProjection * segmentY,
  ];

  return {
    coordinate: closestCoordinate,
    distanceSquared: coordinateDistanceSquared(
      coordinate,
      closestCoordinate,
    ),
  };
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

/** Updates contextual route cursor classes without overriding the busy cursor. */
function updateRouteEditCursor(
  map: Map,
  hoverTarget: RouteHoverTarget | null,
  isDragging: boolean,
): void {
  const target = map.getTargetElement();
  target.classList.toggle(
    'map--route-waypoint-hover',
    hoverTarget === 'waypoint' && !isDragging,
  );
  target.classList.toggle(
    'map--route-segment-hover',
    hoverTarget === 'segment' && !isDragging,
  );
  target.classList.toggle('map--route-edit-dragging', isDragging);
}

/**
 * Flattens incoming step geometries into one continuous display line.
 * @param steps - Ordered immutable route history.
 * @returns Deduplicated route coordinates in display order.
 */
export function collectRouteCoordinates(
  steps: RouteStep[],
  closure: RouteClosure | null = null,
): Coordinate[] {
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

  if (closure?.segment && closure.segment.length >= 2) {
    for (const coordinate of closure.segment) {
      appendCoordinate(coordinates, coordinate);
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


/** Reverses an open or closed route without recalculating any geometry. */
export function reverseRouteState(state: RouteState): RouteState {
  const reversedSteps = reverseRouteSteps(state.steps);
  const reversedClosure = state.closure
    ? {
        segment: state.closure.segment
          .slice()
          .reverse()
          .map((coordinate): Coordinate => [...coordinate]),
        mode: state.closure.mode,
      }
    : null;

  return {
    steps: reversedSteps,
    closure: reversedClosure,
  };
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
 * Returns the closest stored incoming section under one screen pixel.
 *
 * The calculation uses immutable step geometry rather than the flattened
 * display feature so the caller knows exactly where a new waypoint belongs.
 * Existing waypoint hit detection should run first because points take
 * precedence over the line around section endpoints.
 *
 * @param map - OpenLayers map used to convert pixel tolerance to map units.
 * @param steps - Current immutable route steps.
 * @param closure - Optional final section from the last waypoint to the first.
 * @param pixel - Screen pixel from an OpenLayers browser event.
 * @param hitTolerance - Maximum distance from the visible route in pixels.
 */
export function getRouteSegmentHitAtPixel(
  map: Map,
  steps: RouteStep[],
  closure: RouteClosure | null,
  pixel: Pixel,
  hitTolerance = ROUTE_SEGMENT_HIT_TOLERANCE_PX,
): RouteSegmentHit | null {
  const pointerCoordinate = map.getCoordinateFromPixel(pixel);
  const resolution = map.getView().getResolution();

  if (!pointerCoordinate || resolution === undefined || resolution <= 0) {
    return null;
  }

  const toleranceSquared = (resolution * hitTolerance) ** 2;
  const overlapTieToleranceSquared =
    (resolution * ROUTE_SEGMENT_OVERLAP_TIE_TOLERANCE_PX) ** 2;
  let closestHit: RouteSegmentHit | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;

  const inspectSegment = (segment: Coordinate[], stepIndex: number) => {
    for (
      let coordinateIndex = 1;
      coordinateIndex < segment.length;
      coordinateIndex += 1
    ) {
      const candidate = getClosestPointOnSegment(
        pointerCoordinate,
        segment[coordinateIndex - 1],
        segment[coordinateIndex],
      );

      const distanceDifference =
        candidate.distanceSquared - closestDistanceSquared;
      const isCloser = distanceDifference < -overlapTieToleranceSquared;
      const isVisuallyOverlapping =
        Math.abs(distanceDifference) <= overlapTieToleranceSquared;
      const isMoreRecentOverlappingSection =
        isVisuallyOverlapping &&
        closestHit !== null &&
        stepIndex > closestHit.stepIndex;

      if (isCloser || isMoreRecentOverlappingSection) {
        closestDistanceSquared = candidate.distanceSquared;
        closestHit = {
          stepIndex,
          coordinate: candidate.coordinate,
        };
      }
    }
  };

  for (let stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
    const segment = steps[stepIndex].segment;

    if (segment && segment.length >= 2) {
      inspectSegment(segment, stepIndex);
    }
  }

  if (closure?.segment && closure.segment.length >= 2) {
    inspectSegment(closure.segment, steps.length);
  }

  return closestDistanceSquared <= toleranceSquared ? closestHit : null;
}

/**
 * Creates one interaction for moving waypoints or pulling a new point from a
 * route section.
 *
 * The interaction owns no route data. During dragging it reports coordinates
 * to the application, which draws a temporary straight preview and performs
 * network recalculation only after release. Returning `true` on pointer down
 * also prevents OpenLayers DragPan from moving the map beneath the route.
 */
export function createRouteDragInteraction(
  display: RouteDisplay,
  callbacks: RouteDragCallbacks,
): PointerInteraction {
  let dragTarget: RouteDragTarget | null = null;
  let startPixel: Pixel | null = null;
  let maximumPixelDistanceSquared = 0;
  let isDragging = false;

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

      if (waypointIndex !== null) {
        const step = callbacks.getRouteState().steps[waypointIndex];

        if (!step) {
          return false;
        }

        dragTarget = {
          type: 'waypoint',
          waypointIndex,
          coordinate: [...step.waypoint],
        };
      } else {
        const routeState = callbacks.getRouteState();
        const segmentHit = getRouteSegmentHitAtPixel(
          event.map,
          routeState.steps,
          routeState.closure,
          event.pixel,
        );

        if (!segmentHit) {
          return false;
        }

        dragTarget = {
          type: 'segment',
          stepIndex: segmentHit.stepIndex,
          coordinate: [...segmentHit.coordinate],
        };
      }

      startPixel = [...event.pixel];
      maximumPixelDistanceSquared = 0;
      isDragging = false;
      callbacks.onHover(null, null);
      updateRouteEditCursor(event.map, dragTarget.type, false);
      callbacks.onStart(dragTarget);
      return true;
    },
    handleDragEvent: (event: MapBrowserEvent) => {
      if (!dragTarget) {
        return;
      }

      if (startPixel) {
        const deltaX = event.pixel[0] - startPixel[0];
        const deltaY = event.pixel[1] - startPixel[1];
        maximumPixelDistanceSquared = Math.max(
          maximumPixelDistanceSquared,
          deltaX * deltaX + deltaY * deltaY,
        );

        if (
          !isDragging &&
          maximumPixelDistanceSquared >= ROUTE_EDIT_DRAG_DISTANCE_PX ** 2
        ) {
          isDragging = true;
          updateRouteEditCursor(event.map, null, true);
        }
      }

      callbacks.onDrag(dragTarget, [...event.coordinate]);
    },
    handleMoveEvent: (event: MapBrowserEvent) => {
      const pointerType = (event.originalEvent as PointerEvent).pointerType;

      if (
        !callbacks.canStart() ||
        (pointerType && pointerType !== 'mouse' && pointerType !== 'pen')
      ) {
        callbacks.onHover(null, null);
        updateRouteEditCursor(event.map, null, false);
        return;
      }

      const waypointIndex = getRouteWaypointIndexAtPixel(
        event.map,
        display,
        event.pixel,
      );
      const segmentHit =
        waypointIndex === null
          ? (() => {
              const routeState = callbacks.getRouteState();
              return getRouteSegmentHitAtPixel(
                event.map,
                routeState.steps,
                routeState.closure,
                event.pixel,
              );
            })()
          : null;

      const hoverTarget: RouteHoverTarget | null =
        waypointIndex !== null
          ? 'waypoint'
          : segmentHit !== null
            ? 'segment'
            : null;

      callbacks.onHover(
        hoverTarget,
        hoverTarget ? [...event.pixel] : null,
      );
      updateRouteEditCursor(event.map, hoverTarget, false);
    },
    handleUpEvent: (event: MapBrowserEvent) => {
      if (!dragTarget) {
        return false;
      }

      const releasedTarget = dragTarget;
      const didDrag =
        maximumPixelDistanceSquared >= ROUTE_EDIT_DRAG_DISTANCE_PX ** 2;

      dragTarget = null;
      startPixel = null;
      maximumPixelDistanceSquared = 0;
      isDragging = false;
      callbacks.onHover(null, null);
      updateRouteEditCursor(event.map, null, false);
      callbacks.onEnd(
        releasedTarget,
        [...event.coordinate],
        didDrag,
        [...event.pixel],
      );
      return false;
    },
    stopDown: (handled) => handled,
  });
}

/** Removes cursor state if route editing is left during an active drag. */
export function clearRouteDragCursor(map: Map): void {
  updateRouteEditCursor(map, null, false);
}

/**
 * Rebuilds the small route layer from immutable route steps.
 *
 * Keeping history outside OpenLayers makes undo and redo independent from
 * mutable features. Each committed state stores exact generated geometry, so
 * redo does not repeat network requests and cannot produce a different route.
 *
 * @param display - OpenLayers route resources to update in place.
 * @param steps - Current ordered route steps.
 * @param closure - Optional final section from the last waypoint to the first.
 * @param activeWaypointIndex - Optional waypoint highlighted during a drag preview.
 */
export function updateRouteDisplay(
  display: RouteDisplay,
  steps: RouteStep[],
  closure: RouteClosure | null = null,
  activeWaypointIndex: number | null = null,
): void {
  const features: Feature[] = [];
  const routeCoordinates = collectRouteCoordinates(steps, closure);

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

  const finishCoordinate =
    steps.length >= 2
      ? closure
        ? steps[0].waypoint
        : steps[steps.length - 1].waypoint
      : null;
  const endpointFeatures = createItineraryEndpointFeatures(
    steps[0]?.waypoint ?? null,
    finishCoordinate,
    closure !== null && steps.length >= 2,
  );

  endpointFeatures.forEach((endpointFeature) => {
    const role = endpointFeature.get(
      ITINERARY_ENDPOINT_ROLE_PROPERTY,
    ) as ItineraryEndpointRole;
    endpointFeature.set(
      ROUTE_WAYPOINT_INDEX_PROPERTY,
      role === 'finish' ? steps.length - 1 : 0,
    );
    features.push(endpointFeature);
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
  closure: RouteClosure | null,
  waypointIndex: number,
  coordinate: Coordinate,
): void {
  if (waypointIndex < 0 || waypointIndex >= steps.length) {
    updateRouteDisplay(display, steps, closure);
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

  let previewClosure = closure;

  if (
    closure &&
    steps.length >= 2 &&
    (waypointIndex === 0 || waypointIndex === steps.length - 1)
  ) {
    const firstWaypoint =
      waypointIndex === 0 ? previewCoordinate : previewSteps[0].waypoint;
    const lastWaypoint =
      waypointIndex === steps.length - 1
        ? previewCoordinate
        : previewSteps[previewSteps.length - 1].waypoint;

    previewClosure = {
      ...closure,
      segment: [[...lastWaypoint], [...firstWaypoint]],
    };
  }

  updateRouteDisplay(
    display,
    previewSteps,
    previewClosure,
    waypointIndex,
  );
}

/**
 * Draws a temporary inserted waypoint while a route section is pulled.
 *
 * The selected incoming section is replaced by two straight preview sections.
 * Immutable history and the exact stored geometry remain untouched until the
 * application completes routing after release.
 */
export function updateRouteInsertionDragPreview(
  display: RouteDisplay,
  steps: RouteStep[],
  closure: RouteClosure | null,
  stepIndex: number,
  coordinate: Coordinate,
): void {
  const insertedCoordinate: Coordinate = [...coordinate];

  if (stepIndex === steps.length && closure && steps.length >= 2) {
    const previousStep = steps[steps.length - 1];
    const firstStep = steps[0];
    const insertedStep: RouteStep = {
      waypoint: insertedCoordinate,
      segment: [[...previousStep.waypoint], insertedCoordinate],
      mode: closure.mode,
    };
    const previewSteps = [...steps, insertedStep];
    const previewClosure: RouteClosure = {
      ...closure,
      segment: [insertedCoordinate, [...firstStep.waypoint]],
    };

    updateRouteDisplay(
      display,
      previewSteps,
      previewClosure,
      steps.length,
    );
    return;
  }

  const destinationStep = steps[stepIndex];
  const previousStep = steps[stepIndex - 1];

  if (!destinationStep || !previousStep || stepIndex < 1) {
    updateRouteDisplay(display, steps, closure);
    return;
  }

  const insertedStep: RouteStep = {
    waypoint: insertedCoordinate,
    segment: [[...previousStep.waypoint], insertedCoordinate],
    mode: destinationStep.mode,
  };
  const updatedDestinationStep: RouteStep = {
    ...destinationStep,
    segment: [insertedCoordinate, [...destinationStep.waypoint]],
  };
  const previewSteps = [
    ...steps.slice(0, stepIndex),
    insertedStep,
    updatedDestinationStep,
    ...steps.slice(stepIndex + 1),
  ];

  updateRouteDisplay(
    display,
    previewSteps,
    closure,
    stepIndex,
  );
}

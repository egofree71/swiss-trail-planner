/**
 * Business context: coordinates the map-centred application shell and owns the
 * imperative OpenLayers lifecycle. It connects search, geolocation, fullscreen,
 * route history, official information-layer inspection, dynamic swissTLM3D
 * loading, and route-editing controls while keeping provider/network details
 * in dedicated modules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from 'ol/coordinate.js';
import Map from 'ol/Map.js';
import MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type { Pixel } from 'ol/pixel.js';
import View from 'ol/View.js';
import { defaults as defaultControls, ScaleLine } from 'ol/control.js';
import { containsCoordinate } from 'ol/extent.js';
import TileLayer from 'ol/layer/Tile.js';
import type TileWMS from 'ol/source/TileWMS.js';
import type WMTS from 'ol/source/WMTS.js';
import MapLayersSelector from './components/MapLayersSelector';
import LanguageSelector from './components/LanguageSelector';
import LocationSearch from './components/LocationSearch';
import RouteImportControl from './components/RouteImportControl';
import RouteControls from './components/RouteControls';
import RouteExportDialog from './components/RouteExportDialog';
import PublicTransportStopPopup from './components/PublicTransportStopPopup';
import ShootingDangerZonePopup, {
  type ShootingDangerZonePopupStatus,
} from './components/ShootingDangerZonePopup';
import TrailClosurePopup, {
  type TrailClosurePopupStatus,
} from './components/TrailClosurePopup';
import RouteStatistics, {
  type RouteElevationStatus,
} from './components/RouteStatistics';
import {
  fetchTrailClosurePopup,
  identifyTrailClosure,
  createTrailClosuresSource,
} from './closures/trailClosures';
import {
  createShootingDangerZoneSelectionDisplay,
  createShootingDangerZonesSource,
  fetchShootingDangerZonePopup,
  identifyShootingDangerZone,
  type ShootingDangerZoneSelectionDisplay,
  updateShootingDangerZoneSelection,
} from './dangers/shootingDangerZones';
import {
  createPublicTransportStopsDisplay,
  getPublicTransportStopFromFeature,
  loadPublicTransportStops,
  PUBLIC_TRANSPORT_STOPS_MIN_ZOOM,
  type PublicTransportStop,
  type PublicTransportStopsDisplay,
  updatePublicTransportStopsDisplay,
  updatePublicTransportStopSelection,
} from './transport/publicTransportStops';
import { downloadRouteGpx } from './export/gpx';
import {
  GpxImportError,
  MAX_GPX_FILE_SIZE_BYTES,
  parseGpxRoute,
} from './import/gpx';
import { useI18n } from './i18n/I18nContext';
import {
  createBaseMapSource,
  createGrayDetailMapSource,
  createHikingTrailsSource,
  DEFAULT_BASE_MAP_STYLE,
  DEFAULT_MAP_CENTER,
  GRAY_DETAIL_MIN_ZOOM,
  HIKING_TRAILS_MIN_ZOOM,
  IMPORTED_ROUTE_MAX_ZOOM,
  LOCATION_SEARCH_ZOOM,
  MAP_EXTENT,
  MAP_ZOOM,
  USER_LOCATION_ZOOM,
  type BaseMapStyle,
} from './map/config';
import {
  fromWgs84,
  LV95_VIEW_RESOLUTIONS,
  MAP_PROJECTION_CODE,
} from './map/projection';
import {
  createImportedRouteDisplay,
  type ImportedRouteDisplay,
  updateImportedRouteDisplay,
} from './map/importedRoute';
import {
  clearRouteDragCursor,
  collectRouteCoordinates,
  createRouteDragInteraction,
  createRouteDisplay,
  getRouteWaypointIndexAtPixel,
  reverseRouteState,
  type RouteClosure,
  type RouteDragTarget,
  type RouteDisplay,
  type RouteHoverTarget,
  type RouteMode,
  type RouteState,
  type RouteStep,
  updateRouteDisplay,
  updateRouteInsertionDragPreview,
  updateRouteWaypointDragPreview,
} from './map/route';
import {
  createSearchResultMarker,
  type SearchResultMarker,
  updateSearchResultMarker,
} from './map/searchResult';
import {
  createRouteProfileMarker,
  createRouteProfilePositionIndex,
  getRouteProfileCoordinate,
  type RouteProfileMarker,
  updateRouteProfileMarker,
} from './map/routeProfileMarker';
import {
  createUserLocationMarker,
  type UserLocationMarker,
  updateUserLocationMarker,
} from './map/userLocation';
import {
  DynamicRoutingNetworkLoader,
  RoutingAreaTooLargeError,
} from './routing/dynamicRoutingNetwork';
import {
  calculateRouteSegmentsDistance,
  createImportedRouteElevationSummary,
  estimateHikingDuration,
  fetchRouteElevationSummary,
  fetchRouteSegmentsElevationSummary,
  type RouteElevationSummary,
} from './metrics/routeMetrics';
import type { LocationSearchResult } from './search/locationSearch';

/** Base-map loading state used by the blocking startup card. */
type LoadStatus = 'loading' | 'ready' | 'error';
/** Browser geolocation state used by the location control and its feedback. */
type LocationStatus = 'idle' | 'locating' | 'located' | 'error';
/** Severity of a temporary route-editing message. */
type RouteMessageType = 'info' | 'error';

/** Immutable undo/redo state for route editing. */
interface RouteHistory extends RouteState {
  /** Complete prior route states stored in chronological order. */
  undoStates: RouteState[];
  /** Complete undone route states stored in reverse restoration order. */
  redoStates: RouteState[];
}

/** Contextual route-editing label shown only for hover-capable pointers. */
interface RouteContextHint {
  /** Route element currently below a hover-capable pointer. */
  target: RouteHoverTarget;
  /** Clamped horizontal position inside the map container. */
  left: number;
  /** Pointer-relative vertical position inside the map container. */
  top: number;
  /** Places the label below the pointer when there is no room above it. */
  below: boolean;
}

/** Route pointer release that must not append a new endpoint through `singleclick`. */
interface RouteInteractionRelease {
  pixel: Pixel;
  expiresAt: number;
}

/** Imperative route drag session kept outside React renders for responsiveness. */
type RouteDragState =
  | {
      /** Existing waypoint being moved. */
      type: 'waypoint';
      waypointIndex: number;
      /** Original waypoint coordinate used to ignore click-only interactions. */
      startCoordinate: Coordinate;
      /** Route state that owns the preview and must still be current on release. */
      expectedState: RouteState;
    }
  | {
      /** Incoming section split by the new waypoint. */
      type: 'segment';
      stepIndex: number;
      /** Closest original line coordinate used to require a genuine drag. */
      startCoordinate: Coordinate;
      /** Route state that owns the preview and must still be current on release. */
      expectedState: RouteState;
    };

/** Returns the immutable route portion of a history entry without its stacks. */
function getRouteState(history: RouteHistory): RouteState {
  return {
    steps: history.steps,
    closure: history.closure,
  };
}

/** Checks whether an asynchronous edit still owns the displayed route state. */
function routeStateMatches(
  history: RouteHistory,
  expectedState: RouteState,
): boolean {
  return (
    history.steps === expectedState.steps &&
    history.closure === expectedState.closure
  );
}

/** Duration in milliseconds for transient geolocation feedback. */
const LOCATION_MESSAGE_DURATION_MS = 6_000;
/** Duration in milliseconds for actionable route errors before auto-dismissal. */
const ROUTE_MESSAGE_DURATION_MS = 7_000;
/** Squared distance in square map units below which a route connector is unnecessary. */
const ROUTE_CONNECTOR_DISTANCE_SQUARED = 0.01;
/** Minimum one-metre waypoint movement needed before recalculation begins. */
const ROUTE_WAYPOINT_MOVE_DISTANCE_SQUARED = 1;
/** Delay during which a click already handled by route editing is ignored. */
const ROUTE_INTERACTION_CLICK_SUPPRESSION_MS = 500;
/** Pixel tolerance for matching the delayed OpenLayers `singleclick`. */
const ROUTE_INTERACTION_CLICK_TOLERANCE_PX = 8;
/** Estimated half-width used to keep contextual guidance inside the viewport. */
const ROUTE_CONTEXT_HINT_HALF_WIDTH_PX = 190;
/** Delay in milliseconds before requesting elevations after a route mutation. */
const ELEVATION_REQUEST_DEBOUNCE_MS = 250;
/** Browser preference key for the rendered hiking-trail overlay. */
const HIKING_TRAILS_VISIBILITY_STORAGE_KEY =
  'swiss-trail-planner.hiking-trails-visible';
/** Browser preference key for the safety-information overlay. */
const TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY =
  'swiss-trail-planner.trail-closures-visible';
/** Browser preference key for the military danger-zone overlay. */
const SHOOTING_DANGER_ZONES_VISIBILITY_STORAGE_KEY =
  'swiss-trail-planner.shooting-danger-zones-visible';
/** Browser preference key for the optional public-transport stop overlay. */
const PUBLIC_TRANSPORT_STOPS_VISIBILITY_STORAGE_KEY =
  'swiss-trail-planner.public-transport-stops-visible';

/** Restores the hiking-trail preference, which is enabled by default. */
function getInitialHikingTrailsVisibility(): boolean {
  try {
    return (
      window.localStorage.getItem(
        HIKING_TRAILS_VISIBILITY_STORAGE_KEY,
      ) !== 'false'
    );
  } catch {
    return true;
  }
}

/**
 * Restores the explicit closure-layer preference. Safety information is shown
 * by default when no choice has been stored yet.
 */
function getInitialTrailClosuresVisibility(): boolean {
  try {
    return (
      window.localStorage.getItem(
        TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY,
      ) !== 'false'
    );
  } catch {
    return true;
  }
}

/**
 * Restores the explicit danger-zone preference. Published military shooting
 * areas are safety information and are therefore shown by default.
 */
function getInitialShootingDangerZonesVisibility(): boolean {
  try {
    return (
      window.localStorage.getItem(
        SHOOTING_DANGER_ZONES_VISIBILITY_STORAGE_KEY,
      ) !== 'false'
    );
  } catch {
    return true;
  }
}

/**
 * Restores the explicit stop-layer preference. Stops remain hidden by default
 * because their dense point symbols are an optional planning aid.
 */
function getInitialPublicTransportStopsVisibility(): boolean {
  try {
    return (
      window.localStorage.getItem(
        PUBLIC_TRANSPORT_STOPS_VISIBILITY_STORAGE_KEY,
      ) === 'true'
    );
  } catch {
    return false;
  }
}

/**
 * Builds an unambiguous local timestamp for the proposed GPX name. The ISO-like
 * date order works consistently in every interface language, while the colon
 * remains readable inside the GPX and is sanitized only for the filename.
 */
function createRouteExportDefaultName(baseName: string, date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  return `${baseName} — ${datePart} ${timePart}`;
}

/** Returns squared horizontal distance in map units for inexpensive continuity checks. */
function coordinateDistanceSquared(
  first: Coordinate,
  second: Coordinate,
): number {
  const deltaX = first[0] - second[0];
  const deltaY = first[1] - second[1];
  return deltaX * deltaX + deltaY * deltaY;
}

/** Identifies the normal cancellation path shared by abortable map requests. */
function isAbortedRequest(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

/**
 * Creates a freely placed waypoint and, when possible, a direct segment from
 * the previous route endpoint.
 */
function createStraightRouteStep(
  previousStep: RouteStep | undefined,
  coordinate: Coordinate,
): RouteStep {
  const waypoint: Coordinate = [...coordinate];

  return {
    waypoint,
    segment: previousStep
      ? [[...previousStep.waypoint], waypoint]
      : null,
    mode: 'straight',
  };
}

/** Adds an exact endpoint connector when network snapping leaves a small gap. */
function connectRoutedSegmentEndpoint(
  segment: Coordinate[],
  coordinate: Coordinate,
  position: 'start' | 'end',
): void {
  const endpoint = position === 'start' ? segment[0] : segment[segment.length - 1];

  if (
    coordinateDistanceSquared(coordinate, endpoint) <=
    ROUTE_CONNECTOR_DISTANCE_SQUARED
  ) {
    return;
  }

  if (position === 'start') {
    segment.unshift([...coordinate]);
  } else {
    segment.push([...coordinate]);
  }
}

/** Creates a direct loop-closing section between the last and first waypoints. */
function createStraightRouteClosure(steps: RouteStep[]): RouteClosure | null {
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];

  if (!firstStep || !lastStep || steps.length < 2) {
    return null;
  }

  return {
    segment: [[...lastStep.waypoint], [...firstStep.waypoint]],
    mode: 'straight',
  };
}

/** Resolves one section whose start and end waypoints must remain exact. */
async function rebuildFixedRouteSection(
  startCoordinate: Coordinate,
  endCoordinate: Coordinate,
  intendedMode: RouteMode,
  routingLoader: DynamicRoutingNetworkLoader,
  signal: AbortSignal,
): Promise<RouteClosure> {
  if (intendedMode === 'network') {
    const routedPath = await routingLoader.route(
      startCoordinate,
      endCoordinate,
      signal,
    );

    if (routedPath && routedPath.coordinates.length >= 2) {
      const segment = routedPath.coordinates.map(
        (coordinate): Coordinate => [...coordinate],
      );
      connectRoutedSegmentEndpoint(segment, startCoordinate, 'start');
      connectRoutedSegmentEndpoint(segment, endCoordinate, 'end');

      return {
        segment,
        mode: 'network',
      };
    }
  }

  return {
    segment: [[...startCoordinate], [...endCoordinate]],
    mode: 'straight',
  };
}

/**
 * Recalculates only the sections adjacent to a moved waypoint.
 *
 * A closed route also recalculates its dedicated final section when the first
 * or last waypoint moves. All unrelated sections retain their exact geometry.
 */
async function rebuildRouteAfterWaypointMove(
  state: RouteState,
  waypointIndex: number,
  targetCoordinate: Coordinate,
  routingLoader: DynamicRoutingNetworkLoader,
  signal: AbortSignal,
): Promise<RouteState> {
  const { steps, closure } = state;
  const nextSteps = steps.slice();
  const originalStep = steps[waypointIndex];

  if (!originalStep) {
    return state;
  }

  let movedWaypoint: Coordinate;

  if (waypointIndex === 0) {
    const shouldSnapFirstWaypoint =
      originalStep.mode === 'network' ||
      closure?.mode === 'network' ||
      steps[1]?.mode === 'network';

    if (shouldSnapFirstWaypoint) {
      const snappedCoordinate = await routingLoader.snap(
        targetCoordinate,
        signal,
      );

      if (snappedCoordinate) {
        movedWaypoint = [...snappedCoordinate];
        nextSteps[0] = {
          ...originalStep,
          waypoint: movedWaypoint,
          segment: null,
          mode: 'network',
        };
      } else {
        movedWaypoint = [...targetCoordinate];
        nextSteps[0] = {
          ...originalStep,
          waypoint: movedWaypoint,
          segment: null,
          mode: 'straight',
        };
      }
    } else {
      movedWaypoint = [...targetCoordinate];
      nextSteps[0] = {
        ...originalStep,
        waypoint: movedWaypoint,
        segment: null,
      };
    }
  } else {
    const previousStep = steps[waypointIndex - 1];

    if (originalStep.mode === 'network') {
      const routedPath = await routingLoader.route(
        previousStep.waypoint,
        targetCoordinate,
        signal,
      );

      if (routedPath && routedPath.coordinates.length >= 2) {
        const segment = routedPath.coordinates.map(
          (coordinate): Coordinate => [...coordinate],
        );
        connectRoutedSegmentEndpoint(
          segment,
          previousStep.waypoint,
          'start',
        );
        movedWaypoint = [...segment[segment.length - 1]];
        nextSteps[waypointIndex] = {
          ...originalStep,
          waypoint: movedWaypoint,
          segment,
          mode: 'network',
        };
      } else {
        movedWaypoint = [...targetCoordinate];
        nextSteps[waypointIndex] = createStraightRouteStep(
          previousStep,
          movedWaypoint,
        );
      }
    } else {
      movedWaypoint = [...targetCoordinate];
      nextSteps[waypointIndex] = createStraightRouteStep(
        previousStep,
        movedWaypoint,
      );
    }
  }

  const nextStep = steps[waypointIndex + 1];

  if (nextStep) {
    const rebuiltSection = await rebuildFixedRouteSection(
      movedWaypoint,
      nextStep.waypoint,
      nextStep.mode,
      routingLoader,
      signal,
    );
    nextSteps[waypointIndex + 1] = {
      ...nextStep,
      segment: rebuiltSection.segment,
      mode: rebuiltSection.mode,
    };
  }

  let nextClosure = closure;

  if (
    closure &&
    steps.length >= 2 &&
    (waypointIndex === 0 || waypointIndex === steps.length - 1)
  ) {
    nextClosure = await rebuildFixedRouteSection(
      nextSteps[nextSteps.length - 1].waypoint,
      nextSteps[0].waypoint,
      closure.mode,
      routingLoader,
      signal,
    );
  }

  return {
    steps: nextSteps,
    closure: nextClosure,
  };
}

/**
 * Splits one normal or loop-closing section by inserting a dragged waypoint.
 * Both halves inherit the selected section's routing intent and may fall back
 * independently to straight geometry.
 */
async function rebuildRouteAfterWaypointInsertion(
  state: RouteState,
  stepIndex: number,
  targetCoordinate: Coordinate,
  routingLoader: DynamicRoutingNetworkLoader,
  signal: AbortSignal,
): Promise<RouteState> {
  const { steps, closure } = state;

  if (stepIndex === steps.length && closure && steps.length >= 2) {
    const previousStep = steps[steps.length - 1];
    let insertedStep: RouteStep;

    if (closure.mode === 'network') {
      const routedPath = await routingLoader.route(
        previousStep.waypoint,
        targetCoordinate,
        signal,
      );

      if (routedPath && routedPath.coordinates.length >= 2) {
        const segment = routedPath.coordinates.map(
          (coordinate): Coordinate => [...coordinate],
        );
        connectRoutedSegmentEndpoint(
          segment,
          previousStep.waypoint,
          'start',
        );
        insertedStep = {
          waypoint: [...segment[segment.length - 1]],
          segment,
          mode: 'network',
        };
      } else {
        insertedStep = createStraightRouteStep(
          previousStep,
          targetCoordinate,
        );
      }
    } else {
      insertedStep = createStraightRouteStep(previousStep, targetCoordinate);
    }

    const nextClosure = await rebuildFixedRouteSection(
      insertedStep.waypoint,
      steps[0].waypoint,
      closure.mode,
      routingLoader,
      signal,
    );

    return {
      steps: [...steps, insertedStep],
      closure: nextClosure,
    };
  }

  const destinationStep = steps[stepIndex];
  const previousStep = steps[stepIndex - 1];

  if (!destinationStep || !previousStep || stepIndex < 1) {
    return state;
  }

  let insertedStep: RouteStep;

  if (destinationStep.mode === 'network') {
    const routedPath = await routingLoader.route(
      previousStep.waypoint,
      targetCoordinate,
      signal,
    );

    if (routedPath && routedPath.coordinates.length >= 2) {
      const segment = routedPath.coordinates.map(
        (coordinate): Coordinate => [...coordinate],
      );
      connectRoutedSegmentEndpoint(segment, previousStep.waypoint, 'start');
      insertedStep = {
        waypoint: [...segment[segment.length - 1]],
        segment,
        mode: 'network',
      };
    } else {
      insertedStep = createStraightRouteStep(
        previousStep,
        targetCoordinate,
      );
    }
  } else {
    insertedStep = createStraightRouteStep(previousStep, targetCoordinate);
  }

  const rebuiltDestinationSection = await rebuildFixedRouteSection(
    insertedStep.waypoint,
    destinationStep.waypoint,
    destinationStep.mode,
    routingLoader,
    signal,
  );
  const updatedDestinationStep: RouteStep = {
    ...destinationStep,
    segment: rebuiltDestinationSection.segment,
    mode: rebuiltDestinationSection.mode,
  };

  return {
    steps: [
      ...steps.slice(0, stepIndex),
      insertedStep,
      updatedDestinationStep,
      ...steps.slice(stepIndex + 1),
    ],
    closure,
  };
}

/**
 * Removes one waypoint and reconnects its neighbours when necessary.
 * Closed-route endpoint deletion rebuilds the loop around the remaining points.
 */
async function rebuildRouteAfterWaypointDeletion(
  state: RouteState,
  waypointIndex: number,
  routingLoader: DynamicRoutingNetworkLoader,
  signal: AbortSignal,
): Promise<RouteState> {
  const { steps, closure } = state;

  if (waypointIndex < 0 || waypointIndex >= steps.length) {
    return state;
  }

  if (steps.length === 1) {
    return {
      steps: [],
      closure: null,
    };
  }

  if (closure && steps.length === 2) {
    const remainingStep = steps[waypointIndex === 0 ? 1 : 0];

    return {
      steps: [
        {
          ...remainingStep,
          waypoint: [...remainingStep.waypoint],
          segment: null,
        },
      ],
      closure: null,
    };
  }

  if (waypointIndex === 0) {
    const nextFirstStep = steps[1];
    const nextSteps = [
      {
        ...nextFirstStep,
        waypoint: [...nextFirstStep.waypoint],
        segment: null,
      },
      ...steps.slice(2),
    ];

    if (!closure) {
      return {
        steps: nextSteps,
        closure: null,
      };
    }

    const intendedMode: RouteMode =
      closure.mode === 'network' || nextFirstStep.mode === 'network'
        ? 'network'
        : 'straight';
    const nextClosure = await rebuildFixedRouteSection(
      nextSteps[nextSteps.length - 1].waypoint,
      nextSteps[0].waypoint,
      intendedMode,
      routingLoader,
      signal,
    );

    return {
      steps: nextSteps,
      closure: nextClosure,
    };
  }

  if (waypointIndex === steps.length - 1) {
    const nextSteps = steps.slice(0, -1);

    if (!closure) {
      return {
        steps: nextSteps,
        closure: null,
      };
    }

    const removedStep = steps[waypointIndex];
    const intendedMode: RouteMode =
      closure.mode === 'network' || removedStep.mode === 'network'
        ? 'network'
        : 'straight';
    const nextClosure = await rebuildFixedRouteSection(
      nextSteps[nextSteps.length - 1].waypoint,
      nextSteps[0].waypoint,
      intendedMode,
      routingLoader,
      signal,
    );

    return {
      steps: nextSteps,
      closure: nextClosure,
    };
  }

  const previousStep = steps[waypointIndex - 1];
  const removedStep = steps[waypointIndex];
  const destinationStep = steps[waypointIndex + 1];
  const intendedMode: RouteMode =
    removedStep.mode === 'network' || destinationStep.mode === 'network'
      ? 'network'
      : 'straight';
  const rebuiltDestinationSection = await rebuildFixedRouteSection(
    previousStep.waypoint,
    destinationStep.waypoint,
    intendedMode,
    routingLoader,
    signal,
  );
  const updatedDestinationStep: RouteStep = {
    ...destinationStep,
    segment: rebuiltDestinationSection.segment,
    mode: rebuiltDestinationSection.mode,
  };

  return {
    steps: [
      ...steps.slice(0, waypointIndex),
      updatedDestinationStep,
      ...steps.slice(waypointIndex + 2),
    ],
    closure,
  };
}

/** Root application component and sole owner of the OpenLayers Map instance. */
export default function App() {
  const { language, t } = useI18n();
  const appRef = useRef<HTMLElement>(null);
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const baseMapLayerRef = useRef<TileLayer<WMTS> | null>(null);
  const grayDetailLayerRef = useRef<TileLayer<WMTS> | null>(null);
  const hikingTrailsLayerRef = useRef<TileLayer<WMTS> | null>(null);
  const trailClosuresLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const shootingDangerZonesLayerRef =
    useRef<TileLayer<TileWMS> | null>(null);
  const shootingDangerZoneSelectionDisplayRef =
    useRef<ShootingDangerZoneSelectionDisplay | null>(null);
  const publicTransportStopsDisplayRef =
    useRef<PublicTransportStopsDisplay | null>(null);
  const activeBaseMapStyleRef = useRef<BaseMapStyle>(
    DEFAULT_BASE_MAP_STYLE,
  );
  const userLocationMarkerRef = useRef<UserLocationMarker | null>(null);
  const searchResultMarkerRef = useRef<SearchResultMarker | null>(null);
  const routeDisplayRef = useRef<RouteDisplay | null>(null);
  const importedRouteDisplayRef = useRef<ImportedRouteDisplay | null>(null);
  const routeProfileMarkerRef = useRef<RouteProfileMarker | null>(null);
  const locationMessageTimerRef = useRef<number | null>(null);
  const routeMessageTimerRef = useRef<number | null>(null);
  const routeHistoryRef = useRef<RouteHistory>({
    steps: [],
    closure: null,
    undoStates: [],
    redoStates: [],
  });
  const routeDragStateRef = useRef<RouteDragState | null>(null);
  const routeInteractionReleaseRef =
    useRef<RouteInteractionRelease | null>(null);
  const routeCreationActiveRef = useRef(false);
  const routeCreationSessionRef = useRef(0);
  const routeOperationPendingRef = useRef(false);
  const routingLoaderRef = useRef<DynamicRoutingNetworkLoader | null>(null);
  const routingAbortControllerRef = useRef<AbortController | null>(null);
  const routeImportSessionRef = useRef(0);
  const mapInformationRequestRef = useRef<AbortController | null>(null);

  if (!routingLoaderRef.current) {
    routingLoaderRef.current = new DynamicRoutingNetworkLoader();
  }

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>('idle');
  const [locationMessage, setLocationMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRouteExportDialogOpen, setIsRouteExportDialogOpen] =
    useState(false);
  const [routeExportDefaultName, setRouteExportDefaultName] = useState('');
  const [baseMapStyle, setBaseMapStyle] = useState<BaseMapStyle>(
    DEFAULT_BASE_MAP_STYLE,
  );
  const [areHikingTrailsVisible, setAreHikingTrailsVisible] =
    useState(getInitialHikingTrailsVisibility);
  const [areTrailClosuresVisible, setAreTrailClosuresVisible] =
    useState(getInitialTrailClosuresVisibility);
  const [areShootingDangerZonesVisible, setAreShootingDangerZonesVisible] =
    useState(getInitialShootingDangerZonesVisibility);
  const [arePublicTransportStopsVisible, setArePublicTransportStopsVisible] =
    useState(getInitialPublicTransportStopsVisibility);
  const [trailClosurePopup, setTrailClosurePopup] =
    useState<TrailClosurePopupStatus | null>(null);
  const [shootingDangerZonePopup, setShootingDangerZonePopup] =
    useState<ShootingDangerZonePopupStatus | null>(null);
  const [publicTransportStopPopup, setPublicTransportStopPopup] =
    useState<PublicTransportStop | null>(null);
  const [isRouteCreationActive, setIsRouteCreationActive] = useState(false);
  const [isRouteSnapEnabled, setIsRouteSnapEnabled] = useState(true);
  const [isRouteOperationPending, setIsRouteOperationPending] =
    useState(false);
  const [routeMessage, setRouteMessage] = useState('');
  const [routeMessageType, setRouteMessageType] =
    useState<RouteMessageType>('info');
  const [routeContextHint, setRouteContextHint] =
    useState<RouteContextHint | null>(null);
  const [routeHistory, setRouteHistory] = useState<RouteHistory>(
    routeHistoryRef.current,
  );
  const [routeElevationStatus, setRouteElevationStatus] =
    useState<RouteElevationStatus>('loading');
  const [routeElevation, setRouteElevation] =
    useState<RouteElevationSummary | null>(null);
  const [importedRouteSegments, setImportedRouteSegments] = useState<
    Coordinate[][]
  >([]);
  const [importedRouteElevationSummary, setImportedRouteElevationSummary] =
    useState<RouteElevationSummary | null>(null);
  const routeCoordinates = useMemo(
    () => collectRouteCoordinates(routeHistory.steps, routeHistory.closure),
    [routeHistory.steps, routeHistory.closure],
  );
  const activeRouteSegments = useMemo(
    () =>
      routeCoordinates.length >= 2
        ? [routeCoordinates]
        : importedRouteSegments,
    [importedRouteSegments, routeCoordinates],
  );
  const routeProfilePositionIndex = useMemo(
    () => createRouteProfilePositionIndex(activeRouteSegments),
    [activeRouteSegments],
  );
  const routeDistanceMeters = useMemo(
    () => calculateRouteSegmentsDistance(activeRouteSegments),
    [activeRouteSegments],
  );
  const routeDurationMinutes = routeElevation
    ? estimateHikingDuration(routeElevation.points)
    : null;

  /** Keeps the map marker synchronized with cumulative distance under the chart pointer. */
  const handleProfileHoverDistanceChange = useCallback(
    (distanceMeters: number | null) => {
      const marker = routeProfileMarkerRef.current;

      if (!marker) {
        return;
      }

      updateRouteProfileMarker(
        marker,
        distanceMeters === null
          ? null
          : getRouteProfileCoordinate(
              routeProfilePositionIndex,
              distanceMeters,
            ),
      );
    },
    [routeProfilePositionIndex],
  );

  /** Closes any information-layer metadata and cancels its active request. */
  const closeMapInformationPopup = useCallback(() => {
    mapInformationRequestRef.current?.abort();
    mapInformationRequestRef.current = null;
    setTrailClosurePopup(null);
    setShootingDangerZonePopup(null);
    setPublicTransportStopPopup(null);
    const stopDisplay = publicTransportStopsDisplayRef.current;
    const dangerZoneSelection =
      shootingDangerZoneSelectionDisplayRef.current;

    if (stopDisplay) {
      updatePublicTransportStopSelection(stopDisplay, null);
    }

    if (dangerZoneSelection) {
      updateShootingDangerZoneSelection(dangerZoneSelection, null);
    }
  }, []);

  /**
   * Keeps the synchronous ref and React render state on the same immutable
   * history object.
   */
  const commitRouteHistory = (history: RouteHistory) => {
    routeHistoryRef.current = history;
    setRouteHistory(history);

    // Elevations belong to the previous immutable geometry until the debounced
    // profile request completes for this new history state.
    setRouteElevation(null);
    setRouteElevationStatus('loading');
  };

  /** Records one complete route mutation and clears obsolete redo states. */
  const commitRouteMutation = (nextState: RouteState) => {
    const currentHistory = routeHistoryRef.current;

    commitRouteHistory({
      ...nextState,
      undoStates: [
        ...currentHistory.undoStates,
        getRouteState(currentHistory),
      ],
      redoStates: [],
    });
  };

  /**
   * Commits an asynchronous route mutation only if its captured state and
   * editing session are still current.
   */
  const commitAsyncRouteMutation = (
    expectedState: RouteState,
    nextState: RouteState,
  ): boolean => {
    const currentHistory = routeHistoryRef.current;

    if (
      !routeStateMatches(currentHistory, expectedState) ||
      !routeCreationActiveRef.current
    ) {
      return false;
    }

    commitRouteMutation(nextState);
    return true;
  };

  /** Appends one generated route step as a normal undoable mutation. */
  const appendRouteStep = (
    expectedState: RouteState,
    step: RouteStep,
  ): boolean =>
    commitAsyncRouteMutation(expectedState, {
      steps: [...expectedState.steps, step],
      closure: null,
    });

  /** Restores the complete route state preceding the latest edit. */
  const undoRoutePoint = () => {
    if (routeOperationPendingRef.current) {
      return;
    }

    const currentHistory = routeHistoryRef.current;

    if (currentHistory.undoStates.length === 0) {
      return;
    }

    const previousState =
      currentHistory.undoStates[currentHistory.undoStates.length - 1];

    commitRouteHistory({
      ...previousState,
      undoStates: currentHistory.undoStates.slice(0, -1),
      redoStates: [
        ...currentHistory.redoStates,
        getRouteState(currentHistory),
      ],
    });
  };

  /** Restores the complete route state removed by the latest undo. */
  const redoRoutePoint = () => {
    if (routeOperationPendingRef.current) {
      return;
    }

    const currentHistory = routeHistoryRef.current;

    if (currentHistory.redoStates.length === 0) {
      return;
    }

    const restoredState =
      currentHistory.redoStates[currentHistory.redoStates.length - 1];

    commitRouteHistory({
      ...restoredState,
      undoStates: [
        ...currentHistory.undoStates,
        getRouteState(currentHistory),
      ],
      redoStates: currentHistory.redoStates.slice(0, -1),
    });
  };

  /** Reverses the exact open or closed geometry as one undoable route edit. */
  const reverseRoute = () => {
    if (routeOperationPendingRef.current) {
      return;
    }

    const currentHistory = routeHistoryRef.current;

    if (currentHistory.steps.length < 2) {
      return;
    }

    commitRouteMutation(reverseRouteState(getRouteState(currentHistory)));
  };

  /** Closes an open route or removes its dedicated closing section. */
  const toggleRouteLoop = () => {
    const currentHistory = routeHistoryRef.current;

    if (
      routeOperationPendingRef.current ||
      currentHistory.steps.length < 2
    ) {
      return;
    }

    const expectedState = getRouteState(currentHistory);

    if (expectedState.closure) {
      commitRouteMutation({
        steps: expectedState.steps,
        closure: null,
      });
      return;
    }

    if (!isRouteSnapEnabled) {
      commitRouteMutation({
        steps: expectedState.steps,
        closure: createStraightRouteClosure(expectedState.steps),
      });
      return;
    }

    const routeCreationSession = routeCreationSessionRef.current;
    routeOperationPendingRef.current = true;
    setIsRouteOperationPending(true);
    setRouteContextHint(null);

    const abortController = new AbortController();
    routingAbortControllerRef.current = abortController;

    void (async () => {
      clearRouteMessageTimer();
      setRouteMessage('');

      try {
        const routingLoader = routingLoaderRef.current;
        const firstStep = expectedState.steps[0];
        const lastStep = expectedState.steps[expectedState.steps.length - 1];

        if (!routingLoader || !firstStep || !lastStep) {
          throw new Error('The dynamic routing loader is unavailable.');
        }

        const closure = await rebuildFixedRouteSection(
          lastStep.waypoint,
          firstStep.waypoint,
          'network',
          routingLoader,
          abortController.signal,
        );

        if (
          routeCreationSessionRef.current !== routeCreationSession ||
          !routeStateMatches(routeHistoryRef.current, expectedState)
        ) {
          return;
        }

        commitAsyncRouteMutation(expectedState, {
          steps: expectedState.steps,
          closure,
        });
      } catch (error) {
        if (isAbortedRequest(error, abortController.signal)) {
          return;
        }

        if (routeCreationSessionRef.current !== routeCreationSession) {
          return;
        }

        if (error instanceof RoutingAreaTooLargeError) {
          showTemporaryRouteMessage(t('route.areaTooLarge'), 'error');
          return;
        }

        console.error('Unable to close the route loop.', error);
        showTemporaryRouteMessage(t('route.networkLoadError'), 'error');
      } finally {
        const ownsCurrentOperation =
          routingAbortControllerRef.current === abortController;

        if (ownsCurrentOperation) {
          routingAbortControllerRef.current = null;
          routeOperationPendingRef.current = false;
          setIsRouteOperationPending(false);
        }
      }
    })();
  };

  /** Clears the complete route and its edit history while keeping creation active. */
  const deleteRoute = () => {
    if (
      routeOperationPendingRef.current ||
      routeHistoryRef.current.steps.length === 0
    ) {
      return;
    }

    commitRouteHistory({
      steps: [],
      closure: null,
      undoStates: [],
      redoStates: [],
    });
    clearRouteMessageTimer();
    setRouteMessage('');
  };

  /** Opens the route-name dialog before any GPX content is generated. */
  const requestRouteExport = () => {
    if (
      routeOperationPendingRef.current ||
      routeHistoryRef.current.steps.length < 2
    ) {
      return;
    }

    setRouteExportDefaultName(
      createRouteExportDefaultName(t('gpx.routeName')),
    );
    setIsRouteExportDialogOpen(true);
  };

  /** Downloads the exact displayed route geometry under the chosen route name. */
  const exportRoute = (routeName: string) => {
    if (routeOperationPendingRef.current) {
      return;
    }

    try {
      downloadRouteGpx(
        routeHistoryRef.current.steps,
        routeName,
        routeElevation?.points ?? [],
        routeHistoryRef.current.closure,
      );
      setIsRouteExportDialogOpen(false);
    } catch (error) {
      console.error('Unable to export the route as GPX.', error);
      showTemporaryRouteMessage(
        t('route.exportError'),
        'error',
      );
    }
  };

  /**
   * Loads one GPX as the single current read-only itinerary and frames its full
   * extent. A successful import replaces the editable route and its history.
   */
  const importRouteFile = async (file: File) => {
    const map = mapRef.current;
    const display = importedRouteDisplayRef.current;

    if (!map || !display) {
      return;
    }

    const importSession = ++routeImportSessionRef.current;

    if (file.size > MAX_GPX_FILE_SIZE_BYTES) {
      showTemporaryRouteMessage(t('route.importTooLarge'), 'error');
      return;
    }

    try {
      const importedRoute = parseGpxRoute(await file.text(), file.name);

      // A slower previous file read must not replace a newer user selection.
      if (importSession !== routeImportSessionRef.current) {
        return;
      }

      const projectedSegments = importedRoute.segments.map((segment) =>
        segment.coordinates.map((coordinate) => fromWgs84(coordinate)),
      );
      let embeddedElevationSummary: RouteElevationSummary | null = null;

      if (
        importedRoute.segments.every(
          (segment) => segment.elevationsMeters !== null,
        )
      ) {
        try {
          embeddedElevationSummary = createImportedRouteElevationSummary(
            importedRoute.segments.map((segment, index) => ({
              coordinates: projectedSegments[index],
              elevationsMeters: segment.elevationsMeters ?? [],
            })),
          );
        } catch (error) {
          // Geometry remains usable when unusual embedded elevations cannot be measured.
          console.warn(
            'Unable to use GPX elevations; falling back to GeoAdmin.',
            error,
          );
        }
      }

      routingAbortControllerRef.current?.abort();
      routingAbortControllerRef.current = null;
      routeOperationPendingRef.current = false;
      routeCreationActiveRef.current = false;
      routeCreationSessionRef.current += 1;
      setIsRouteOperationPending(false);
      setIsRouteCreationActive(false);
      commitRouteHistory({
        steps: [],
        closure: null,
        undoStates: [],
        redoStates: [],
      });
      updateImportedRouteDisplay(display, projectedSegments);
      setImportedRouteSegments(projectedSegments);
      setImportedRouteElevationSummary(embeddedElevationSummary);
      clearRouteMessageTimer();
      setRouteMessage('');

      /*
       * Fitting the loaded geometry triggers the normal WMTS tile requests for
       * that location. A bottom margin leaves room for the imported itinerary statistics.
       */
      const importedExtent = display.source.getExtent();

      if (importedExtent) {
        map.getView().fit(importedExtent, {
          duration: 600,
          maxZoom: IMPORTED_ROUTE_MAX_ZOOM,
          padding: [80, 80, 180, 80],
        });
      }
    } catch (error) {
      if (importSession !== routeImportSessionRef.current) {
        return;
      }

      console.error('Unable to import the GPX route.', error);
      showTemporaryRouteMessage(t('route.importError'), 'error');
    }
  };

  const clearLocationMessageTimer = () => {
    if (locationMessageTimerRef.current !== null) {
      window.clearTimeout(locationMessageTimerRef.current);
      locationMessageTimerRef.current = null;
    }
  };

  const showTemporaryLocationMessage = (message: string) => {
    clearLocationMessageTimer();
    setLocationMessage(message);

    locationMessageTimerRef.current = window.setTimeout(() => {
      setLocationMessage('');
      locationMessageTimerRef.current = null;
    }, LOCATION_MESSAGE_DURATION_MS);
  };

  const clearRouteMessageTimer = () => {
    if (routeMessageTimerRef.current !== null) {
      window.clearTimeout(routeMessageTimerRef.current);
      routeMessageTimerRef.current = null;
    }
  };

  const setPersistentRouteMessage = (
    message: string,
    type: RouteMessageType = 'info',
  ) => {
    clearRouteMessageTimer();
    setRouteMessageType(type);
    setRouteMessage(message);
  };

  const showTemporaryRouteMessage = (
    message: string,
    type: RouteMessageType = 'info',
  ) => {
    setPersistentRouteMessage(message, type);

    routeMessageTimerRef.current = window.setTimeout(() => {
      setRouteMessage('');
      routeMessageTimerRef.current = null;
    }, ROUTE_MESSAGE_DURATION_MS);
  };

  /** Recalculates the one or two sections touching a released waypoint. */
  const moveRouteWaypoint = (
    dragState: Extract<RouteDragState, { type: 'waypoint' }>,
    targetCoordinate: Coordinate,
  ) => {
    if (
      routeOperationPendingRef.current ||
      !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
    ) {
      const display = routeDisplayRef.current;

      if (display) {
        updateRouteDisplay(
          display,
          routeHistoryRef.current.steps,
          routeHistoryRef.current.closure,
        );
      }
      return;
    }

    const routeCreationSession = routeCreationSessionRef.current;
    routeOperationPendingRef.current = true;
    setIsRouteOperationPending(true);
    setRouteContextHint(null);

    const abortController = new AbortController();
    routingAbortControllerRef.current = abortController;

    void (async () => {
      clearRouteMessageTimer();
      setRouteMessage('');

      try {
        const routingLoader = routingLoaderRef.current;

        if (!routingLoader) {
          throw new Error('The dynamic routing loader is unavailable.');
        }

        const nextState = await rebuildRouteAfterWaypointMove(
          dragState.expectedState,
          dragState.waypointIndex,
          targetCoordinate,
          routingLoader,
          abortController.signal,
        );

        if (
          routeCreationSessionRef.current !== routeCreationSession ||
          !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
        ) {
          return;
        }

        commitAsyncRouteMutation(dragState.expectedState, nextState);
      } catch (error) {
        if (isAbortedRequest(error, abortController.signal)) {
          return;
        }

        if (routeCreationSessionRef.current !== routeCreationSession) {
          return;
        }

        const display = routeDisplayRef.current;

        if (display) {
          updateRouteDisplay(
            display,
            routeHistoryRef.current.steps,
            routeHistoryRef.current.closure,
          );
        }

        if (error instanceof RoutingAreaTooLargeError) {
          showTemporaryRouteMessage(t('route.areaTooLarge'), 'error');
          return;
        }

        console.error('Unable to recalculate the moved route waypoint.', error);
        showTemporaryRouteMessage(t('route.networkLoadError'), 'error');
      } finally {
        const ownsCurrentOperation =
          routingAbortControllerRef.current === abortController;

        if (ownsCurrentOperation) {
          routingAbortControllerRef.current = null;
          routeOperationPendingRef.current = false;
          setIsRouteOperationPending(false);
        }
      }
    })();
  };

  /** Inserts one waypoint into a dragged route section as one undoable edit. */
  const insertRouteWaypoint = (
    dragState: Extract<RouteDragState, { type: 'segment' }>,
    targetCoordinate: Coordinate,
  ) => {
    if (
      routeOperationPendingRef.current ||
      !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
    ) {
      const display = routeDisplayRef.current;

      if (display) {
        updateRouteDisplay(
          display,
          routeHistoryRef.current.steps,
          routeHistoryRef.current.closure,
        );
      }
      return;
    }

    const routeCreationSession = routeCreationSessionRef.current;
    routeOperationPendingRef.current = true;
    setIsRouteOperationPending(true);
    setRouteContextHint(null);

    const abortController = new AbortController();
    routingAbortControllerRef.current = abortController;

    void (async () => {
      clearRouteMessageTimer();
      setRouteMessage('');

      try {
        const routingLoader = routingLoaderRef.current;

        if (!routingLoader) {
          throw new Error('The dynamic routing loader is unavailable.');
        }

        const nextState = await rebuildRouteAfterWaypointInsertion(
          dragState.expectedState,
          dragState.stepIndex,
          targetCoordinate,
          routingLoader,
          abortController.signal,
        );

        if (
          routeCreationSessionRef.current !== routeCreationSession ||
          !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
        ) {
          return;
        }

        commitAsyncRouteMutation(dragState.expectedState, nextState);
      } catch (error) {
        if (isAbortedRequest(error, abortController.signal)) {
          return;
        }

        if (routeCreationSessionRef.current !== routeCreationSession) {
          return;
        }

        const display = routeDisplayRef.current;

        if (display) {
          updateRouteDisplay(
            display,
            routeHistoryRef.current.steps,
            routeHistoryRef.current.closure,
          );
        }

        if (error instanceof RoutingAreaTooLargeError) {
          showTemporaryRouteMessage(t('route.areaTooLarge'), 'error');
          return;
        }

        console.error('Unable to insert the dragged route waypoint.', error);
        showTemporaryRouteMessage(t('route.networkLoadError'), 'error');
      } finally {
        const ownsCurrentOperation =
          routingAbortControllerRef.current === abortController;

        if (ownsCurrentOperation) {
          routingAbortControllerRef.current = null;
          routeOperationPendingRef.current = false;
          setIsRouteOperationPending(false);
        }
      }
    })();
  };

  /** Deletes one clicked waypoint as a single undoable route edit. */
  const deleteRouteWaypoint = (
    dragState: Extract<RouteDragState, { type: 'waypoint' }>,
  ) => {
    if (
      routeOperationPendingRef.current ||
      !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
    ) {
      const display = routeDisplayRef.current;

      if (display) {
        updateRouteDisplay(
          display,
          routeHistoryRef.current.steps,
          routeHistoryRef.current.closure,
        );
      }
      return;
    }

    const routeCreationSession = routeCreationSessionRef.current;
    routeOperationPendingRef.current = true;
    setIsRouteOperationPending(true);
    setRouteContextHint(null);

    const abortController = new AbortController();
    routingAbortControllerRef.current = abortController;

    void (async () => {
      clearRouteMessageTimer();
      setRouteMessage('');

      try {
        const routingLoader = routingLoaderRef.current;

        if (!routingLoader) {
          throw new Error('The dynamic routing loader is unavailable.');
        }

        const nextState = await rebuildRouteAfterWaypointDeletion(
          dragState.expectedState,
          dragState.waypointIndex,
          routingLoader,
          abortController.signal,
        );

        if (
          routeCreationSessionRef.current !== routeCreationSession ||
          !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
        ) {
          return;
        }

        commitAsyncRouteMutation(dragState.expectedState, nextState);
      } catch (error) {
        if (isAbortedRequest(error, abortController.signal)) {
          return;
        }

        if (routeCreationSessionRef.current !== routeCreationSession) {
          return;
        }

        const display = routeDisplayRef.current;

        if (display) {
          updateRouteDisplay(
            display,
            routeHistoryRef.current.steps,
            routeHistoryRef.current.closure,
          );
        }

        if (error instanceof RoutingAreaTooLargeError) {
          showTemporaryRouteMessage(t('route.areaTooLarge'), 'error');
          return;
        }

        console.error('Unable to delete the route waypoint.', error);
        showTemporaryRouteMessage(t('route.networkLoadError'), 'error');
      } finally {
        const ownsCurrentOperation =
          routingAbortControllerRef.current === abortController;

        if (ownsCurrentOperation) {
          routingAbortControllerRef.current = null;
          routeOperationPendingRef.current = false;
          setIsRouteOperationPending(false);
        }
      }
    })();
  };

  const changeZoom = (delta: number) => {
    const view = mapRef.current?.getView();
    const currentZoom = view?.getZoom();

    if (!view || currentZoom === undefined) {
      return;
    }

    view.animate({
      zoom: currentZoom + delta,
      duration: 200,
    });
  };

  const toggleFullscreen = async () => {
    const app = appRef.current;

    if (!app || !document.fullscreenEnabled) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await app.requestFullscreen();
      }
    } catch (error) {
      console.error('Unable to toggle fullscreen mode.', error);
    }
  };

  /**
   * Enters or leaves route creation. Leaving invalidates the session token and
   * aborts any request so a late network response cannot modify the route.
   */
  const toggleRouteCreation = () => {
    const nextState = !routeCreationActiveRef.current;

    routeCreationActiveRef.current = nextState;
    routeCreationSessionRef.current += 1;

    if (nextState && importedRouteSegments.length > 0) {
      const importedDisplay = importedRouteDisplayRef.current;

      if (importedDisplay) {
        updateImportedRouteDisplay(importedDisplay, []);
      }

      setImportedRouteSegments([]);
      setImportedRouteElevationSummary(null);
    }

    if (!nextState) {
      routingAbortControllerRef.current?.abort();
      routingAbortControllerRef.current = null;
      routeOperationPendingRef.current = false;
      setIsRouteOperationPending(false);
      clearRouteMessageTimer();
      setRouteMessage('');
    }

    setIsRouteCreationActive(nextState);
  };

  const selectSearchResult = (result: LocationSearchResult) => {
    const map = mapRef.current;
    const marker = searchResultMarkerRef.current;

    if (!map || !marker) {
      return;
    }

    const coordinate = fromWgs84([
      result.longitude,
      result.latitude,
    ]);

    if (!containsCoordinate(MAP_EXTENT, coordinate)) {
      return;
    }

    updateSearchResultMarker(marker, coordinate);

    map.getView().animate({
      center: coordinate,
      zoom: LOCATION_SEARCH_ZOOM,
      duration: 600,
    });
  };

  const locateUser = () => {
    const map = mapRef.current;
    const marker = userLocationMarkerRef.current;

    if (!map || !marker) {
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus('error');
      showTemporaryLocationMessage(
        t('geolocation.unavailable'),
      );
      return;
    }

    clearLocationMessageTimer();
    setLocationMessage(t('geolocation.searching'));
    setLocationStatus('locating');

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinate = fromWgs84([
          coords.longitude,
          coords.latitude,
        ]);

        if (!containsCoordinate(MAP_EXTENT, coordinate)) {
          setLocationStatus('error');
          showTemporaryLocationMessage(
            t('geolocation.outside'),
          );
          return;
        }

        updateUserLocationMarker(marker, coordinate);

        const view = map.getView();
        const currentZoom = view.getZoom() ?? USER_LOCATION_ZOOM;

        view.animate({
          center: coordinate,
          zoom: Math.max(currentZoom, USER_LOCATION_ZOOM),
          duration: 600,
        });

        clearLocationMessageTimer();
        setLocationMessage('');
        setLocationStatus('located');
      },
      (error) => {
        const messages: Record<number, string> = {
          [GeolocationPositionError.PERMISSION_DENIED]:
            t('geolocation.permissionDenied'),
          [GeolocationPositionError.POSITION_UNAVAILABLE]:
            t('geolocation.positionUnavailable'),
          [GeolocationPositionError.TIMEOUT]:
            t('geolocation.timeout'),
        };

        setLocationStatus('error');
        showTemporaryLocationMessage(
          messages[error.code] ??
            t('geolocation.error'),
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    );
  };

  useEffect(() => {
    const target = mapTargetRef.current;

    if (!target) {
      return;
    }

    const rasterSource = createBaseMapSource(DEFAULT_BASE_MAP_STYLE);
    const grayDetailSource = createGrayDetailMapSource();
    const hikingTrailsSource = createHikingTrailsSource();
    const trailClosuresSource = createTrailClosuresSource();
    const shootingDangerZonesSource = createShootingDangerZonesSource();
    const shootingDangerZoneSelectionDisplay =
      createShootingDangerZoneSelectionDisplay();
    const publicTransportStopsDisplay =
      createPublicTransportStopsDisplay();
    const userLocationMarker = createUserLocationMarker();
    const searchResultMarker = createSearchResultMarker();
    const importedRouteDisplay = createImportedRouteDisplay();
    const routeDisplay = createRouteDisplay();
    const routeProfileMarker = createRouteProfileMarker();
    const baseMapLayer = new TileLayer<WMTS>({
      source: rasterSource,
    });
    const grayDetailLayer = new TileLayer<WMTS>({
      source: grayDetailSource,
      minZoom: GRAY_DETAIL_MIN_ZOOM,
      visible: false,
      zIndex: 1,
    });
    const hikingTrailsLayer = new TileLayer<WMTS>({
      source: hikingTrailsSource,
      minZoom: HIKING_TRAILS_MIN_ZOOM,
      visible: areHikingTrailsVisible,
      zIndex: 10,
    });
    const trailClosuresLayer = new TileLayer<TileWMS>({
      source: trailClosuresSource,
      minZoom: HIKING_TRAILS_MIN_ZOOM,
      visible: areTrailClosuresVisible,
      zIndex: 13,
    });
    const shootingDangerZonesLayer = new TileLayer<TileWMS>({
      source: shootingDangerZonesSource,
      minZoom: HIKING_TRAILS_MIN_ZOOM,
      visible: areShootingDangerZonesVisible,
      // Keep the underlying map and symbols readable without weakening the
      // safety perimeter's priority above closures and transport stops.
      opacity: 0.6,
      zIndex: 16,
    });
    shootingDangerZoneSelectionDisplay.layer.setMinZoom(
      HIKING_TRAILS_MIN_ZOOM,
    );
    shootingDangerZoneSelectionDisplay.layer.setVisible(
      areShootingDangerZonesVisible,
    );
    shootingDangerZoneSelectionDisplay.layer.setZIndex(16.5);
    publicTransportStopsDisplay.layer.setVisible(
      arePublicTransportStopsVisible,
    );
    publicTransportStopsDisplay.selectionLayer.setVisible(
      arePublicTransportStopsVisible,
    );

    /*
     * OpenLayers has its own imperative lifecycle. This effect is the sole
     * owner of the map instance, so it also removes listeners and detaches
     * the DOM target when the React component is unmounted.
     */
    let firstTileLoaded = false;

    const handleTileLoaded = () => {
      if (firstTileLoaded) {
        return;
      }

      firstTileLoaded = true;
      setStatus('ready');
    };

    const handleTileError = () => {
      /*
       * A late failure affecting a single tile should not hide a map that is
       * already usable. The error screen only represents an initial failure.
       */
      if (firstTileLoaded) {
        return;
      }

      setStatus('error');
    };

    rasterSource.on('tileloadend', handleTileLoaded);
    rasterSource.on('tileloaderror', handleTileError);

    const map = new Map({
      target,
      layers: [
        baseMapLayer,
        grayDetailLayer,
        hikingTrailsLayer,
        trailClosuresLayer,
        publicTransportStopsDisplay.selectionLayer,
        publicTransportStopsDisplay.layer,
        shootingDangerZonesLayer,
        shootingDangerZoneSelectionDisplay.layer,
        importedRouteDisplay.layer,
        routeDisplay.layer,
        searchResultMarker.layer,
        userLocationMarker.layer,
        routeProfileMarker.layer,
      ],
      view: new View({
        projection: MAP_PROJECTION_CODE,
        resolutions: [...LV95_VIEW_RESOLUTIONS],
        center: DEFAULT_MAP_CENTER,
        zoom: MAP_ZOOM.initial,
        minZoom: MAP_ZOOM.minimum,
        maxZoom: MAP_ZOOM.maximum,
        extent: MAP_EXTENT,
        constrainOnlyCenter: false,
        /*
         * The map extent is narrower than a typical desktop viewport. Allowing
         * one viewport dimension to exceed it lets OpenLayers show the whole
         * country without relaxing the geographic navigation boundary.
         */
        showFullExtent: true,
        smoothExtentConstraint: false,
      }),
      controls: defaultControls({
        zoom: false,
      }).extend([
        new ScaleLine({
          units: 'metric',
          bar: true,
          text: true,
          minWidth: 120,
        }),
      ]),
    });

    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === appRef.current);

      /*
       * The browser changes the available viewport when entering or leaving
       * fullscreen. OpenLayers must recalculate its canvas size afterwards.
       */
      window.requestAnimationFrame(() => map.updateSize());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    mapRef.current = map;
    baseMapLayerRef.current = baseMapLayer;
    grayDetailLayerRef.current = grayDetailLayer;
    hikingTrailsLayerRef.current = hikingTrailsLayer;
    trailClosuresLayerRef.current = trailClosuresLayer;
    shootingDangerZonesLayerRef.current = shootingDangerZonesLayer;
    shootingDangerZoneSelectionDisplayRef.current =
      shootingDangerZoneSelectionDisplay;
    publicTransportStopsDisplayRef.current = publicTransportStopsDisplay;
    userLocationMarkerRef.current = userLocationMarker;
    searchResultMarkerRef.current = searchResultMarker;
    importedRouteDisplayRef.current = importedRouteDisplay;
    routeDisplayRef.current = routeDisplay;
    routeProfileMarkerRef.current = routeProfileMarker;

    return () => {
      clearLocationMessageTimer();
      clearRouteMessageTimer();
      routingAbortControllerRef.current?.abort();
      routeImportSessionRef.current += 1;
      mapInformationRequestRef.current?.abort();
      document.removeEventListener(
        'fullscreenchange',
        handleFullscreenChange,
      );
      rasterSource.un('tileloadend', handleTileLoaded);
      rasterSource.un('tileloaderror', handleTileError);
      map.setTarget(undefined);
      mapRef.current = null;
      baseMapLayerRef.current = null;
      grayDetailLayerRef.current = null;
      hikingTrailsLayerRef.current = null;
      trailClosuresLayerRef.current = null;
      shootingDangerZonesLayerRef.current = null;
      shootingDangerZoneSelectionDisplayRef.current = null;
      publicTransportStopsDisplayRef.current = null;
      userLocationMarkerRef.current = null;
      searchResultMarkerRef.current = null;
      importedRouteDisplayRef.current = null;
      routeDisplayRef.current = null;
      routeProfileMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const baseMapLayer = baseMapLayerRef.current;
    const grayDetailLayer = grayDetailLayerRef.current;

    if (!baseMapLayer || !grayDetailLayer) {
      return;
    }

    // The 1:10,000 detail layer only complements the grey background.
    grayDetailLayer.setVisible(baseMapStyle === 'gray');

    if (activeBaseMapStyleRef.current === baseMapStyle) {
      return;
    }

    /*
     * Replacing only the source keeps the current view, route, markers, and
     * overlays untouched while the selected WMTS background loads.
     */
    baseMapLayer.setSource(createBaseMapSource(baseMapStyle));
    activeBaseMapStyleRef.current = baseMapStyle;
  }, [baseMapStyle]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HIKING_TRAILS_VISIBILITY_STORAGE_KEY,
        String(areHikingTrailsVisible),
      );
    } catch {
      // Layer visibility remains functional when browser storage is unavailable.
    }
  }, [areHikingTrailsVisible]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY,
        String(areTrailClosuresVisible),
      );
    } catch {
      // Layer visibility remains functional when browser storage is unavailable.
    }
  }, [areTrailClosuresVisible]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SHOOTING_DANGER_ZONES_VISIBILITY_STORAGE_KEY,
        String(areShootingDangerZonesVisible),
      );
    } catch {
      // Layer visibility remains functional when browser storage is unavailable.
    }
  }, [areShootingDangerZonesVisible]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PUBLIC_TRANSPORT_STOPS_VISIBILITY_STORAGE_KEY,
        String(arePublicTransportStopsVisible),
      );
    } catch {
      // Layer visibility remains functional when browser storage is unavailable.
    }
  }, [arePublicTransportStopsVisible]);

  useEffect(() => {
    hikingTrailsLayerRef.current?.setVisible(areHikingTrailsVisible);
  }, [areHikingTrailsVisible]);

  useEffect(() => {
    const trailClosuresLayer = trailClosuresLayerRef.current;

    if (!trailClosuresLayer) {
      return;
    }

    trailClosuresLayer.setVisible(areTrailClosuresVisible);

    if (!areTrailClosuresVisible && trailClosurePopup) {
      closeMapInformationPopup();
    }
  }, [
    areTrailClosuresVisible,
    closeMapInformationPopup,
    trailClosurePopup,
  ]);

  useEffect(() => {
    const shootingDangerZonesLayer = shootingDangerZonesLayerRef.current;
    const selectionDisplay =
      shootingDangerZoneSelectionDisplayRef.current;

    if (!shootingDangerZonesLayer || !selectionDisplay) {
      return;
    }

    shootingDangerZonesLayer.setVisible(areShootingDangerZonesVisible);
    selectionDisplay.layer.setVisible(areShootingDangerZonesVisible);

    if (!areShootingDangerZonesVisible && shootingDangerZonePopup) {
      closeMapInformationPopup();
    }
  }, [
    areShootingDangerZonesVisible,
    closeMapInformationPopup,
    shootingDangerZonePopup,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const display = publicTransportStopsDisplayRef.current;

    if (!map || !display) {
      return;
    }

    display.layer.setVisible(arePublicTransportStopsVisible);
    display.selectionLayer.setVisible(arePublicTransportStopsVisible);

    if (!arePublicTransportStopsVisible) {
      display.source.clear();
      closeMapInformationPopup();
      return;
    }

    let abortController: AbortController | null = null;

    const loadVisibleStops = () => {
      const imageSize = map.getSize();
      const zoom = map.getView().getZoom();

      if (
        !imageSize ||
        zoom === undefined ||
        zoom <= PUBLIC_TRANSPORT_STOPS_MIN_ZOOM
      ) {
        abortController?.abort();
        display.source.clear();
        return;
      }

      abortController?.abort();
      abortController = new AbortController();
      const request = abortController;

      void loadPublicTransportStops(
        {
          extent: map.getView().calculateExtent(imageSize),
          imageSize: [imageSize[0], imageSize[1]],
          language,
        },
        request.signal,
      )
        .then((stops) => {
          if (!request.signal.aborted) {
            updatePublicTransportStopsDisplay(display, stops);
          }
        })
        .catch((error: unknown) => {
          if (
            request.signal.aborted ||
            (error instanceof DOMException && error.name === 'AbortError')
          ) {
            return;
          }

          // Optional stop information must never block route planning.
          console.error('Unable to load public-transport stops.', error);
        });
    };

    map.on('moveend', loadVisibleStops);
    loadVisibleStops();

    return () => {
      map.un('moveend', loadVisibleStops);
      abortController?.abort();
    };
  }, [
    arePublicTransportStopsVisible,
    closeMapInformationPopup,
    language,
  ]);

  // Closure and shooting-danger popup templates are localized server-side,
  // while stop names and modes are reloaded for the selected language.
  useEffect(() => {
    closeMapInformationPopup();
  }, [closeMapInformationPopup, language]);

  useEffect(() => {
    const map = mapRef.current;
    const hasVisibleInformationLayer =
      areTrailClosuresVisible ||
      areShootingDangerZonesVisible ||
      arePublicTransportStopsVisible;

    if (!map || !hasVisibleInformationLayer || isRouteCreationActive) {
      if (isRouteCreationActive) {
        closeMapInformationPopup();
      }
      return;
    }

    const handleInformationLayerClick = (
      event: MapBrowserEvent,
    ) => {
      const imageSize = map.getSize();
      const zoom = map.getView().getZoom();

      if (!imageSize || zoom === undefined) {
        return;
      }

      const canInspectStops =
        arePublicTransportStopsVisible &&
        zoom > PUBLIC_TRANSPORT_STOPS_MIN_ZOOM;
      const canInspectClosures =
        areTrailClosuresVisible && zoom > HIKING_TRAILS_MIN_ZOOM;
      const canInspectShootingDangerZones =
        areShootingDangerZonesVisible && zoom > HIKING_TRAILS_MIN_ZOOM;

      if (
        !canInspectStops &&
        !canInspectClosures &&
        !canInspectShootingDangerZones
      ) {
        return;
      }

      closeMapInformationPopup();

      if (canInspectStops) {
        const stopDisplay = publicTransportStopsDisplayRef.current;
        const stop = stopDisplay
          ? map.forEachFeatureAtPixel(
              event.pixel,
              (feature) => getPublicTransportStopFromFeature(feature),
              {
                hitTolerance: 8,
                layerFilter: (layer) => layer === stopDisplay.layer,
              },
            )
          : undefined;

        // Stops are already filtered and localized during viewport loading, so
        // opening their compact popup requires no additional network request.
        if (stop && stopDisplay) {
          updatePublicTransportStopSelection(stopDisplay, stop);
          setPublicTransportStopPopup(stop);
          return;
        }
      }

      if (!canInspectClosures && !canInspectShootingDangerZones) {
        return;
      }

      const abortController = new AbortController();
      mapInformationRequestRef.current = abortController;
      const context = {
        coordinate: [...event.coordinate] as Coordinate,
        mapExtent: map.getView().calculateExtent(imageSize),
        imageSize: [imageSize[0], imageSize[1]] as [number, number],
        language,
      };

      void (async () => {
        try {
          if (canInspectClosures) {
            try {
              const closure = await identifyTrailClosure(
                context,
                abortController.signal,
              );

              if (closure && !abortController.signal.aborted) {
                setTrailClosurePopup({ state: 'loading', html: null });
                const html = await fetchTrailClosurePopup(
                  closure,
                  abortController.signal,
                );

                if (!abortController.signal.aborted) {
                  setTrailClosurePopup({ state: 'ready', html });
                }
                return;
              }
            } catch (error: unknown) {
              if (isAbortedRequest(error, abortController.signal)) {
                return;
              }

              console.error('Unable to load trail-closure details.', error);
              setTrailClosurePopup({ state: 'error', html: null });
              return;
            }
          }

          if (canInspectShootingDangerZones) {
            try {
              const dangerZone = await identifyShootingDangerZone(
                context,
                abortController.signal,
              );

              if (dangerZone && !abortController.signal.aborted) {
                const selectionDisplay =
                  shootingDangerZoneSelectionDisplayRef.current;

                if (selectionDisplay) {
                  updateShootingDangerZoneSelection(
                    selectionDisplay,
                    dangerZone,
                  );
                }

                setShootingDangerZonePopup({
                  state: 'loading',
                  html: null,
                });
                const html = await fetchShootingDangerZonePopup(
                  dangerZone,
                  abortController.signal,
                );

                if (!abortController.signal.aborted) {
                  setShootingDangerZonePopup({ state: 'ready', html });
                }
              }
            } catch (error: unknown) {
              if (isAbortedRequest(error, abortController.signal)) {
                return;
              }

              console.error(
                'Unable to load shooting danger-zone details.',
                error,
              );
              setShootingDangerZonePopup({ state: 'error', html: null });
            }
          }
        } finally {
          if (mapInformationRequestRef.current === abortController) {
            mapInformationRequestRef.current = null;
          }
        }
      })();
    };

    const handleInformationLayerZoomChange = () => {
      const zoom = map.getView().getZoom();

      if (zoom === undefined) {
        closeMapInformationPopup();
        return;
      }

      const isAnyLayerVisibleAtZoom =
        (arePublicTransportStopsVisible &&
          zoom > PUBLIC_TRANSPORT_STOPS_MIN_ZOOM) ||
        ((areTrailClosuresVisible || areShootingDangerZonesVisible) &&
          zoom > HIKING_TRAILS_MIN_ZOOM);

      if (!isAnyLayerVisibleAtZoom) {
        closeMapInformationPopup();
      }
    };

    map.on('singleclick', handleInformationLayerClick);
    map.getView().on('change:resolution', handleInformationLayerZoomChange);

    return () => {
      map.un('singleclick', handleInformationLayerClick);
      map.getView().un(
        'change:resolution',
        handleInformationLayerZoomChange,
      );
      mapInformationRequestRef.current?.abort();
      mapInformationRequestRef.current = null;
    };
  }, [
    arePublicTransportStopsVisible,
    areShootingDangerZonesVisible,
    areTrailClosuresVisible,
    closeMapInformationPopup,
    isRouteCreationActive,
    language,
  ]);

  // OpenLayers features are a projection of immutable history, never the
  // source of truth.
  useEffect(() => {
    const routeDisplay = routeDisplayRef.current;

    if (!routeDisplay) {
      return;
    }

    updateRouteDisplay(
      routeDisplay,
      routeHistory.steps,
      routeHistory.closure,
    );
  }, [routeHistory.steps, routeHistory.closure]);

  /**
   * Enables direct route shaping only while route creation is active.
   *
   * Existing waypoints can be moved, while dragging a normal or loop-closing
   * section creates a temporary inserted point. Pointer movement stays local;
   * routing begins only once the edit is released.
   */
  useEffect(() => {
    const map = mapRef.current;
    const display = routeDisplayRef.current;

    if (!map || !display || !isRouteCreationActive) {
      return;
    }

    const interaction = createRouteDragInteraction(display, {
      canStart: () =>
        routeCreationActiveRef.current &&
        !routeOperationPendingRef.current &&
        routeHistoryRef.current.steps.length > 0,
      getRouteState: () => getRouteState(routeHistoryRef.current),
      onStart: (target: RouteDragTarget) => {
        const expectedState = getRouteState(routeHistoryRef.current);
        const { steps, closure } = expectedState;

        if (target.type === 'waypoint') {
          const step = steps[target.waypointIndex];

          if (!step) {
            return;
          }

          routeDragStateRef.current = {
            type: 'waypoint',
            waypointIndex: target.waypointIndex,
            startCoordinate: [...step.waypoint],
            expectedState,
          };
          updateRouteWaypointDragPreview(
            display,
            steps,
            closure,
            target.waypointIndex,
            step.waypoint,
          );
          return;
        }

        const isNormalSegment =
          target.stepIndex >= 1 &&
          target.stepIndex < steps.length &&
          Boolean(steps[target.stepIndex]) &&
          Boolean(steps[target.stepIndex - 1]);
        const isClosingSegment =
          target.stepIndex === steps.length &&
          steps.length >= 2 &&
          closure !== null;

        if (!isNormalSegment && !isClosingSegment) {
          return;
        }

        routeDragStateRef.current = {
          type: 'segment',
          stepIndex: target.stepIndex,
          startCoordinate: [...target.coordinate],
          expectedState,
        };
        updateRouteInsertionDragPreview(
          display,
          steps,
          closure,
          target.stepIndex,
          target.coordinate,
        );
      },
      onHover: (target, pixel) => {
        if (!target || !pixel) {
          setRouteContextHint(null);
          return;
        }

        const mapWidth = mapTargetRef.current?.clientWidth ?? 0;
        const horizontalMargin = Math.min(
          ROUTE_CONTEXT_HINT_HALF_WIDTH_PX,
          Math.max(0, mapWidth / 2 - 12),
        );
        const left =
          mapWidth > 0
            ? Math.min(
                Math.max(pixel[0], horizontalMargin + 12),
                Math.max(
                  horizontalMargin + 12,
                  mapWidth - horizontalMargin - 12,
                ),
              )
            : pixel[0];

        setRouteContextHint({
          target,
          left,
          top: pixel[1],
          below: pixel[1] < 64,
        });
      },
      onDrag: (target: RouteDragTarget, coordinate) => {
        const dragState = routeDragStateRef.current;

        if (
          !dragState ||
          dragState.type !== target.type ||
          !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
        ) {
          return;
        }

        if (
          dragState.type === 'waypoint' &&
          target.type === 'waypoint' &&
          dragState.waypointIndex === target.waypointIndex
        ) {
          updateRouteWaypointDragPreview(
            display,
            dragState.expectedState.steps,
            dragState.expectedState.closure,
            dragState.waypointIndex,
            coordinate,
          );
          return;
        }

        if (
          dragState.type === 'segment' &&
          target.type === 'segment' &&
          dragState.stepIndex === target.stepIndex
        ) {
          updateRouteInsertionDragPreview(
            display,
            dragState.expectedState.steps,
            dragState.expectedState.closure,
            dragState.stepIndex,
            coordinate,
          );
        }
      },
      onEnd: (target: RouteDragTarget, coordinate, didDrag, pixel) => {
        const dragState = routeDragStateRef.current;
        routeDragStateRef.current = null;
        setRouteContextHint(null);

        // Waypoint clicks are handled as deletion, while every genuine drag
        // owns its release. A click-only segment press is deliberately left
        // unsuppressed so the normal map click can extend the route there.
        if (target.type === 'waypoint' || didDrag) {
          routeInteractionReleaseRef.current = {
            pixel: [...pixel],
            expiresAt:
              performance.now() + ROUTE_INTERACTION_CLICK_SUPPRESSION_MS,
          };
        }

        const targetMatchesState =
          dragState?.type === target.type &&
          ((dragState.type === 'waypoint' &&
            target.type === 'waypoint' &&
            dragState.waypointIndex === target.waypointIndex) ||
            (dragState.type === 'segment' &&
              target.type === 'segment' &&
              dragState.stepIndex === target.stepIndex));

        if (
          !dragState ||
          !targetMatchesState ||
          !routeStateMatches(routeHistoryRef.current, dragState.expectedState)
        ) {
          updateRouteDisplay(
            display,
            routeHistoryRef.current.steps,
            routeHistoryRef.current.closure,
          );
          return;
        }

        if (dragState.type === 'waypoint' && !didDrag) {
          deleteRouteWaypoint(dragState);
          return;
        }

        if (
          !containsCoordinate(MAP_EXTENT, coordinate) ||
          coordinateDistanceSquared(
            dragState.startCoordinate,
            coordinate,
          ) <= ROUTE_WAYPOINT_MOVE_DISTANCE_SQUARED ||
          (dragState.type === 'segment' && !didDrag)
        ) {
          updateRouteDisplay(
            display,
            routeHistoryRef.current.steps,
            routeHistoryRef.current.closure,
          );
          return;
        }

        if (dragState.type === 'waypoint') {
          moveRouteWaypoint(dragState, coordinate);
        } else {
          insertRouteWaypoint(dragState, coordinate);
        }
      },
    });

    const mapTarget = map.getTargetElement();
    const hideRouteContextHint = () => setRouteContextHint(null);

    map.addInteraction(interaction);
    mapTarget.addEventListener('pointerleave', hideRouteContextHint);

    return () => {
      mapTarget.removeEventListener('pointerleave', hideRouteContextHint);
      map.removeInteraction(interaction);
      clearRouteDragCursor(map);
      routeDragStateRef.current = null;
      routeInteractionReleaseRef.current = null;
      setRouteContextHint(null);
      updateRouteDisplay(
        display,
        routeHistoryRef.current.steps,
        routeHistoryRef.current.closure,
      );
    };
  }, [isRouteCreationActive, language]);

  /** Clears any stale profile marker as soon as the active geometry changes. */
  useEffect(() => {
    const marker = routeProfileMarkerRef.current;

    if (marker) {
      updateRouteProfileMarker(marker, null);
    }
  }, [routeProfilePositionIndex]);

  /**
   * Retrieves a fresh elevation profile after route history settles. Previous
   * requests are aborted so rapid undo/redo actions cannot publish stale data.
   */
  useEffect(() => {
    if (activeRouteSegments.length === 0 || routeDistanceMeters <= 0) {
      setRouteElevation(null);
      setRouteElevationStatus('loading');
      return;
    }

    if (
      routeCoordinates.length < 2 &&
      importedRouteElevationSummary !== null
    ) {
      setRouteElevation(importedRouteElevationSummary);
      setRouteElevationStatus('ready');
      return;
    }

    const abortController = new AbortController();
    setRouteElevation(null);
    setRouteElevationStatus('loading');

    const requestTimer = window.setTimeout(() => {
      const elevationRequest =
        activeRouteSegments.length === 1
          ? fetchRouteElevationSummary(
              activeRouteSegments[0],
              routeDistanceMeters,
              abortController.signal,
            )
          : fetchRouteSegmentsElevationSummary(
              activeRouteSegments,
              abortController.signal,
            );

      void elevationRequest
        .then((summary) => {
          if (!abortController.signal.aborted) {
            setRouteElevation(summary);
            setRouteElevationStatus('ready');
          }
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }

          console.error('Unable to load the route elevation profile.', error);
          setRouteElevation(null);
          setRouteElevationStatus('error');
        });
    }, ELEVATION_REQUEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(requestTimer);
      abortController.abort();
    };
  }, [
    activeRouteSegments,
    importedRouteElevationSummary,
    routeCoordinates.length,
    routeDistanceMeters,
  ]);

  /**
   * Registers the route-click interaction only while editing is active. Network
   * operations are serialized because each new segment depends on the endpoint
   * committed by the previous operation.
   */
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isRouteCreationActive) {
      return;
    }

    const handleRouteClick = (event: MapBrowserEvent) => {
      // OpenLayers emits `singleclick` after a pointer interaction has already
      // handled a click. Ignore that delayed event so deleting a waypoint does
      // not immediately append a new endpoint at the same position.
      const interactionRelease = routeInteractionReleaseRef.current;

      if (interactionRelease) {
        const deltaX = event.pixel[0] - interactionRelease.pixel[0];
        const deltaY = event.pixel[1] - interactionRelease.pixel[1];
        const isMatchingRelease =
          performance.now() <= interactionRelease.expiresAt &&
          deltaX * deltaX + deltaY * deltaY <=
            ROUTE_INTERACTION_CLICK_TOLERANCE_PX ** 2;

        routeInteractionReleaseRef.current = null;

        if (isMatchingRelease) {
          return;
        }
      }

      // Ignore extra clicks while the current endpoint is still being resolved.
      if (routeOperationPendingRef.current) {
        return;
      }

      const display = routeDisplayRef.current;
      const expectedState = getRouteState(routeHistoryRef.current);
      const { steps: expectedSteps, closure: expectedClosure } = expectedState;

      // A closed route must be reopened explicitly before another endpoint is added.
      if (expectedClosure) {
        return;
      }

      // Waypoint clicks belong to the editing interaction because they delete
      // that point. A simple click on the route line is intentionally allowed
      // through: it appends a new endpoint from the current route end, while a
      // genuine line drag still inserts a waypoint into the selected section.
      if (
        display &&
        getRouteWaypointIndexAtPixel(map, display, event.pixel) !== null
      ) {
        return;
      }

      const clickedCoordinate: Coordinate = [...event.coordinate];
      const routeCreationSession = routeCreationSessionRef.current;
      const previousStep = expectedSteps[expectedSteps.length - 1];

      // Straight mode stays fully local and records the same immutable step
      // shape as network mode.
      if (!isRouteSnapEnabled) {
        appendRouteStep(
          expectedState,
          createStraightRouteStep(previousStep, clickedCoordinate),
        );
        return;
      }

      // The ref blocks clicks synchronously; React state drives the visible
      // busy treatment.
      routeOperationPendingRef.current = true;
      setIsRouteOperationPending(true);

      // One controller owns all GeoAdmin requests spawned for this click.
      const abortController = new AbortController();
      routingAbortControllerRef.current = abortController;

      void (async () => {
        clearRouteMessageTimer();
        setRouteMessage('');

        try {
          const routingLoader = routingLoaderRef.current;

          if (!routingLoader) {
            throw new Error('The dynamic routing loader is unavailable.');
          }

          let step: RouteStep;

          if (!previousStep) {
            const snappedCoordinate = await routingLoader.snap(
              clickedCoordinate,
              abortController.signal,
            );

            if (snappedCoordinate) {
              step = {
                waypoint: [...snappedCoordinate],
                segment: null,
                mode: 'network',
              };
            } else {
              // A route may begin just outside swissTLM3D coverage. Preserve
              // the user's click so cross-border planning can continue.
              step = createStraightRouteStep(undefined, clickedCoordinate);
            }
          } else {
            const routedPath = await routingLoader.route(
              previousStep.waypoint,
              clickedCoordinate,
              abortController.signal,
            );

            if (!routedPath || routedPath.coordinates.length < 2) {
              // Snap remains enabled for later clicks; only this section falls
              // back to a direct line when no usable network route exists.
              step = createStraightRouteStep(
                previousStep,
                clickedCoordinate,
              );
            } else {
              const segment = routedPath.coordinates.map(
                (coordinate): Coordinate => [...coordinate],
              );

              /*
               * A preceding straight segment can leave its waypoint slightly off
               * the network. Preserve continuity with a short access connector;
               * subsequent snapped waypoints already lie on swissTLM3D.
               */
              if (
                coordinateDistanceSquared(
                  previousStep.waypoint,
                  segment[0],
                ) > ROUTE_CONNECTOR_DISTANCE_SQUARED
              ) {
                segment.unshift([...previousStep.waypoint]);
              }

              step = {
                waypoint: [...segment[segment.length - 1]],
                segment,
                mode: 'network',
              };
            }
          }

          // Reject stale results after mode changes, undo/redo, or another history mutation.
          if (
            !routeCreationActiveRef.current ||
            routeCreationSessionRef.current !== routeCreationSession ||
            !routeStateMatches(routeHistoryRef.current, expectedState)
          ) {
            return;
          }

          appendRouteStep(expectedState, step);
        } catch (error) {
          // Cancellation is an expected control-flow path when the user leaves route mode.
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }

          if (routeCreationSessionRef.current !== routeCreationSession) {
            return;
          }

          if (error instanceof RoutingAreaTooLargeError) {
            showTemporaryRouteMessage(
              t('route.areaTooLarge'),
              'error',
            );
            return;
          }

          console.error('Unable to load or route on swissTLM3D.', error);
          showTemporaryRouteMessage(
            t('route.networkLoadError'),
            'error',
          );
        } finally {
          // Only the operation still registered as current may clear the shared busy state.
          const ownsCurrentOperation =
            routingAbortControllerRef.current === abortController;

          if (ownsCurrentOperation) {
            routingAbortControllerRef.current = null;
            routeOperationPendingRef.current = false;
            setIsRouteOperationPending(false);
          }

          if (routeCreationSessionRef.current !== routeCreationSession) {
            clearRouteMessageTimer();
            setRouteMessage('');
          }
        }
      })();
    };

    map.on('singleclick', handleRouteClick);

    return () => {
      map.un('singleclick', handleRouteClick);
    };
  }, [isRouteCreationActive, isRouteSnapEnabled, t]);

  const locationButtonLabel =
    locationStatus === 'located'
      ? t('geolocation.recenter')
      : t('geolocation.show');

  const fullscreenButtonLabel = isFullscreen
    ? t('map.fullscreenExit')
    : t('map.fullscreenEnter');

  return (
    <main
      className={[
        'app',
        isRouteCreationActive ? 'app--route-creation' : '',
        isRouteOperationPending ? 'app--route-busy' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={appRef}
    >
      <div
        ref={mapTargetRef}
        className="map"
        aria-label={t('map.aria')}
      />

      {routeContextHint && (
        <div
          className={[
            'route-context-hint',
            routeContextHint.below ? 'route-context-hint--below' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            left: routeContextHint.left,
            top: routeContextHint.top,
          }}
          role="tooltip"
        >
          {routeContextHint.target === 'waypoint'
            ? t('route.waypointHint')
            : t('route.segmentHint')}
        </div>
      )}

      <LocationSearch
        onSearchFocus={closeMapInformationPopup}
        onSelect={selectSearchResult}
      />

      <nav className="map-controls" aria-label={t('map.controls')}>
        <RouteControls
          isActive={isRouteCreationActive}
          isSnapEnabled={isRouteSnapEnabled}
          isBusy={isRouteOperationPending}
          hasRoute={routeHistory.steps.length > 0}
          canUndo={
            !isRouteOperationPending && routeHistory.undoStates.length > 0
          }
          canRedo={
            !isRouteOperationPending && routeHistory.redoStates.length > 0
          }
          canReverse={
            !isRouteOperationPending && routeHistory.steps.length > 1
          }
          canToggleLoop={
            !isRouteOperationPending && routeHistory.steps.length > 1
          }
          isLoopClosed={routeHistory.closure !== null}
          canDelete={
            !isRouteOperationPending && routeHistory.steps.length > 0
          }
          canExport={
            !isRouteOperationPending && routeHistory.steps.length > 1
          }
          onToggle={toggleRouteCreation}
          onUndo={undoRoutePoint}
          onRedo={redoRoutePoint}
          onToggleSnap={() =>
            setIsRouteSnapEnabled((isSnapEnabled) => !isSnapEnabled)
          }
          onReverse={reverseRoute}
          onToggleLoop={toggleRouteLoop}
          onDelete={deleteRoute}
          onExport={requestRouteExport}
        />

        <RouteImportControl onSelectFile={importRouteFile} />

        <MapLayersSelector
          baseMapStyle={baseMapStyle}
          onBaseMapChange={setBaseMapStyle}
          areHikingTrailsVisible={areHikingTrailsVisible}
          onHikingTrailsChange={setAreHikingTrailsVisible}
          areTrailClosuresVisible={areTrailClosuresVisible}
          onTrailClosuresChange={setAreTrailClosuresVisible}
          areShootingDangerZonesVisible={areShootingDangerZonesVisible}
          onShootingDangerZonesChange={setAreShootingDangerZonesVisible}
          arePublicTransportStopsVisible={arePublicTransportStopsVisible}
          onPublicTransportStopsChange={setArePublicTransportStopsVisible}
        />

        <div className="zoom-controls">
          <button
            type="button"
            className="map-control-button map-control-button--zoom"
            aria-label={t('map.zoomIn')}
            title={t('map.zoomIn')}
            onClick={() => changeZoom(1)}
          >
            +
          </button>

          <button
            type="button"
            className="map-control-button map-control-button--zoom"
            aria-label={t('map.zoomOut')}
            title={t('map.zoomOut')}
            onClick={() => changeZoom(-1)}
          >
            −
          </button>
        </div>

        <button
          type="button"
          className={[
            'map-control-button',
            'map-control-button--location',
            locationStatus === 'located'
              ? 'map-control-button--active'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={locationButtonLabel}
          aria-busy={locationStatus === 'locating'}
          title={locationButtonLabel}
          disabled={locationStatus === 'locating'}
          onClick={locateUser}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="7" />
            <circle
              cx="12"
              cy="12"
              r="2.2"
              className="location-icon-center"
            />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
          </svg>
        </button>

        {document.fullscreenEnabled && (
          <button
            type="button"
            className="map-control-button map-control-button--fullscreen"
            aria-label={fullscreenButtonLabel}
            aria-pressed={isFullscreen}
            title={fullscreenButtonLabel}
            onClick={() => void toggleFullscreen()}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              {isFullscreen ? (
                <path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6" />
              ) : (
                <path d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6" />
              )}
            </svg>
          </button>
        )}

        <LanguageSelector />

        {locationMessage && (
          <div
            className={[
              'location-message',
              locationStatus === 'error'
                ? 'location-message--error'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role={locationStatus === 'error' ? 'alert' : 'status'}
          >
            {locationMessage}
          </div>
        )}
      </nav>

      {trailClosurePopup && (
        <TrailClosurePopup
          status={trailClosurePopup}
          onClose={closeMapInformationPopup}
        />
      )}

      {shootingDangerZonePopup && (
        <ShootingDangerZonePopup
          status={shootingDangerZonePopup}
          onClose={closeMapInformationPopup}
        />
      )}

      {publicTransportStopPopup && (
        <PublicTransportStopPopup
          stop={publicTransportStopPopup}
          onClose={closeMapInformationPopup}
        />
      )}

      {activeRouteSegments.length > 0 && (
        <RouteStatistics
          distanceMeters={routeDistanceMeters}
          elevationStatus={routeElevationStatus}
          ascentMeters={routeElevation?.ascentMeters ?? null}
          descentMeters={routeElevation?.descentMeters ?? null}
          durationMinutes={routeDurationMinutes}
          elevationPoints={routeElevation?.points ?? []}
          onProfileHoverDistanceChange={
            handleProfileHoverDistanceChange
          }
        />
      )}

      {routeMessage && (
        <div
          className={[
            'route-message',
            routeMessageType === 'error' ? 'route-message--error' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role={routeMessageType === 'error' ? 'alert' : 'status'}
        >
          {routeMessage}
        </div>
      )}

      <RouteExportDialog
        isOpen={isRouteExportDialogOpen}
        defaultName={routeExportDefaultName}
        onCancel={() => setIsRouteExportDialogOpen(false)}
        onConfirm={exportRoute}
      />

      {status === 'loading' && (
        <div className="status-card" role="status">
          {t('map.loading')}
        </div>
      )}

      {status === 'error' && (
        <div className="status-card status-card--error" role="alert">
          <strong>{t('map.loadFailed')}</strong>
          <span>{t('map.tileError')}</span>
          <span>{t('map.retry')}</span>
        </div>
      )}
    </main>
  );
}

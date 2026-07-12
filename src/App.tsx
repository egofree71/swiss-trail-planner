/**
 * Business context: coordinates the map-centred application shell and owns the
 * imperative OpenLayers lifecycle. It connects search, geolocation, fullscreen,
 * route history, official closure inspection, dynamic swissTLM3D loading,
 * and route-editing controls while
 * keeping provider/network details in dedicated modules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from 'ol/coordinate.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { defaults as defaultControls, ScaleLine } from 'ol/control.js';
import { containsCoordinate } from 'ol/extent.js';
import TileLayer from 'ol/layer/Tile.js';
import type TileWMS from 'ol/source/TileWMS.js';
import type XYZ from 'ol/source/XYZ.js';
import { fromLonLat } from 'ol/proj.js';
import MapLayersSelector from './components/MapLayersSelector';
import LanguageSelector from './components/LanguageSelector';
import LocationSearch from './components/LocationSearch';
import RouteImportControl from './components/RouteImportControl';
import RouteControls from './components/RouteControls';
import RouteExportDialog from './components/RouteExportDialog';
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
  LOCATION_SEARCH_ZOOM,
  MAP_EXTENT,
  MAP_ZOOM,
  USER_LOCATION_ZOOM,
  type BaseMapStyle,
} from './map/config';
import {
  createImportedRouteDisplay,
  type ImportedRouteDisplay,
  updateImportedRouteDisplay,
} from './map/importedRoute';
import {
  collectRouteCoordinates,
  createRouteDisplay,
  reverseRouteSteps,
  type RouteDisplay,
  type RouteStep,
  updateRouteDisplay,
} from './map/route';
import {
  createSearchResultMarker,
  type SearchResultMarker,
  updateSearchResultMarker,
} from './map/searchResult';
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
  calculateRouteDistance,
  estimateHikingDuration,
  fetchRouteElevationSummary,
  type RouteElevationSummary,
} from './metrics/routeMetrics';
import type { LocationSearchResult } from './search/locationSearch';

/** Base-map loading state used by the blocking startup card. */
type LoadStatus = 'loading' | 'ready' | 'error';
/** Browser geolocation state used by the location control and its feedback. */
type LocationStatus = 'idle' | 'locating' | 'located' | 'error';
/** Severity of a temporary route-editing message. */
type RouteMessageType = 'info' | 'error';

/** Immutable undo/redo state for route creation. */
interface RouteHistory {
  /** Applied route steps in display order. */
  steps: RouteStep[];
  /** Undone steps stored in reverse restoration order. */
  redoSteps: RouteStep[];
}

/** Duration in milliseconds for transient geolocation feedback. */
const LOCATION_MESSAGE_DURATION_MS = 6_000;
/** Duration in milliseconds for actionable route errors before auto-dismissal. */
const ROUTE_MESSAGE_DURATION_MS = 7_000;
/** Squared distance in square map units below which a route connector is unnecessary. */
const ROUTE_CONNECTOR_DISTANCE_SQUARED = 0.01;
/** Delay in milliseconds before requesting elevations after a route mutation. */
const ELEVATION_REQUEST_DEBOUNCE_MS = 250;
/** Browser preference key for the safety-information overlay. */
const TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY =
  'swiss-trail-planner.trail-closures-visible';

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

/** Root application component and sole owner of the OpenLayers Map instance. */
export default function App() {
  const { language, t } = useI18n();
  const appRef = useRef<HTMLElement>(null);
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const baseMapLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const grayDetailLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const trailClosuresLayerRef = useRef<TileLayer<TileWMS> | null>(null);
  const activeBaseMapStyleRef = useRef<BaseMapStyle>(
    DEFAULT_BASE_MAP_STYLE,
  );
  const userLocationMarkerRef = useRef<UserLocationMarker | null>(null);
  const searchResultMarkerRef = useRef<SearchResultMarker | null>(null);
  const routeDisplayRef = useRef<RouteDisplay | null>(null);
  const importedRouteDisplayRef = useRef<ImportedRouteDisplay | null>(null);
  const locationMessageTimerRef = useRef<number | null>(null);
  const routeMessageTimerRef = useRef<number | null>(null);
  const routeHistoryRef = useRef<RouteHistory>({
    steps: [],
    redoSteps: [],
  });
  const routeCreationActiveRef = useRef(false);
  const routeCreationSessionRef = useRef(0);
  const routeOperationPendingRef = useRef(false);
  const routingLoaderRef = useRef<DynamicRoutingNetworkLoader | null>(null);
  const routingAbortControllerRef = useRef<AbortController | null>(null);
  const routeImportSessionRef = useRef(0);
  const trailClosureRequestRef = useRef<AbortController | null>(null);

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
  const [areTrailClosuresVisible, setAreTrailClosuresVisible] =
    useState(getInitialTrailClosuresVisibility);
  const [trailClosurePopup, setTrailClosurePopup] =
    useState<TrailClosurePopupStatus | null>(null);
  const [isRouteCreationActive, setIsRouteCreationActive] = useState(false);
  const [isRouteSnapEnabled, setIsRouteSnapEnabled] = useState(true);
  const [isRouteOperationPending, setIsRouteOperationPending] =
    useState(false);
  const [routeMessage, setRouteMessage] = useState('');
  const [routeMessageType, setRouteMessageType] =
    useState<RouteMessageType>('info');
  const [routeHistory, setRouteHistory] = useState<RouteHistory>(
    routeHistoryRef.current,
  );
  const [routeElevationStatus, setRouteElevationStatus] =
    useState<RouteElevationStatus>('loading');
  const [routeElevation, setRouteElevation] =
    useState<RouteElevationSummary | null>(null);
  const routeCoordinates = useMemo(
    () => collectRouteCoordinates(routeHistory.steps),
    [routeHistory.steps],
  );
  const routeDistanceMeters = useMemo(
    () => calculateRouteDistance(routeCoordinates),
    [routeCoordinates],
  );
  const routeDurationMinutes = routeElevation
    ? estimateHikingDuration(
        routeDistanceMeters,
        routeElevation.ascentMeters,
        routeElevation.descentMeters,
      )
    : null;

  /** Closes closure metadata and cancels a superseded identify/popup request. */
  const closeTrailClosurePopup = useCallback(() => {
    trailClosureRequestRef.current?.abort();
    trailClosureRequestRef.current = null;
    setTrailClosurePopup(null);
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

  /**
   * Commits an asynchronously generated route step only if history and editing
   * mode still match the state captured when the operation began.
   */
  const appendRouteStep = (
    expectedSteps: RouteStep[],
    step: RouteStep,
  ): boolean => {
    const currentHistory = routeHistoryRef.current;

    if (
      currentHistory.steps !== expectedSteps ||
      !routeCreationActiveRef.current
    ) {
      return false;
    }

    commitRouteHistory({
      steps: [...currentHistory.steps, step],
      redoSteps: [],
    });
    return true;
  };

  /** Moves the latest applied step to the redo stack without recomputing geometry. */
  const undoRoutePoint = () => {
    if (routeOperationPendingRef.current) {
      return;
    }

    const currentHistory = routeHistoryRef.current;

    if (currentHistory.steps.length === 0) {
      return;
    }

    const lastStep = currentHistory.steps[currentHistory.steps.length - 1];

    commitRouteHistory({
      steps: currentHistory.steps.slice(0, -1),
      redoSteps: [...currentHistory.redoSteps, lastStep],
    });
  };

  /** Restores the latest undone step with the exact geometry stored in history. */
  const redoRoutePoint = () => {
    if (routeOperationPendingRef.current) {
      return;
    }

    const currentHistory = routeHistoryRef.current;

    if (currentHistory.redoSteps.length === 0) {
      return;
    }

    const restoredStep =
      currentHistory.redoSteps[currentHistory.redoSteps.length - 1];

    commitRouteHistory({
      steps: [...currentHistory.steps, restoredStep],
      redoSteps: currentHistory.redoSteps.slice(0, -1),
    });
  };

  /** Reverses the exact stored route geometry and starts future edits at its former beginning. */
  const reverseRoute = () => {
    if (routeOperationPendingRef.current) {
      return;
    }

    const currentHistory = routeHistoryRef.current;

    if (currentHistory.steps.length < 2) {
      return;
    }

    commitRouteHistory({
      steps: reverseRouteSteps(currentHistory.steps),
      // Redo entries belong to the old direction and cannot be applied safely.
      redoSteps: [],
    });
  };

  /** Clears the complete route while leaving route-creation mode ready for a new start. */
  const deleteRoute = () => {
    if (
      routeOperationPendingRef.current ||
      routeHistoryRef.current.steps.length === 0
    ) {
      return;
    }

    commitRouteHistory({
      steps: [],
      redoSteps: [],
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
   * Loads one GPX as an independent read-only layer and frames its full extent.
   * The editable route and its undo/redo history remain untouched.
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
        segment.map((coordinate) => fromLonLat(coordinate)),
      );

      updateImportedRouteDisplay(display, projectedSegments);
      clearRouteMessageTimer();
      setRouteMessage('');

      /*
       * Fitting the loaded geometry triggers the normal WMTS tile requests for
       * that location. A bottom margin leaves room for editable-route statistics
       * when a separate route is already being created.
       */
      const importedExtent = display.source.getExtent();

      if (importedExtent) {
        map.getView().fit(importedExtent, {
          duration: 600,
          maxZoom: 16,
          padding: [80, 80, routeCoordinates.length >= 2 ? 180 : 80, 80],
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

    const coordinate = fromLonLat([
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
        const coordinate = fromLonLat([
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
    const userLocationMarker = createUserLocationMarker();
    const searchResultMarker = createSearchResultMarker();
    const importedRouteDisplay = createImportedRouteDisplay();
    const routeDisplay = createRouteDisplay();
    const baseMapLayer = new TileLayer<XYZ>({
      source: rasterSource,
    });
    const grayDetailLayer = new TileLayer<XYZ>({
      source: grayDetailSource,
      minZoom: GRAY_DETAIL_MIN_ZOOM,
      visible: false,
      zIndex: 1,
    });
    const trailClosuresLayer = new TileLayer<TileWMS>({
      source: trailClosuresSource,
      minZoom: HIKING_TRAILS_MIN_ZOOM,
      visible: areTrailClosuresVisible,
      zIndex: 14,
    });

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
        new TileLayer({
          source: hikingTrailsSource,
          minZoom: HIKING_TRAILS_MIN_ZOOM,
          zIndex: 10,
        }),
        trailClosuresLayer,
        importedRouteDisplay.layer,
        routeDisplay.layer,
        searchResultMarker.layer,
        userLocationMarker.layer,
      ],
      view: new View({
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
    trailClosuresLayerRef.current = trailClosuresLayer;
    userLocationMarkerRef.current = userLocationMarker;
    searchResultMarkerRef.current = searchResultMarker;
    importedRouteDisplayRef.current = importedRouteDisplay;
    routeDisplayRef.current = routeDisplay;

    return () => {
      clearLocationMessageTimer();
      clearRouteMessageTimer();
      routingAbortControllerRef.current?.abort();
      routeImportSessionRef.current += 1;
      trailClosureRequestRef.current?.abort();
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
      trailClosuresLayerRef.current = null;
      userLocationMarkerRef.current = null;
      searchResultMarkerRef.current = null;
      importedRouteDisplayRef.current = null;
      routeDisplayRef.current = null;
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
        TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY,
        String(areTrailClosuresVisible),
      );
    } catch {
      // Layer visibility remains functional when browser storage is unavailable.
    }
  }, [areTrailClosuresVisible]);

  useEffect(() => {
    const trailClosuresLayer = trailClosuresLayerRef.current;

    if (!trailClosuresLayer) {
      return;
    }

    trailClosuresLayer.setVisible(areTrailClosuresVisible);

    if (!areTrailClosuresVisible) {
      closeTrailClosurePopup();
    }
  }, [areTrailClosuresVisible, closeTrailClosurePopup]);

  // Popup templates are localized server-side, so stale-language content is
  // dismissed instead of remaining visible after an interface language change.
  useEffect(() => {
    closeTrailClosurePopup();
  }, [closeTrailClosurePopup, language]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !areTrailClosuresVisible || isRouteCreationActive) {
      if (isRouteCreationActive) {
        closeTrailClosurePopup();
      }
      return;
    }

    const handleTrailClosureClick = (event: { coordinate: Coordinate }) => {
      const imageSize = map.getSize();
      const zoom = map.getView().getZoom();

      // The official WMS is too dense at national and regional scales. Match
      // the hiking-trail overlay threshold so closure details are inspected
      // only while their geometries are actually visible on the map.
      if (
        !imageSize ||
        zoom === undefined ||
        zoom <= HIKING_TRAILS_MIN_ZOOM
      ) {
        return;
      }

      trailClosureRequestRef.current?.abort();
      setTrailClosurePopup(null);

      const abortController = new AbortController();
      trailClosureRequestRef.current = abortController;
      const context = {
        coordinate: [...event.coordinate] as Coordinate,
        mapExtent: map.getView().calculateExtent(imageSize),
        imageSize: [imageSize[0], imageSize[1]] as [number, number],
        language,
      };

      void identifyTrailClosure(context, abortController.signal)
        .then(async (closure) => {
          if (!closure || abortController.signal.aborted) {
            return;
          }

          setTrailClosurePopup({ state: 'loading', html: null });
          const html = await fetchTrailClosurePopup(
            closure,
            abortController.signal,
          );

          if (!abortController.signal.aborted) {
            setTrailClosurePopup({ state: 'ready', html });
          }
        })
        .catch((error: unknown) => {
          if (
            abortController.signal.aborted ||
            (error instanceof DOMException && error.name === 'AbortError')
          ) {
            return;
          }

          console.error('Unable to load hiking closure details.', error);
          setTrailClosurePopup({ state: 'error', html: null });
        })
        .finally(() => {
          if (trailClosureRequestRef.current === abortController) {
            trailClosureRequestRef.current = null;
          }
        });
    };

    const handleClosureZoomChange = () => {
      const zoom = map.getView().getZoom();

      if (zoom === undefined || zoom <= HIKING_TRAILS_MIN_ZOOM) {
        closeTrailClosurePopup();
      }
    };

    map.on('singleclick', handleTrailClosureClick);
    map.getView().on('change:resolution', handleClosureZoomChange);

    return () => {
      map.un('singleclick', handleTrailClosureClick);
      map.getView().un('change:resolution', handleClosureZoomChange);
      trailClosureRequestRef.current?.abort();
      trailClosureRequestRef.current = null;
    };
  }, [
    areTrailClosuresVisible,
    closeTrailClosurePopup,
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

    updateRouteDisplay(routeDisplay, routeHistory.steps);
  }, [routeHistory.steps]);

  /**
   * Retrieves a fresh elevation profile after route history settles. Previous
   * requests are aborted so rapid undo/redo actions cannot publish stale data.
   */
  useEffect(() => {
    if (routeCoordinates.length < 2 || routeDistanceMeters <= 0) {
      setRouteElevation(null);
      setRouteElevationStatus('loading');
      return;
    }

    const abortController = new AbortController();
    setRouteElevation(null);
    setRouteElevationStatus('loading');

    const requestTimer = window.setTimeout(() => {
      void fetchRouteElevationSummary(
        routeCoordinates,
        routeDistanceMeters,
        abortController.signal,
      )
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
  }, [routeCoordinates, routeDistanceMeters]);

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

    const handleRouteClick = (event: { coordinate: Coordinate }) => {
      // Ignore extra clicks while the current endpoint is still being resolved.
      if (routeOperationPendingRef.current) {
        return;
      }

      const clickedCoordinate: Coordinate = [...event.coordinate];
      const expectedSteps = routeHistoryRef.current.steps;
      const routeCreationSession = routeCreationSessionRef.current;
      const previousStep = expectedSteps[expectedSteps.length - 1];

      // Straight mode stays fully local and records the same immutable step
      // shape as network mode.
      if (!isRouteSnapEnabled) {
        appendRouteStep(
          expectedSteps,
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
            routeHistoryRef.current.steps !== expectedSteps
          ) {
            return;
          }

          appendRouteStep(expectedSteps, step);
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

      <LocationSearch onSelect={selectSearchResult} />

      <nav className="map-controls" aria-label={t('map.controls')}>
        <RouteControls
          isActive={isRouteCreationActive}
          isSnapEnabled={isRouteSnapEnabled}
          isBusy={isRouteOperationPending}
          hasRoute={routeHistory.steps.length > 0}
          canUndo={
            !isRouteOperationPending && routeHistory.steps.length > 0
          }
          canRedo={
            !isRouteOperationPending && routeHistory.redoSteps.length > 0
          }
          canReverse={
            !isRouteOperationPending && routeHistory.steps.length > 1
          }
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
          onDelete={deleteRoute}
          onExport={requestRouteExport}
        />

        <RouteImportControl onSelectFile={importRouteFile} />

        <MapLayersSelector
          baseMapStyle={baseMapStyle}
          onBaseMapChange={setBaseMapStyle}
          areTrailClosuresVisible={areTrailClosuresVisible}
          onTrailClosuresChange={setAreTrailClosuresVisible}
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
          onClose={closeTrailClosurePopup}
        />
      )}

      {routeCoordinates.length >= 2 && (
        <RouteStatistics
          distanceMeters={routeDistanceMeters}
          elevationStatus={routeElevationStatus}
          ascentMeters={routeElevation?.ascentMeters ?? null}
          descentMeters={routeElevation?.descentMeters ?? null}
          durationMinutes={routeDurationMinutes}
          elevationPoints={routeElevation?.points ?? []}
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

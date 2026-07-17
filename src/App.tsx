/**
 * Business context: coordinates the map-centred application shell around one
 * disposable OpenLayers runtime. It composes search, geolocation, editable-route,
 * imported-GPX, information-layer, and itinerary-metrics capabilities while
 * delegating their imperative lifecycles and provider contracts to focused
 * modules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from 'ol/coordinate.js';
import MapBrowserEvent from 'ol/MapBrowserEvent.js';
import { containsCoordinate } from 'ol/extent.js';
import MapLayersSelector from './components/MapLayersSelector';
import LanguageSelector from './components/LanguageSelector';
import LocationSearch from './components/LocationSearch';
import RouteImportControl from './components/RouteImportControl';
import RouteControls from './components/RouteControls';
import RouteExportDialog from './components/RouteExportDialog';
import PublicTransportStopPopup from './components/PublicTransportStopPopup';
import ShootingDangerZonePopup from './components/ShootingDangerZonePopup';
import TrailClosurePopup from './components/TrailClosurePopup';
import RouteStatistics, {
  type RouteElevationStatus,
} from './components/RouteStatistics';
import { downloadRouteGpx } from './export/gpx';
import {
  GpxImportError,
  MAX_GPX_FILE_SIZE_BYTES,
  parseGpxRoute,
} from './import/gpx';
import { useI18n } from './i18n/I18nContext';
import {
  DEFAULT_BASE_MAP_STYLE,
  IMPORTED_ROUTE_MAX_ZOOM,
  LOCATION_SEARCH_ZOOM,
  MAP_EXTENT,
  USER_LOCATION_ZOOM,
  type BaseMapStyle,
} from './map/config';
import { fromWgs84 } from './map/projection';
import { updateImportedRouteDisplay } from './map/importedRoute';
import type { MapLoadStatus } from './map/mapRuntime';
import {
  resolveInitialMapInformationLayerVisibility,
  useMapInformationLayers,
} from './map/useMapInformationLayers';
import { useMapRuntime } from './map/useMapRuntime';
import { useEditableRoute } from './map/useEditableRoute';
import {
  clearSearchResultMarker,
  updateSearchResultMarker,
} from './map/searchResult';
import {
  createRouteProfilePositionIndex,
  getClosestRouteProfilePosition,
  getRouteProfileCoordinate,
  updateRouteProfileMarker,
} from './map/routeProfileMarker';
import { updateUserLocationMarker } from './map/userLocation';
import {
  calculateRouteSegmentsDistance,
  createImportedRouteElevationSummary,
  estimateHikingDuration,
  fetchRouteElevationSummary,
  fetchRouteSegmentsElevationSummary,
  type RouteElevationSummary,
} from './metrics/routeMetrics';
import type { LocationSearchResult } from './search/locationSearch';

/** Browser geolocation state used by the location control and its feedback. */
type LocationStatus = 'idle' | 'locating' | 'located' | 'error';
/** Duration in milliseconds for transient geolocation feedback. */
const LOCATION_MESSAGE_DURATION_MS = 6_000;
/** Delay in milliseconds before requesting elevations after a route mutation. */
const ELEVATION_REQUEST_DEBOUNCE_MS = 250;
/** Screen-space route tolerance for the bidirectional map/profile hover link. */
const ROUTE_PROFILE_HOVER_TOLERANCE_PX = 10;
/** Browser preference key for the rendered hiking-trail overlay. */
const HIKING_TRAILS_VISIBILITY_STORAGE_KEY =
  'via-helvetica.hiking-trails-visible';
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

/** Root application coordinator for UI state and map-level workflows. */
export default function App() {
  const { language, t } = useI18n();
  const appRef = useRef<HTMLElement>(null);
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const locationMessageTimerRef = useRef<number | null>(null);
  const routeImportSessionRef = useRef(0);


  const [status, setStatus] = useState<MapLoadStatus>('loading');
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>('idle');
  const [locationMessage, setLocationMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRouteExportDialogOpen, setIsRouteExportDialogOpen] =
    useState(false);
  const [locationSearchResetVersion, setLocationSearchResetVersion] =
    useState(0);
  const [routeExportDefaultName, setRouteExportDefaultName] = useState('');
  const [baseMapStyle, setBaseMapStyle] = useState<BaseMapStyle>(
    DEFAULT_BASE_MAP_STYLE,
  );
  const [areHikingTrailsVisible, setAreHikingTrailsVisible] =
    useState(getInitialHikingTrailsVisibility);
  const [routeElevationStatus, setRouteElevationStatus] =
    useState<RouteElevationStatus>('loading');
  const [routeElevation, setRouteElevation] =
    useState<RouteElevationSummary | null>(null);
  const [routeMapHoverDistanceMeters, setRouteMapHoverDistanceMeters] =
    useState<number | null>(null);
  const [importedRouteSegments, setImportedRouteSegments] = useState<
    Coordinate[][]
  >([]);
  const [importedRouteElevationSummary, setImportedRouteElevationSummary] =
    useState<RouteElevationSummary | null>(null);
  const initialMapInformationVisibility = useMemo(
    resolveInitialMapInformationLayerVisibility,
    [],
  );
  const mapRuntimeRef = useMapRuntime({
    mapTargetRef,
    fullscreenElementRef: appRef,
    initialVisibility: {
      hikingTrails: areHikingTrailsVisible,
      trailClosures: initialMapInformationVisibility.trailClosures,
      shootingDangerZones:
        initialMapInformationVisibility.shootingDangerZones,
      publicTransportStops:
        initialMapInformationVisibility.publicTransportStops,
    },
    onLoadStatusChange: setStatus,
    onFullscreenChange: setIsFullscreen,
  });
  /**
   * Clears both the temporary marker and the search control when another map
   * workflow takes priority over the selected location.
   */
  const clearSelectedSearchResult = useCallback(() => {
    const marker = mapRuntimeRef.current?.searchResultMarker;

    if (marker) {
      clearSearchResultMarker(marker);
    }

    setLocationSearchResetVersion((version) => version + 1);
  }, [mapRuntimeRef]);

  useEffect(() => {
    const marker = mapRuntimeRef.current?.searchResultMarker;

    // A selected location and its label belong to the same temporary search
    // context. A language change invalidates both instead of leaving an
    // unexplained marker after the search control has been reset.
    if (marker) {
      clearSearchResultMarker(marker);
    }
  }, [language, mapRuntimeRef]);

  const handleRouteGeometryChanged = useCallback(() => {
    // Elevations belong to the previous immutable geometry until the debounced
    // profile request completes for the newly committed route state.
    setRouteElevation(null);
    setRouteElevationStatus('loading');
  }, []);

  const handleRoutePointerInteractionStarted = useCallback(() => {
    const marker = mapRuntimeRef.current?.routeProfileMarker;

    if (marker) {
      updateRouteProfileMarker(marker, null);
    }
    setRouteMapHoverDistanceMeters(null);
  }, [mapRuntimeRef]);

  const handleRouteCreationStarted = useCallback(() => {
    clearSelectedSearchResult();

    if (importedRouteSegments.length === 0) {
      return;
    }

    const importedDisplay = mapRuntimeRef.current?.importedRouteDisplay;

    if (importedDisplay) {
      updateImportedRouteDisplay(importedDisplay, []);
    }

    setImportedRouteSegments([]);
    setImportedRouteElevationSummary(null);
  }, [clearSelectedSearchResult, importedRouteSegments.length, mapRuntimeRef]);

  const {
    routeHistory,
    routeCoordinates,
    isRouteCreationActive,
    isRouteSnapEnabled,
    isRouteOperationPending,
    routeMessage,
    routeMessageType,
    routeContextHint,
    toggleRouteCreation,
    toggleRouteSnap,
    undoRoutePoint,
    redoRoutePoint,
    reverseRoute,
    toggleRouteLoop,
    deleteRoute,
    replaceWithImportedItinerary,
    showTemporaryRouteMessage,
    isPointerInteractionActive,
  } = useEditableRoute({
    mapRuntimeRef,
    mapTargetRef,
    t,
    onRouteCreationStarted: handleRouteCreationStarted,
    onRouteGeometryChanged: handleRouteGeometryChanged,
    onPointerInteractionStarted: handleRoutePointerInteractionStarted,
  });

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
      const marker = mapRuntimeRef.current?.routeProfileMarker;

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
    [mapRuntimeRef, routeProfilePositionIndex],
  );

  const {
    areTrailClosuresVisible,
    setAreTrailClosuresVisible,
    areShootingDangerZonesVisible,
    setAreShootingDangerZonesVisible,
    arePublicTransportStopsVisible,
    setArePublicTransportStopsVisible,
    trailClosurePopup,
    shootingDangerZonePopup,
    publicTransportStopPopup,
    closeMapInformationPopup,
  } = useMapInformationLayers({
    mapRuntimeRef,
    initialVisibility: initialMapInformationVisibility,
    language,
    isRouteCreationActive,
    onInformationSelected: clearSelectedSearchResult,
  });

  /** Opens the route-name dialog before any GPX content is generated. */
  const requestRouteExport = () => {
    if (
      isRouteOperationPending ||
      routeHistory.steps.length < 2
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
    if (isRouteOperationPending) {
      return;
    }

    try {
      downloadRouteGpx(
        routeHistory.steps,
        routeName,
        routeElevation?.points ?? [],
        routeHistory.closure,
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
    const map = mapRuntimeRef.current?.map;
    const display = mapRuntimeRef.current?.importedRouteDisplay;

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

      clearSelectedSearchResult();
      replaceWithImportedItinerary();
      updateImportedRouteDisplay(display, projectedSegments);
      setImportedRouteSegments(projectedSegments);
      setImportedRouteElevationSummary(embeddedElevationSummary);

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

  const changeZoom = (delta: number) => {
    const view = mapRuntimeRef.current?.map.getView();
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

  const selectSearchResult = (result: LocationSearchResult) => {
    const map = mapRuntimeRef.current?.map;
    const marker = mapRuntimeRef.current?.searchResultMarker;

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
    const map = mapRuntimeRef.current?.map;
    const marker = mapRuntimeRef.current?.userLocationMarker;

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

  useEffect(
    () => () => {
      clearLocationMessageTimer();
      routeImportSessionRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    mapRuntimeRef.current?.setBaseMapStyle(baseMapStyle);
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
    mapRuntimeRef.current?.setHikingTrailsVisible(
      areHikingTrailsVisible,
    );
  }, [areHikingTrailsVisible]);

  /** Clears any stale route/profile hover position when geometry changes. */
  useEffect(() => {
    const marker = mapRuntimeRef.current?.routeProfileMarker;

    if (marker) {
      updateRouteProfileMarker(marker, null);
    }
    setRouteMapHoverDistanceMeters(null);
  }, [routeProfilePositionIndex]);

  /**
   * Mirrors map pointer movement onto the route and, when open, the elevation
   * profile. The nearest route coordinate is found in LV95 with a tolerance
   * derived from screen pixels so the interaction remains stable at every zoom.
   */
  useEffect(() => {
    const map = mapRuntimeRef.current?.map;
    const marker = mapRuntimeRef.current?.routeProfileMarker;

    if (!map || !marker || routeProfilePositionIndex.segments.length === 0) {
      return;
    }

    const clearRouteMapHover = () => {
      updateRouteProfileMarker(marker, null);
      setRouteMapHoverDistanceMeters(null);
    };

    const handleRoutePointerMove = (event: MapBrowserEvent) => {
      const pointerType =
        (event.originalEvent as PointerEvent).pointerType;

      if (
        (pointerType && pointerType !== 'mouse' && pointerType !== 'pen') ||
        isPointerInteractionActive() ||
        isRouteOperationPending
      ) {
        clearRouteMapHover();
        return;
      }

      const resolution = map.getView().getResolution();

      if (!resolution) {
        clearRouteMapHover();
        return;
      }

      const position = getClosestRouteProfilePosition(
        routeProfilePositionIndex,
        event.coordinate,
        resolution * ROUTE_PROFILE_HOVER_TOLERANCE_PX,
      );

      updateRouteProfileMarker(marker, position?.coordinate ?? null);
      setRouteMapHoverDistanceMeters(position?.distanceMeters ?? null);
    };

    const mapTarget = map.getTargetElement();
    map.on('pointermove', handleRoutePointerMove);
    mapTarget.addEventListener('pointerleave', clearRouteMapHover);

    return () => {
      map.un('pointermove', handleRoutePointerMove);
      mapTarget.removeEventListener('pointerleave', clearRouteMapHover);
      clearRouteMapHover();
    };
  }, [
    isPointerInteractionActive,
    isRouteOperationPending,
    mapRuntimeRef,
    routeProfilePositionIndex,
  ]);

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
        key={`${language}:${locationSearchResetVersion}`}
        onSearchFocus={closeMapInformationPopup}
        onSelect={selectSearchResult}
      />

      <nav className="map-controls" aria-label={t('map.controls')}>
        <RouteControls
          isActive={isRouteCreationActive}
          isSnapEnabled={isRouteSnapEnabled}
          isBusy={isRouteOperationPending}
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
          onToggleSnap={toggleRouteSnap}
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
          routeHoverDistanceMeters={routeMapHoverDistanceMeters}
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

/**
 * Business context: coordinates the map-centred application shell and owns the
 * imperative OpenLayers lifecycle. It connects search, geolocation, fullscreen,
 * route history, dynamic swissTLM3D loading, and route-editing controls while
 * keeping provider/network details in dedicated modules.
 */
import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from 'ol/coordinate.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { defaults as defaultControls, ScaleLine } from 'ol/control.js';
import { containsCoordinate } from 'ol/extent.js';
import TileLayer from 'ol/layer/Tile.js';
import { fromLonLat } from 'ol/proj.js';
import LocationSearch from './components/LocationSearch';
import RouteControls from './components/RouteControls';
import {
  createHikingTrailsSource,
  createSwissTopoRasterSource,
  DEFAULT_MAP_CENTER,
  HIKING_TRAILS_MIN_ZOOM,
  LOCATION_SEARCH_ZOOM,
  MAP_EXTENT,
  MAP_ZOOM,
  USER_LOCATION_ZOOM,
} from './map/config';
import {
  createRouteDisplay,
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

/** Returns squared horizontal distance in map units for inexpensive continuity checks. */
function coordinateDistanceSquared(
  first: Coordinate,
  second: Coordinate,
): number {
  const deltaX = first[0] - second[0];
  const deltaY = first[1] - second[1];
  return deltaX * deltaX + deltaY * deltaY;
}

/** Root application component and sole owner of the OpenLayers Map instance. */
export default function App() {
  const appRef = useRef<HTMLElement>(null);
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const userLocationMarkerRef = useRef<UserLocationMarker | null>(null);
  const searchResultMarkerRef = useRef<SearchResultMarker | null>(null);
  const routeDisplayRef = useRef<RouteDisplay | null>(null);
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

  if (!routingLoaderRef.current) {
    routingLoaderRef.current = new DynamicRoutingNetworkLoader();
  }

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>('idle');
  const [locationMessage, setLocationMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  /**
   * Keeps the synchronous ref and React render state on the same immutable
   * history object.
   */
  const commitRouteHistory = (history: RouteHistory) => {
    routeHistoryRef.current = history;
    setRouteHistory(history);
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
        'La géolocalisation n’est pas disponible dans ce navigateur.',
      );
      return;
    }

    clearLocationMessageTimer();
    setLocationMessage('Recherche de votre position…');
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
            'Votre position se trouve hors de la zone couverte.',
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
            'L’accès à votre position a été refusé.',
          [GeolocationPositionError.POSITION_UNAVAILABLE]:
            'Votre position n’a pas pu être déterminée.',
          [GeolocationPositionError.TIMEOUT]:
            'La recherche de votre position a pris trop de temps.',
        };

        setLocationStatus('error');
        showTemporaryLocationMessage(
          messages[error.code] ??
            'Une erreur est survenue pendant la géolocalisation.',
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

    const rasterSource = createSwissTopoRasterSource();
    const hikingTrailsSource = createHikingTrailsSource();
    const userLocationMarker = createUserLocationMarker();
    const searchResultMarker = createSearchResultMarker();
    const routeDisplay = createRouteDisplay();

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
      setErrorMessage('');
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
      setErrorMessage(
        'Le navigateur n’a pas réussi à télécharger les tuiles swisstopo.',
      );
    };

    rasterSource.on('tileloadend', handleTileLoaded);
    rasterSource.on('tileloaderror', handleTileError);

    const map = new Map({
      target,
      layers: [
        new TileLayer({
          source: rasterSource,
        }),
        new TileLayer({
          source: hikingTrailsSource,
          minZoom: HIKING_TRAILS_MIN_ZOOM,
          zIndex: 10,
        }),
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
    userLocationMarkerRef.current = userLocationMarker;
    searchResultMarkerRef.current = searchResultMarker;
    routeDisplayRef.current = routeDisplay;

    return () => {
      clearLocationMessageTimer();
      clearRouteMessageTimer();
      routingAbortControllerRef.current?.abort();
      document.removeEventListener(
        'fullscreenchange',
        handleFullscreenChange,
      );
      rasterSource.un('tileloadend', handleTileLoaded);
      rasterSource.un('tileloaderror', handleTileError);
      map.setTarget(undefined);
      mapRef.current = null;
      userLocationMarkerRef.current = null;
      searchResultMarkerRef.current = null;
      routeDisplayRef.current = null;
    };
  }, []);

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
        appendRouteStep(expectedSteps, {
          waypoint: clickedCoordinate,
          segment: previousStep
            ? [[...previousStep.waypoint], clickedCoordinate]
            : null,
          mode: 'straight',
        });
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

            if (!snappedCoordinate) {
              showTemporaryRouteMessage(
                'Aucun chemin swissTLM3D n’a été trouvé à proximité de ce point.',
                'error',
              );
              return;
            }

            step = {
              waypoint: [...snappedCoordinate],
              segment: null,
              mode: 'network',
            };
          } else {
            const routedPath = await routingLoader.route(
              previousStep.waypoint,
              clickedCoordinate,
              abortController.signal,
            );

            if (!routedPath || routedPath.coordinates.length < 2) {
              showTemporaryRouteMessage(
                'Aucun chemin connecté n’a été trouvé entre ces deux points.',
                'error',
              );
              return;
            }

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
              'Ce segment est trop long pour le chargement dynamique actuel. Ajoutez un point intermédiaire.',
              'error',
            );
            return;
          }

          console.error('Unable to load or route on swissTLM3D.', error);
          showTemporaryRouteMessage(
            'Le réseau swissTLM3D de cette zone n’a pas pu être chargé.',
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
  }, [isRouteCreationActive, isRouteSnapEnabled]);

  const locationButtonLabel =
    locationStatus === 'located'
      ? 'Recentrer sur ma position'
      : 'Afficher ma position';

  const fullscreenButtonLabel = isFullscreen
    ? 'Quitter le plein écran'
    : 'Afficher en plein écran';

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
        aria-label="Carte nationale suisse interactive"
      />

      <LocationSearch onSelect={selectSearchResult} />

      <nav className="map-controls" aria-label="Contrôles de la carte">
        <RouteControls
          isActive={isRouteCreationActive}
          isSnapEnabled={isRouteSnapEnabled}
          isBusy={isRouteOperationPending}
          canUndo={
            !isRouteOperationPending && routeHistory.steps.length > 0
          }
          canRedo={
            !isRouteOperationPending && routeHistory.redoSteps.length > 0
          }
          onToggle={toggleRouteCreation}
          onUndo={undoRoutePoint}
          onRedo={redoRoutePoint}
          onToggleSnap={() =>
            setIsRouteSnapEnabled((isSnapEnabled) => !isSnapEnabled)
          }
        />

        <div className="zoom-controls">
          <button
            type="button"
            className="map-control-button map-control-button--zoom"
            aria-label="Zoomer"
            title="Zoomer"
            onClick={() => changeZoom(1)}
          >
            +
          </button>

          <button
            type="button"
            className="map-control-button map-control-button--zoom"
            aria-label="Dézoomer"
            title="Dézoomer"
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
            className={[
              'map-control-button',
              'map-control-button--fullscreen',
              isFullscreen ? 'map-control-button--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
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

      {status === 'loading' && (
        <div className="status-card" role="status">
          Chargement de la carte swisstopo…
        </div>
      )}

      {status === 'error' && (
        <div className="status-card status-card--error" role="alert">
          <strong>Impossible de charger la carte.</strong>
          <span>{errorMessage}</span>
          <span>Vérifie la connexion Internet, puis recharge la page.</span>
        </div>
      )}
    </main>
  );
}

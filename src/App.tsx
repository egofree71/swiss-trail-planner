import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { defaults as defaultControls, ScaleLine } from 'ol/control.js';
import { containsCoordinate } from 'ol/extent.js';
import TileLayer from 'ol/layer/Tile.js';
import { fromLonLat } from 'ol/proj.js';
import LocationSearch from './components/LocationSearch';
import type { LocationSearchResult } from './search/locationSearch';
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
  createSearchResultMarker,
  type SearchResultMarker,
  updateSearchResultMarker,
} from './map/searchResult';
import {
  createUserLocationMarker,
  type UserLocationMarker,
  updateUserLocationMarker,
} from './map/userLocation';

type LoadStatus = 'loading' | 'ready' | 'error';
type LocationStatus = 'idle' | 'locating' | 'located' | 'error';

const LOCATION_MESSAGE_DURATION_MS = 6_000;

export default function App() {
  const appRef = useRef<HTMLElement>(null);
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const userLocationMarkerRef = useRef<UserLocationMarker | null>(null);
  const searchResultMarkerRef = useRef<SearchResultMarker | null>(null);
  const locationMessageTimerRef = useRef<number | null>(null);

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>('idle');
  const [locationMessage, setLocationMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

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

    return () => {
      clearLocationMessageTimer();
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
    };
  }, []);

  const locationButtonLabel =
    locationStatus === 'located'
      ? 'Recentrer sur ma position'
      : 'Afficher ma position';

  const fullscreenButtonLabel = isFullscreen
    ? 'Quitter le plein écran'
    : 'Afficher en plein écran';

  return (
    <main className="app" ref={appRef}>
      <div
        ref={mapTargetRef}
        className="map"
        aria-label="Carte nationale suisse interactive"
      />

      <LocationSearch onSelect={selectSearchResult} />

      <nav className="map-controls" aria-label="Contrôles de la carte">
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

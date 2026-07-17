/**
 * Business context: coordinates optional planning information shown above the
 * Via Helvetica map. It persists layer choices, loads passenger stops for the
 * current viewport, and owns the prioritized stop/closure/danger-zone inspection
 * workflow without mixing these asynchronous concerns into the root component.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { Coordinate } from 'ol/coordinate.js';
import MapBrowserEvent from 'ol/MapBrowserEvent.js';
import {
  fetchTrailClosurePopup,
  identifyTrailClosure,
} from '../closures/trailClosures';
import type { TrailClosurePopupStatus } from '../components/TrailClosurePopup';
import type { ShootingDangerZonePopupStatus } from '../components/ShootingDangerZonePopup';
import {
  fetchShootingDangerZonePopup,
  identifyShootingDangerZone,
  updateShootingDangerZoneSelection,
} from '../dangers/shootingDangerZones';
import type { Language } from '../i18n/translations';
import { isAbortedRequest } from '../network/abort';
import {
  getPublicTransportStopFromFeature,
  loadPublicTransportStops,
  PUBLIC_TRANSPORT_STOPS_MIN_ZOOM,
  type PublicTransportStop,
  updatePublicTransportStopsDisplay,
  updatePublicTransportStopSelection,
} from '../transport/publicTransportStops';
import { HIKING_TRAILS_MIN_ZOOM } from './config';
import type { MapRuntime } from './mapRuntime';

/** Browser preference key for the safety-information overlay. */
const TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY =
  'via-helvetica.trail-closures-visible';
/** Browser preference key for the military danger-zone overlay. */
const SHOOTING_DANGER_ZONES_VISIBILITY_STORAGE_KEY =
  'via-helvetica.shooting-danger-zones-visible';
/** Browser preference key for the optional public-transport stop overlay. */
const PUBLIC_TRANSPORT_STOPS_VISIBILITY_STORAGE_KEY =
  'via-helvetica.public-transport-stops-visible';
/** Hit tolerance in screen pixels for selecting compact stop symbols. */
const PUBLIC_TRANSPORT_STOP_HIT_TOLERANCE_PX = 8;

/** Persisted visibility of the three inspectable information layers. */
export interface MapInformationLayerVisibility {
  /** Whether official hiking closures and detours start visible. */
  trailClosures: boolean;
  /** Whether military shooting notices and danger zones start visible. */
  shootingDangerZones: boolean;
  /** Whether filtered passenger public-transport stops start visible. */
  publicTransportStops: boolean;
}

/** Options needed to coordinate all optional map-information workflows. */
export interface UseMapInformationLayersOptions {
  /** Stable ref containing the mounted OpenLayers runtime. */
  mapRuntimeRef: RefObject<MapRuntime | null>;
  /** Visibility snapshot also used when constructing the map runtime. */
  initialVisibility: MapInformationLayerVisibility;
  /** Current interface language used by GeoAdmin and stop normalization. */
  language: Language;
  /** Disables information inspection while route clicks own the map. */
  isRouteCreationActive: boolean;
  /** Clears temporary map context when an information feature is selected. */
  onInformationSelected: () => void;
}

/** State and actions consumed by the root map controls and popup components. */
export interface MapInformationLayersController {
  /** Whether official hiking closures and detours are visible. */
  areTrailClosuresVisible: boolean;
  /** Changes closure visibility and persists the explicit choice. */
  setAreTrailClosuresVisible: Dispatch<SetStateAction<boolean>>;
  /** Whether military shooting notices and danger zones are visible. */
  areShootingDangerZonesVisible: boolean;
  /** Changes military danger-zone visibility and persists the choice. */
  setAreShootingDangerZonesVisible: Dispatch<SetStateAction<boolean>>;
  /** Whether filtered passenger public-transport stops are visible. */
  arePublicTransportStopsVisible: boolean;
  /** Changes public-transport visibility and persists the choice. */
  setArePublicTransportStopsVisible: Dispatch<SetStateAction<boolean>>;
  /** Current localized hiking-closure popup state, when one is open. */
  trailClosurePopup: TrailClosurePopupStatus | null;
  /** Current localized military danger-zone popup state, when one is open. */
  shootingDangerZonePopup: ShootingDangerZonePopupStatus | null;
  /** Selected passenger stop shown in the structured timetable popup. */
  publicTransportStopPopup: PublicTransportStop | null;
  /** Closes every information popup, selection, and pending request. */
  closeMapInformationPopup: () => void;
}

/**
 * Reads one persisted layer choice while preserving a safe product default when
 * browser storage is unavailable or no explicit choice exists.
 *
 * @param key - Local-storage key dedicated to one layer.
 * @param defaultValue - Product default used before the user changes the layer.
 * @returns The stored boolean or the supplied default.
 */
function readStoredVisibility(key: string, defaultValue: boolean): boolean {
  try {
    const storedValue = window.localStorage.getItem(key);

    return storedValue === null ? defaultValue : storedValue === 'true';
  } catch {
    return defaultValue;
  }
}

/**
 * Persists one explicit visibility choice without making storage availability a
 * prerequisite for using the map.
 *
 * @param key - Local-storage key dedicated to one layer.
 * @param visible - Current layer visibility.
 */
function persistVisibility(key: string, visible: boolean): void {
  try {
    window.localStorage.setItem(key, String(visible));
  } catch {
    // Private browsing and restrictive policies must not disable layer controls.
  }
}

/**
 * Resolves the visibility snapshot shared by map construction and the React
 * information-layer controller.
 *
 * @returns Persisted choices with safety overlays enabled and stops disabled by default.
 */
export function resolveInitialMapInformationLayerVisibility(): MapInformationLayerVisibility {
  return {
    trailClosures: readStoredVisibility(
      TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY,
      true,
    ),
    shootingDangerZones: readStoredVisibility(
      SHOOTING_DANGER_ZONES_VISIBILITY_STORAGE_KEY,
      true,
    ),
    publicTransportStops: readStoredVisibility(
      PUBLIC_TRANSPORT_STOPS_VISIBILITY_STORAGE_KEY,
      false,
    ),
  };
}

/**
 * Owns information-layer visibility, loading, inspection priority, and popup
 * lifecycle for the mounted map.
 *
 * @param options - Runtime ref, language, route mode, and selection callback.
 * @returns Controlled visibility values, popup state, and one close action.
 */
export function useMapInformationLayers(
  options: UseMapInformationLayersOptions,
): MapInformationLayersController {
  const {
    mapRuntimeRef,
    initialVisibility,
    language,
    isRouteCreationActive,
    onInformationSelected,
  } = options;
  const informationRequestRef = useRef<AbortController | null>(null);
  const [areTrailClosuresVisible, setAreTrailClosuresVisible] = useState(
    initialVisibility.trailClosures,
  );
  const [areShootingDangerZonesVisible, setAreShootingDangerZonesVisible] =
    useState(initialVisibility.shootingDangerZones);
  const [arePublicTransportStopsVisible, setArePublicTransportStopsVisible] =
    useState(initialVisibility.publicTransportStops);
  const [trailClosurePopup, setTrailClosurePopup] =
    useState<TrailClosurePopupStatus | null>(null);
  const [shootingDangerZonePopup, setShootingDangerZonePopup] =
    useState<ShootingDangerZonePopupStatus | null>(null);
  const [publicTransportStopPopup, setPublicTransportStopPopup] =
    useState<PublicTransportStop | null>(null);

  /** Cancels obsolete work and clears both structured and vector selections. */
  const closeMapInformationPopup = useCallback(() => {
    informationRequestRef.current?.abort();
    informationRequestRef.current = null;
    setTrailClosurePopup(null);
    setShootingDangerZonePopup(null);
    setPublicTransportStopPopup(null);

    const runtime = mapRuntimeRef.current;

    if (!runtime) {
      return;
    }

    updatePublicTransportStopSelection(
      runtime.publicTransportStopsDisplay,
      null,
    );
    updateShootingDangerZoneSelection(
      runtime.shootingDangerZoneSelectionDisplay,
      null,
    );
  }, [mapRuntimeRef]);

  useEffect(() => {
    persistVisibility(
      TRAIL_CLOSURES_VISIBILITY_STORAGE_KEY,
      areTrailClosuresVisible,
    );
  }, [areTrailClosuresVisible]);

  useEffect(() => {
    persistVisibility(
      SHOOTING_DANGER_ZONES_VISIBILITY_STORAGE_KEY,
      areShootingDangerZonesVisible,
    );
  }, [areShootingDangerZonesVisible]);

  useEffect(() => {
    persistVisibility(
      PUBLIC_TRANSPORT_STOPS_VISIBILITY_STORAGE_KEY,
      arePublicTransportStopsVisible,
    );
  }, [arePublicTransportStopsVisible]);

  useEffect(() => {
    const runtime = mapRuntimeRef.current;

    if (!runtime) {
      return;
    }

    runtime.setTrailClosuresVisible(areTrailClosuresVisible);

    if (!areTrailClosuresVisible && trailClosurePopup) {
      closeMapInformationPopup();
    }
  }, [
    areTrailClosuresVisible,
    closeMapInformationPopup,
    mapRuntimeRef,
    trailClosurePopup,
  ]);

  useEffect(() => {
    const runtime = mapRuntimeRef.current;

    if (!runtime) {
      return;
    }

    runtime.setShootingDangerZonesVisible(areShootingDangerZonesVisible);

    if (!areShootingDangerZonesVisible && shootingDangerZonePopup) {
      closeMapInformationPopup();
    }
  }, [
    areShootingDangerZonesVisible,
    closeMapInformationPopup,
    mapRuntimeRef,
    shootingDangerZonePopup,
  ]);

  useEffect(() => {
    const runtime = mapRuntimeRef.current;

    if (!runtime) {
      return;
    }

    const { map, publicTransportStopsDisplay: display } = runtime;
    runtime.setPublicTransportStopsVisible(
      arePublicTransportStopsVisible,
    );

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
          if (isAbortedRequest(error, request.signal)) {
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
    mapRuntimeRef,
  ]);

  // Closure and shooting-danger popup templates are localized server-side,
  // while stop names and modes are reloaded for the selected language.
  useEffect(() => {
    closeMapInformationPopup();
  }, [closeMapInformationPopup, language]);

  /**
   * Registers one prioritized click pipeline for optional information layers.
   * Already loaded passenger stops win first, then closures, then military
   * danger zones, so overlapping official portrayals produce deterministic UI.
   */
  useEffect(() => {
    const runtime = mapRuntimeRef.current;
    const hasVisibleInformationLayer =
      areTrailClosuresVisible ||
      areShootingDangerZonesVisible ||
      arePublicTransportStopsVisible;

    if (
      !runtime ||
      !hasVisibleInformationLayer ||
      isRouteCreationActive
    ) {
      if (isRouteCreationActive) {
        closeMapInformationPopup();
      }
      return;
    }

    const { map } = runtime;

    const handleInformationLayerClick = (event: MapBrowserEvent) => {
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
        const stopDisplay = runtime.publicTransportStopsDisplay;
        const stop = map.forEachFeatureAtPixel(
          event.pixel,
          (feature) => getPublicTransportStopFromFeature(feature),
          {
            hitTolerance: PUBLIC_TRANSPORT_STOP_HIT_TOLERANCE_PX,
            layerFilter: (layer) => layer === stopDisplay.layer,
          },
        );

        // Stops are already filtered and localized during viewport loading, so
        // opening their compact popup requires no additional network request.
        if (stop) {
          onInformationSelected();
          updatePublicTransportStopSelection(stopDisplay, stop);
          setPublicTransportStopPopup(stop);
          return;
        }
      }

      if (!canInspectClosures && !canInspectShootingDangerZones) {
        return;
      }

      const abortController = new AbortController();
      informationRequestRef.current = abortController;
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
                onInformationSelected();
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
              onInformationSelected();
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
                onInformationSelected();
                updateShootingDangerZoneSelection(
                  runtime.shootingDangerZoneSelectionDisplay,
                  dangerZone,
                );
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
              onInformationSelected();
              setShootingDangerZonePopup({ state: 'error', html: null });
            }
          }
        } finally {
          if (informationRequestRef.current === abortController) {
            informationRequestRef.current = null;
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
      informationRequestRef.current?.abort();
      informationRequestRef.current = null;
    };
  }, [
    arePublicTransportStopsVisible,
    areShootingDangerZonesVisible,
    areTrailClosuresVisible,
    closeMapInformationPopup,
    isRouteCreationActive,
    language,
    mapRuntimeRef,
    onInformationSelected,
  ]);

  useEffect(
    () => () => {
      informationRequestRef.current?.abort();
    },
    [],
  );

  return {
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
  };
}

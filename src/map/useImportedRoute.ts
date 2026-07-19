/**
 * Business context: owns the lifecycle of the single read-only GPX itinerary.
 * It validates and parses a user-selected file locally, converts geometry to
 * native LV95, reuses complete embedded elevations when possible, updates the
 * purple OpenLayers display, and frames the imported route without exposing
 * file-read sessions or stale-result guards to the application shell.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Coordinate } from 'ol/coordinate.js';
import {
  MAX_GPX_FILE_SIZE_BYTES,
  parseGpxRoute,
} from '../import/gpx';
import type { TranslationKey } from '../i18n/translations';
import {
  createImportedRouteElevationSummary,
  type RouteElevationSummary,
} from '../metrics/routeMetrics';
import { IMPORTED_ROUTE_MAX_ZOOM } from './config';
import { updateImportedRouteDisplay } from './importedRoute';
import type { MapRuntime } from './mapRuntime';
import { fromWgs84Coordinates } from './projection';

/** Inputs required by the imported-GPX workflow. */
export interface UseImportedRouteOptions {
  /** Shared OpenLayers runtime containing the map and imported-route display. */
  mapRuntimeRef: RefObject<MapRuntime | null>;
  /** Typed interface translation helper. */
  t: (key: TranslationKey) => string;
  /** Clears incompatible workflows after a valid GPX has been fully prepared. */
  onImportAccepted: () => void;
  /** Publishes one localized import error through the shared route message area. */
  onImportError: (message: string) => void;
}

/** State and actions exposed to the application shell and metrics pipeline. */
export interface ImportedRouteController {
  /** Independent projected GPX segments; an empty array means no imported route. */
  segments: Coordinate[][];
  /** Embedded GPX profile summary, or null when GeoAdmin must provide elevations. */
  elevationSummary: RouteElevationSummary | null;
  /** Validates and loads one browser-selected GPX file. */
  importRouteFile: (file: File) => Promise<void>;
  /** Cancels pending reads and clears the current imported route immediately. */
  clearImportedRoute: () => void;
}

/** Map animation duration in milliseconds; long enough to reveal the framed route without feeling sluggish. */
const IMPORTED_ROUTE_FIT_DURATION_MS = 600;

/**
 * View padding in screen pixels. The larger bottom margin keeps the framed GPX
 * visible above the itinerary statistics and elevation profile controls.
 */
const IMPORTED_ROUTE_FIT_PADDING_PX: [number, number, number, number] = [
  80,
  80,
  180,
  80,
];

/**
 * Coordinates local GPX file handling and the read-only map display.
 *
 * @param options - Shared runtime plus cross-workflow and message callbacks.
 * @returns Imported geometry, optional embedded elevations, and lifecycle actions.
 */
export function useImportedRoute(
  options: UseImportedRouteOptions,
): ImportedRouteController {
  const importSessionRef = useRef(0);
  const [segments, setSegments] = useState<Coordinate[][]>([]);
  const [elevationSummary, setElevationSummary] =
    useState<RouteElevationSummary | null>(null);

  const clearImportedRoute = useCallback(() => {
    // Advancing the session invalidates a file read that may still be resolving
    // when route creation or another workflow takes priority.
    importSessionRef.current += 1;

    const display = options.mapRuntimeRef.current?.importedRouteDisplay;

    if (display) {
      updateImportedRouteDisplay(display, []);
    }

    setSegments([]);
    setElevationSummary(null);
  }, [options.mapRuntimeRef]);

  const importRouteFile = useCallback(
    async (file: File) => {
      const map = options.mapRuntimeRef.current?.map;
      const display = options.mapRuntimeRef.current?.importedRouteDisplay;

      if (!map || !display) {
        return;
      }

      const importSession = ++importSessionRef.current;

      if (file.size > MAX_GPX_FILE_SIZE_BYTES) {
        options.onImportError(options.t('route.importTooLarge'));
        return;
      }

      try {
        const importedRoute = parseGpxRoute(await file.text(), file.name);

        // A slower previous file read must not replace a newer selection or a
        // route-creation action that explicitly cleared the imported workflow.
        if (importSession !== importSessionRef.current) {
          return;
        }

        const projectedSegments = importedRoute.segments.map((segment) =>
          fromWgs84Coordinates(segment.coordinates),
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
            // Geometry remains useful when unusual embedded elevations cannot
            // be measured; the shared metrics hook will request GeoAdmin data.
            console.warn(
              'Unable to use GPX elevations; falling back to GeoAdmin.',
              error,
            );
          }
        }

        options.onImportAccepted();
        updateImportedRouteDisplay(display, projectedSegments);
        setSegments(projectedSegments);
        setElevationSummary(embeddedElevationSummary);

        const importedExtent = display.source.getExtent();

        if (importedExtent) {
          map.getView().fit(importedExtent, {
            duration: IMPORTED_ROUTE_FIT_DURATION_MS,
            maxZoom: IMPORTED_ROUTE_MAX_ZOOM,
            padding: IMPORTED_ROUTE_FIT_PADDING_PX,
          });
        }
      } catch (error) {
        if (importSession !== importSessionRef.current) {
          return;
        }

        console.error('Unable to import the GPX route.', error);
        options.onImportError(options.t('route.importError'));
      }
    },
    [
      options.mapRuntimeRef,
      options.onImportAccepted,
      options.onImportError,
      options.t,
    ],
  );

  useEffect(
    () => () => {
      // File.text() cannot be aborted. Session invalidation prevents a resolved
      // promise from mutating state after the hook has unmounted.
      importSessionRef.current += 1;
    },
    [],
  );

  return {
    segments,
    elevationSummary,
    importRouteFile,
    clearImportedRoute,
  };
}

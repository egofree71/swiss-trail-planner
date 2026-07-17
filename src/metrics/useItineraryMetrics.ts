/**
 * Business context: owns the shared statistics and profile exploration for the
 * single current itinerary, whether it is an editable route or an imported GPX.
 * It prevents stale elevation responses from crossing geometry changes and
 * keeps map/profile pointer synchronization independent from the application
 * shell and route-editing controller.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react';
import MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type { Coordinate } from 'ol/coordinate.js';
import type { MapRuntime } from '../map/mapRuntime';
import {
  createRouteProfilePositionIndex,
  getClosestRouteProfilePosition,
  getRouteProfileCoordinate,
  updateRouteProfileMarker,
} from '../map/routeProfileMarker';
import {
  calculateRouteSegmentsDistance,
  estimateHikingDuration,
  fetchRouteElevationSummary,
  fetchRouteSegmentsElevationSummary,
  type RouteElevationStatus,
  type RouteElevationSummary,
} from './routeMetrics';

/** Inputs required to measure and explore the current itinerary. */
export interface UseItineraryMetricsOptions {
  /** Shared runtime containing the map and route-profile marker. */
  mapRuntimeRef: RefObject<MapRuntime | null>;
  /** Flattened editable geometry, empty when a GPX is current. */
  editableRouteCoordinates: Coordinate[];
  /** Independent read-only GPX segments, empty when a route is current. */
  importedRouteSegments: Coordinate[][];
  /** Complete profile derived from embedded GPX elevations when available. */
  importedRouteElevationSummary: RouteElevationSummary | null;
  /** Whether a route drag currently owns pointer movement. */
  isRoutePointerInteractionActive: boolean;
  /** Synchronous guard for direct OpenLayers pointer events. */
  isPointerInteractionActive: () => boolean;
  /** Whether a serialized route mutation is still pending. */
  isRouteOperationPending: boolean;
}

/** Statistics and profile-link state consumed by the application shell. */
export interface ItineraryMetricsController {
  /** Current route or independent imported GPX segments. */
  activeRouteSegments: Coordinate[][];
  /** Total horizontal itinerary distance in metres. */
  distanceMeters: number;
  /** Availability state of altitude-dependent figures. */
  elevationStatus: RouteElevationStatus;
  /** Current elevation summary when available. */
  elevation: RouteElevationSummary | null;
  /** Swiss hiking-time estimate in minutes when elevation is available. */
  durationMinutes: number | null;
  /** Cumulative distance selected by hovering the itinerary on the map. */
  mapHoverDistanceMeters: number | null;
  /** Mirrors chart pointer distance onto the shared map marker. */
  handleProfileHoverDistanceChange: (distanceMeters: number | null) => void;
}

/** Delay in milliseconds before requesting elevations after a route mutation. */
const ELEVATION_REQUEST_DEBOUNCE_MS = 250;
/** Screen-space route tolerance for the bidirectional map/profile hover link. */
const ROUTE_PROFILE_HOVER_TOLERANCE_PX = 10;

/** Elevation result tied by identity to one immutable segment collection. */
interface ElevationRequestResult {
  /** Exact segment array for which the request completed. */
  segments: Coordinate[][];
  /** Ready or failed result state. */
  status: Exclude<RouteElevationStatus, 'loading'>;
  /** Valid summary for a ready result, otherwise null. */
  summary: RouteElevationSummary | null;
}

/**
 * Calculates and explores the current itinerary without owning route mutations.
 *
 * @param options - Current geometry, imported elevations, and pointer guards.
 * @returns Statistics plus bidirectional map/profile hover state.
 */
export function useItineraryMetrics(
  options: UseItineraryMetricsOptions,
): ItineraryMetricsController {
  const [elevationResult, setElevationResult] =
    useState<ElevationRequestResult | null>(null);
  const [mapHoverDistanceMeters, setMapHoverDistanceMeters] =
    useState<number | null>(null);

  const activeRouteSegments = useMemo(
    () =>
      options.editableRouteCoordinates.length >= 2
        ? [options.editableRouteCoordinates]
        : options.importedRouteSegments,
    [options.editableRouteCoordinates, options.importedRouteSegments],
  );
  const routeProfilePositionIndex = useMemo(
    () => createRouteProfilePositionIndex(activeRouteSegments),
    [activeRouteSegments],
  );
  const distanceMeters = useMemo(
    () => calculateRouteSegmentsDistance(activeRouteSegments),
    [activeRouteSegments],
  );
  const embeddedImportedElevation =
    options.editableRouteCoordinates.length < 2
      ? options.importedRouteElevationSummary
      : null;
  const currentRequestResult =
    elevationResult?.segments === activeRouteSegments
      ? elevationResult
      : null;
  const elevation = embeddedImportedElevation ?? currentRequestResult?.summary ?? null;
  const elevationStatus: RouteElevationStatus = embeddedImportedElevation
    ? 'ready'
    : currentRequestResult?.status ?? 'loading';
  const durationMinutes = elevation
    ? estimateHikingDuration(elevation.points)
    : null;

  const clearMapHover = useCallback(() => {
    const marker = options.mapRuntimeRef.current?.routeProfileMarker;

    if (marker) {
      updateRouteProfileMarker(marker, null);
    }
    setMapHoverDistanceMeters(null);
  }, [options.mapRuntimeRef]);

  const handleProfileHoverDistanceChange = useCallback(
    (distance: number | null) => {
      const marker = options.mapRuntimeRef.current?.routeProfileMarker;

      if (!marker) {
        return;
      }

      updateRouteProfileMarker(
        marker,
        distance === null
          ? null
          : getRouteProfileCoordinate(routeProfilePositionIndex, distance),
      );
    },
    [options.mapRuntimeRef, routeProfilePositionIndex],
  );

  /** Clears stale hover state after geometry changes or when route dragging starts. */
  useEffect(() => {
    clearMapHover();
  }, [
    clearMapHover,
    options.isRoutePointerInteractionActive,
    routeProfilePositionIndex,
  ]);

  /**
   * Mirrors map pointer movement onto the route and, when open, the elevation
   * profile. A pixel-derived LV95 tolerance stays stable at every zoom level.
   */
  useEffect(() => {
    const map = options.mapRuntimeRef.current?.map;
    const marker = options.mapRuntimeRef.current?.routeProfileMarker;

    if (!map || !marker || routeProfilePositionIndex.segments.length === 0) {
      return;
    }

    const handleRoutePointerMove = (event: MapBrowserEvent) => {
      const pointerType =
        (event.originalEvent as PointerEvent).pointerType;

      if (
        (pointerType && pointerType !== 'mouse' && pointerType !== 'pen') ||
        options.isPointerInteractionActive() ||
        options.isRouteOperationPending
      ) {
        clearMapHover();
        return;
      }

      const resolution = map.getView().getResolution();

      if (!resolution) {
        clearMapHover();
        return;
      }

      const position = getClosestRouteProfilePosition(
        routeProfilePositionIndex,
        event.coordinate,
        resolution * ROUTE_PROFILE_HOVER_TOLERANCE_PX,
      );

      updateRouteProfileMarker(marker, position?.coordinate ?? null);
      setMapHoverDistanceMeters(position?.distanceMeters ?? null);
    };

    const mapTarget = map.getTargetElement();
    map.on('pointermove', handleRoutePointerMove);
    mapTarget.addEventListener('pointerleave', clearMapHover);

    return () => {
      map.un('pointermove', handleRoutePointerMove);
      mapTarget.removeEventListener('pointerleave', clearMapHover);
      clearMapHover();
    };
  }, [
    clearMapHover,
    options.isPointerInteractionActive,
    options.isRouteOperationPending,
    options.mapRuntimeRef,
    routeProfilePositionIndex,
  ]);

  /**
   * Retrieves a fresh elevation profile after geometry settles. The completed
   * result retains the exact segment-array identity, so a late response can
   * never appear beside newer distance or route geometry.
   */
  useEffect(() => {
    if (activeRouteSegments.length === 0 || distanceMeters <= 0) {
      setElevationResult(null);
      return;
    }

    if (embeddedImportedElevation !== null) {
      return;
    }

    const abortController = new AbortController();
    const requestSegments = activeRouteSegments;
    const requestTimer = window.setTimeout(() => {
      const elevationRequest =
        requestSegments.length === 1
          ? fetchRouteElevationSummary(
              requestSegments[0],
              distanceMeters,
              abortController.signal,
            )
          : fetchRouteSegmentsElevationSummary(
              requestSegments,
              abortController.signal,
            );

      void elevationRequest
        .then((summary) => {
          if (!abortController.signal.aborted) {
            setElevationResult({
              segments: requestSegments,
              status: 'ready',
              summary,
            });
          }
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }

          console.error('Unable to load the route elevation profile.', error);
          setElevationResult({
            segments: requestSegments,
            status: 'error',
            summary: null,
          });
        });
    }, ELEVATION_REQUEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(requestTimer);
      abortController.abort();
    };
  }, [activeRouteSegments, distanceMeters, embeddedImportedElevation]);

  return {
    activeRouteSegments,
    distanceMeters,
    elevationStatus,
    elevation,
    durationMinutes,
    mapHoverDistanceMeters,
    handleProfileHoverDistanceChange,
  };
}

/**
 * Business context: reduces redundant BAV stop requests while users explore a
 * local area. One buffered request can serve several nearby viewports, but only
 * while the portrayal scale and map canvas size remain unchanged.
 */
import type { Extent } from 'ol/extent.js';
import { containsExtent } from 'ol/extent.js';

/**
 * Each request extends the visible width and height by 50 percent. This leaves
 * a 25-percent navigation margin on every side without quadrupling the queried
 * surface in dense city centres.
 */
const PUBLIC_TRANSPORT_STOPS_BUFFER_FACTOR = 1.5;

/** Loaded or pending geographic coverage for one exact map scale context. */
export interface PublicTransportStopsViewportCoverage {
  /** Buffered EPSG:2056 envelope requested from GeoAdmin. */
  requestExtent: Extent;
  /** OpenLayers zoom at which the request was prepared. */
  zoom: number;
  /** CSS-pixel canvas size used by the identify portrayal context. */
  imageSize: [number, number];
}

/**
 * Expands one viewport around its centre while preserving its aspect ratio.
 *
 * @param viewportExtent - Visible EPSG:2056 map extent.
 * @returns Buffered request extent used for passenger-stop loading.
 */
export function createBufferedPublicTransportStopsExtent(
  viewportExtent: Extent,
): Extent {
  const centerX = (viewportExtent[0] + viewportExtent[2]) / 2;
  const centerY = (viewportExtent[1] + viewportExtent[3]) / 2;
  const halfWidth =
    ((viewportExtent[2] - viewportExtent[0]) *
      PUBLIC_TRANSPORT_STOPS_BUFFER_FACTOR) /
    2;
  const halfHeight =
    ((viewportExtent[3] - viewportExtent[1]) *
      PUBLIC_TRANSPORT_STOPS_BUFFER_FACTOR) /
    2;

  return [
    centerX - halfWidth,
    centerY - halfHeight,
    centerX + halfWidth,
    centerY + halfHeight,
  ];
}

/**
 * Captures the buffered request envelope and the scale context that makes it
 * reusable for later nearby pans.
 *
 * @param viewportExtent - Visible EPSG:2056 map extent.
 * @param zoom - Current OpenLayers zoom.
 * @param imageSize - Current map canvas size in CSS pixels.
 * @returns Immutable coverage metadata for a pending or completed request.
 */
export function createPublicTransportStopsViewportCoverage(
  viewportExtent: Extent,
  zoom: number,
  imageSize: [number, number],
): PublicTransportStopsViewportCoverage {
  return {
    requestExtent: createBufferedPublicTransportStopsExtent(viewportExtent),
    zoom,
    imageSize: [...imageSize],
  };
}

/**
 * Reports whether one pending or completed request can serve the current view.
 * A zoom or canvas-size change invalidates reuse because GeoAdmin identify uses
 * both values to describe portrayal scale, even when the geometry still fits.
 *
 * @param coverage - Existing pending or completed request metadata.
 * @param viewportExtent - Current visible EPSG:2056 extent.
 * @param zoom - Current OpenLayers zoom.
 * @param imageSize - Current map canvas size in CSS pixels.
 * @returns Whether another provider request can be skipped safely.
 */
export function publicTransportStopsCoverageContainsViewport(
  coverage: PublicTransportStopsViewportCoverage | null,
  viewportExtent: Extent,
  zoom: number,
  imageSize: [number, number],
): boolean {
  return Boolean(
    coverage &&
      coverage.zoom === zoom &&
      coverage.imageSize[0] === imageSize[0] &&
      coverage.imageSize[1] === imageSize[1] &&
      containsExtent(coverage.requestExtent, viewportExtent),
  );
}

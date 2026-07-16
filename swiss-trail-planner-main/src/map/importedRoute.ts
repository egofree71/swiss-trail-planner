/**
 * Business context: renders one externally loaded GPX itinerary as the current read-only
 * itinerary. The purple layer remains non-editable, but only one itinerary is
 * kept at a time so an editable route and imported GPX never compete for UI state.
 */
import type { Coordinate } from 'ol/coordinate.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Stroke, Style } from 'ol/style.js';
import { createDirectionalLineStyle } from './itineraryDirection';
import { createItineraryEndpointFeatures } from './itineraryEndpoints';

/** OpenLayers resources owned by the root application for the loaded GPX. */
export interface ImportedRouteDisplay {
  /** Read-only vector layer used while the imported GPX is current. */
  layer: VectorLayer<VectorSource>;
  /** Mutable source replaced whenever another GPX is loaded. */
  source: VectorSource;
}

/** Purple distinguishes imported references from red editable routes and blue hydrography. */
const IMPORTED_ROUTE_COLOR = '#7a3db8';

/** White casing keeps the reference route visible over aerial and raster backgrounds. */
const IMPORTED_ROUTE_STYLE = [
  new Style({
    stroke: new Stroke({
      color: 'rgba(255, 255, 255, 0.92)',
      width: 9,
    }),
    zIndex: 0,
  }),
  new Style({
    stroke: new Stroke({
      color: IMPORTED_ROUTE_COLOR,
      width: 5,
    }),
    zIndex: 1,
  }),
];

/** Creates the persistent layer used for one imported read-only itinerary. */
export function createImportedRouteDisplay(): ImportedRouteDisplay {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    zIndex: 17,
  });

  return { layer, source };
}

/**
 * Replaces or clears the displayed imported itinerary.
 * @param display - OpenLayers resources to update in place.
 * @param segments - Independent EPSG:2056 line segments.
 */
export function updateImportedRouteDisplay(
  display: ImportedRouteDisplay,
  segments: Coordinate[][],
): void {
  const validSegments = segments.filter((segment) => segment.length >= 2);
  const firstSegment = validSegments[0];
  const lastSegment = validSegments[validSegments.length - 1];
  const startCoordinate = firstSegment?.[0] ?? null;
  const finishCoordinate = lastSegment?.[lastSegment.length - 1] ?? null;
  const avoidCoordinates = [startCoordinate, finishCoordinate].filter(
    (coordinate): coordinate is Coordinate => coordinate !== null,
  );
  const features: Feature[] = validSegments.map((segment) => {
    const feature = new Feature({
      geometry: new LineString(segment),
    });
    feature.setStyle(
      createDirectionalLineStyle({
        lineStyles: IMPORTED_ROUTE_STYLE,
        coordinates: segment,
        color: IMPORTED_ROUTE_COLOR,
        avoidCoordinates,
      }),
    );
    return feature;
  });

  features.push(
    ...createItineraryEndpointFeatures(
      startCoordinate,
      finishCoordinate,
    ),
  );

  display.source.clear();
  display.source.addFeatures(features);
}

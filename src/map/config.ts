import { fromLonLat, transformExtent } from 'ol/proj.js';
import XYZ from 'ol/source/XYZ.js';

const SWISSTOPO_BASE_MAP_LAYER_ID = 'ch.swisstopo.pixelkarte-farbe';
const SWISSTOPO_HIKING_TRAILS_LAYER_ID =
  'ch.swisstopo.swisstlm3d-wanderwege';

const SWISSTOPO_ATTRIBUTION =
  '<a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener noreferrer">© swisstopo</a>';

/*
 * This extent is not the exact administrative boundary. It keeps a small
 * margin around Switzerland so nearby cross-border access remains visible,
 * while preventing navigation to areas that are irrelevant to the project.
 *
 * Coordinate order: west, south, east, north (WGS 84 / EPSG:4326).
 */
const MAP_BOUNDS_WGS84 = [5.7, 45.65, 10.75, 47.95];

export const DEFAULT_MAP_CENTER = fromLonLat([8.2275, 46.8182]);

export const MAP_EXTENT = transformExtent(
  MAP_BOUNDS_WGS84,
  'EPSG:4326',
  'EPSG:3857',
);

export const MAP_ZOOM = {
  initial: 8,
  minimum: 5,
  maximum: 20,
} as const;

/*
 * OpenLayers treats a layer's minZoom as an exclusive boundary. Setting the
 * value to 12 therefore makes the hiking overlay appear once the view zooms
 * beyond level 12, normally at level 13 with the standard zoom controls.
 */
export const HIKING_TRAILS_MIN_ZOOM = 12;

/*
 * Locating the user should reveal nearby streets and trails without zooming
 * all the way to the most detailed tile level.
 */
export const USER_LOCATION_ZOOM = 15;

type SwissTopoTileFormat = 'jpeg' | 'png';

function createSwissTopoXyzSource(
  layerId: string,
  format: SwissTopoTileFormat,
): XYZ {
  return new XYZ({
    url: `https://wmts.geo.admin.ch/1.0.0/${layerId}/default/current/3857/{z}/{x}/{y}.${format}`,
    attributions: SWISSTOPO_ATTRIBUTION,
    crossOrigin: 'anonymous',
    projection: 'EPSG:3857',
    maxZoom: MAP_ZOOM.maximum,
    wrapX: false,
  });
}

/**
 * Creates the official national-map raster source used as the background.
 */
export function createSwissTopoRasterSource(): XYZ {
  return createSwissTopoXyzSource(SWISSTOPO_BASE_MAP_LAYER_ID, 'jpeg');
}

/**
 * Creates the official hiking-trail overlay as transparent PNG tiles.
 *
 * This layer is a rendered WMTS representation of swissTLM3D. It is useful
 * for visualization, but it does not expose vector geometries for routing.
 */
export function createHikingTrailsSource(): XYZ {
  return createSwissTopoXyzSource(
    SWISSTOPO_HIKING_TRAILS_LAYER_ID,
    'png',
  );
}

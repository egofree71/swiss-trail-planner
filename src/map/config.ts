import { fromLonLat, transformExtent } from 'ol/proj.js';
import XYZ from 'ol/source/XYZ.js';

/** Backgrounds available through the official swisstopo WMTS service. */
export type BaseMapStyle = 'color' | 'gray' | 'aerial';

/** Default background used when the application starts. */
export const DEFAULT_BASE_MAP_STYLE: BaseMapStyle = 'color';

/** Provider layer identifiers for each selectable background. */
const SWISSTOPO_BASE_MAP_LAYER_IDS: Record<BaseMapStyle, string> = {
  color: 'ch.swisstopo.pixelkarte-farbe',
  gray: 'ch.swisstopo.pixelkarte-grau',
  aerial: 'ch.swisstopo.swissimage',
};

const SWISSTOPO_GRAY_DETAIL_LAYER_ID =
  'ch.swisstopo.landeskarte-grau-10';

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

/*
 * The fractional initial zoom keeps the whole country visible on typical
 * desktop viewports, including high-density displays with fewer CSS pixels.
 */
export const MAP_ZOOM = {
  initial: 6,
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
 * The 1:10,000 grey map is intended for the four most detailed map levels.
 * OpenLayers treats minZoom as exclusive, so 16 enables it at integer zoom
 * levels 17 through 20 while the mixed-scale grey map remains underneath.
 */
export const GRAY_DETAIL_MIN_ZOOM = 16;

/*
 * Locating the user should reveal nearby streets and trails without zooming
 * all the way to the most detailed tile level.
 */
export const USER_LOCATION_ZOOM = 15;

/*
 * Selecting a locality should reveal useful street detail and make the hiking
 * overlay visible without zooming as closely as browser geolocation.
 */
export const LOCATION_SEARCH_ZOOM = 13;

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
 * Creates one official swisstopo background as JPEG WMTS tiles.
 *
 * The color and grey options use the national map. The aerial option uses the
 * current SWISSIMAGE orthophoto mosaic. All overlays remain independent of the
 * chosen background.
 *
 * @param style - Background selected by the user.
 * @returns A new XYZ source suitable for the single OpenLayers base layer.
 */
export function createBaseMapSource(style: BaseMapStyle): XYZ {
  return createSwissTopoXyzSource(
    SWISSTOPO_BASE_MAP_LAYER_IDS[style],
    'jpeg',
  );
}


/**
 * Creates the detailed 1:10,000 grey map used at close zoom levels.
 *
 * The mixed-scale `pixelkarte-grau` background becomes visibly enlarged at
 * close zooms. Swisstopo's own viewers supplement it with this PNG layer so
 * labels and linework retain their native cartographic resolution.
 */
export function createGrayDetailMapSource(): XYZ {
  return createSwissTopoXyzSource(
    SWISSTOPO_GRAY_DETAIL_LAYER_ID,
    'png',
  );
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

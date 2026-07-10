import { fromLonLat, transformExtent } from 'ol/proj.js';
import XYZ from 'ol/source/XYZ.js';

const SWISSTOPO_LAYER_ID = 'ch.swisstopo.pixelkarte-farbe';

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

/**
 * Creates the official raster source used as the map background.
 *
 * The XYZ URL is built directly on purpose. This avoids making application
 * startup depend on parsing a WMTS capabilities document.
 */
export function createSwissTopoRasterSource(): XYZ {
  return new XYZ({
    url: `https://wmts.geo.admin.ch/1.0.0/${SWISSTOPO_LAYER_ID}/default/current/3857/{z}/{x}/{y}.jpeg`,
    attributions: SWISSTOPO_ATTRIBUTION,
    crossOrigin: 'anonymous',
    projection: 'EPSG:3857',
    maxZoom: MAP_ZOOM.maximum,
    wrapX: false,
  });
}

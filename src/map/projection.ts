/**
 * Business context: centralizes the application's native Swiss map projection.
 * Via Helvetica keeps all displayed and editable geometry in LV95 so
 * swisstopo tiles, swissTLM3D routing data, and metric geometry share one CRS.
 * WGS 84 remains confined to browser geolocation, search results, and GPX I/O.
 */
import type { Coordinate } from 'ol/coordinate.js';
import type Projection from 'ol/proj/Projection.js';
import {
  get as getProjection,
  getTransform,
  transform,
  type TransformFunction,
} from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import proj4 from 'proj4';

/** Native projected coordinate reference system used by the complete map. */
export const MAP_PROJECTION_CODE = 'EPSG:2056';
/** External longitude/latitude reference system used by GPX and browser APIs. */
export const WGS84_PROJECTION_CODE = 'EPSG:4326';

/** Official swisstopo LV95 WMTS coverage in metres. */
export const LV95_WMTS_EXTENT = [2_420_000, 1_030_000, 2_900_000, 1_350_000];
/** Geographic area corresponding to the project's Swiss map context. */
const LV95_WORLD_EXTENT = [5.7, 45.65, 10.75, 47.95];

/**
 * Official swisstopo LV95 WMTS resolutions for tile matrices 0 through 28.
 * Matrix 24 belongs to the pyramid but is not currently exposed by the API.
 */
export const LV95_VIEW_RESOLUTIONS = [
  4_000,
  3_750,
  3_500,
  3_250,
  3_000,
  2_750,
  2_500,
  2_250,
  2_000,
  1_750,
  1_500,
  1_250,
  1_000,
  750,
  650,
  500,
  250,
  100,
  50,
  20,
  10,
  5,
  2.5,
  2,
  1.5,
  1,
  0.5,
  0.25,
  0.1,
] as const;

/** Matrix indices available to ordinary national-map and overlay layers. */
export const LV95_STANDARD_SOURCE_MATRIX_INDICES = [
  ...Array.from({ length: 24 }, (_, index) => index),
  25,
  26,
] as const;

/** Matrix indices available to layers such as SWISSIMAGE at the finest levels. */
export const LV95_FINE_SOURCE_MATRIX_INDICES = [
  ...LV95_STANDARD_SOURCE_MATRIX_INDICES,
  27,
  28,
] as const;

/** Official matrix widths and heights for the complete LV95 pyramid. */
export const LV95_MATRIX_SIZES: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1],
  [2, 1],
  [2, 1],
  [2, 1],
  [2, 2],
  [3, 2],
  [3, 2],
  [4, 3],
  [8, 5],
  [19, 13],
  [38, 25],
  [94, 63],
  [188, 125],
  [375, 250],
  [750, 500],
  [938, 625],
  [1_250, 834],
  [1_875, 1_250],
  [3_750, 2_500],
  [7_500, 5_000],
  [18_750, 12_500],
];

const EPSG_2056_DEFINITION =
  '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 ' +
  '+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel ' +
  '+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs';

/** Registers LV95 and returns the OpenLayers projection used by the map view. */
function registerMapProjection(): Projection {
  proj4.defs(MAP_PROJECTION_CODE, EPSG_2056_DEFINITION);
  register(proj4);

  const projection = getProjection(MAP_PROJECTION_CODE);

  if (!projection) {
    throw new Error('EPSG:2056 registration did not expose an OpenLayers projection.');
  }

  projection.setExtent(LV95_WMTS_EXTENT);
  projection.setWorldExtent(LV95_WORLD_EXTENT);
  return projection;
}

/** Registered singleton imported by map sources and the root view. */
export const MAP_PROJECTION = registerMapProjection();

/** Cached transforms avoid repeated projection-registry lookups for GPX arrays. */
const WGS84_TO_MAP_TRANSFORM = getTransform(
  WGS84_PROJECTION_CODE,
  MAP_PROJECTION_CODE,
);
const MAP_TO_WGS84_TRANSFORM = getTransform(
  MAP_PROJECTION_CODE,
  WGS84_PROJECTION_CODE,
);

/**
 * Transforms an ordered coordinate collection through one flat-array operation.
 * OpenLayers accepts a stride of two, which avoids one projection-dispatch call
 * per GPX point while preserving a fresh nested coordinate array for callers.
 *
 * @param coordinates - Ordered source coordinates.
 * @param transformCoordinates - Cached OpenLayers flat-coordinate transform.
 * @returns Newly allocated coordinates in the destination projection.
 */
function transformCoordinateArray(
  coordinates: Coordinate[],
  transformCoordinates: TransformFunction,
): Coordinate[] {
  if (coordinates.length === 0) {
    return [];
  }

  const flatCoordinates = new Array<number>(coordinates.length * 2);

  for (let index = 0; index < coordinates.length; index += 1) {
    flatCoordinates[index * 2] = coordinates[index][0];
    flatCoordinates[index * 2 + 1] = coordinates[index][1];
  }

  const transformed = transformCoordinates(flatCoordinates, undefined, 2, 2);
  const result = new Array<Coordinate>(coordinates.length);

  for (let index = 0; index < coordinates.length; index += 1) {
    result[index] = [transformed[index * 2], transformed[index * 2 + 1]];
  }

  return result;
}

/** Converts WGS 84 longitude/latitude to the application's LV95 map geometry. */
export function fromWgs84(coordinate: Coordinate): Coordinate {
  return transform(coordinate, WGS84_PROJECTION_CODE, MAP_PROJECTION_CODE);
}

/**
 * Converts an ordered GPX coordinate array to native LV95 in one batch.
 * @param coordinates - WGS 84 longitude/latitude points.
 * @returns Newly allocated EPSG:2056 coordinates in the same order.
 */
export function fromWgs84Coordinates(
  coordinates: Coordinate[],
): Coordinate[] {
  return transformCoordinateArray(coordinates, WGS84_TO_MAP_TRANSFORM);
}

/** Converts one LV95 map coordinate to WGS 84 longitude/latitude. */
export function toWgs84(coordinate: Coordinate): Coordinate {
  return transform(coordinate, MAP_PROJECTION_CODE, WGS84_PROJECTION_CODE);
}

/**
 * Converts an ordered native LV95 coordinate array to WGS 84 in one batch.
 * @param coordinates - EPSG:2056 map coordinates.
 * @returns Newly allocated longitude/latitude coordinates in the same order.
 */
export function toWgs84Coordinates(
  coordinates: Coordinate[],
): Coordinate[] {
  return transformCoordinateArray(coordinates, MAP_TO_WGS84_TRANSFORM);
}

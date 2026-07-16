/**
 * Business context: integrates the official ASTRA hiking-trail closure and
 * detour dataset without copying operational safety data into this project.
 * The WMS source preserves the official cartography, while the GeoAdmin
 * identify and HTML-popup services provide localized details for map clicks.
 */
import type { Coordinate } from 'ol/coordinate.js';
import type { Extent } from 'ol/extent.js';
import TileWMS from 'ol/source/TileWMS.js';
import type { Language } from '../i18n/translations';
import { sanitizeGeoAdminPopupHtml } from '../map/geoAdminPopup';
import { MAP_PROJECTION_CODE } from '../map/projection';

/** Technical GeoAdmin identifier for hiking closures and detours. */
export const TRAIL_CLOSURES_LAYER_ID =
  'ch.astra.wanderland-sperrungen_umleitungen';

/** GeoAdmin identify endpoint used to find a closure near a map click. */
const IDENTIFY_ENDPOINT =
  'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify';

/** GeoAdmin map service that renders the official closure symbology. */
const WMS_ENDPOINT = 'https://wms.geo.admin.ch/';

/** Pixel radius around a click used to make narrow closure lines selectable. */
const IDENTIFY_TOLERANCE_PIXELS = 8;

/** Browser display resolution sent to GeoAdmin for scale-aware identification. */
const IDENTIFY_DPI = 96;

/** Attribution displayed with the official operational dataset. */
const TRAIL_CLOSURES_ATTRIBUTION =
  '© ASTRA, Kantone, Schweizer Wanderwege, SchweizMobil';

/** Minimal identify result needed to request the official HTML popup. */
interface IdentifyFeature {
  /** Stable feature identifier understood by the HTML-popup endpoint. */
  featureId: string | number;
  /** Technical layer identifier returned by GeoAdmin. */
  layerBodId: string;
}

/** JSON envelope returned by the GeoAdmin identify service. */
interface IdentifyResponse {
  /** Features intersecting the click tolerance. */
  results?: unknown[];
}

/** Map context required for a scale-aware identify request. */
export interface TrailClosureIdentifyContext {
  /** Click coordinate in the OpenLayers display projection (EPSG:2056). */
  coordinate: Coordinate;
  /** Current visible map extent in EPSG:2056. */
  mapExtent: Extent;
  /** Current map canvas width and height in CSS pixels. */
  imageSize: [number, number];
  /** Language requested for layer metadata and popup content. */
  language: Language;
}

/** Identified closure and the map context reused by the popup request. */
export interface IdentifiedTrailClosure {
  /** Feature identifier in the ASTRA closure layer. */
  featureId: string | number;
  /** Click context required by scale-dependent popup templates. */
  context: TrailClosureIdentifyContext;
}

/** Tests the small subset of identify fields required by this module. */
function isIdentifyFeature(value: unknown): value is IdentifyFeature {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const feature = value as Partial<IdentifyFeature>;
  return (
    (typeof feature.featureId === 'string' ||
      typeof feature.featureId === 'number') &&
    feature.layerBodId === TRAIL_CLOSURES_LAYER_ID
  );
}

/**
 * Creates the official transparent WMS overlay with its server-side styling.
 * @returns TileWMS source for an OpenLayers layer placed above hiking trails.
 */
export function createTrailClosuresSource(): TileWMS {
  return new TileWMS({
    url: WMS_ENDPOINT,
    params: {
      LAYERS: TRAIL_CLOSURES_LAYER_ID,
      FORMAT: 'image/png',
      TRANSPARENT: true,
      TILED: true,
    },
    attributions: TRAIL_CLOSURES_ATTRIBUTION,
    crossOrigin: 'anonymous',
    projection: MAP_PROJECTION_CODE,
    wrapX: false,
  });
}

/**
 * Finds the first closure or detour within a small screen-pixel tolerance.
 *
 * @param context - Current click, map extent, canvas size, and language.
 * @param signal - Abort signal for superseded clicks or layer deactivation.
 * @returns Identified feature, or `null` when the click hits no closure.
 * @throws {Error} When GeoAdmin returns an unsuccessful or malformed response.
 */
export async function identifyTrailClosure(
  context: TrailClosureIdentifyContext,
  signal: AbortSignal,
): Promise<IdentifiedTrailClosure | null> {
  const parameters = new URLSearchParams({
    geometry: `${context.coordinate[0]},${context.coordinate[1]}`,
    geometryType: 'esriGeometryPoint',
    geometryFormat: 'geojson',
    layers: `all:${TRAIL_CLOSURES_LAYER_ID}`,
    tolerance: String(IDENTIFY_TOLERANCE_PIXELS),
    mapExtent: context.mapExtent.join(','),
    imageDisplay: `${Math.round(context.imageSize[0])},${Math.round(context.imageSize[1])},${IDENTIFY_DPI}`,
    returnGeometry: 'false',
    sr: '2056',
    lang: context.language,
    limit: '5',
  });
  const response = await fetch(`${IDENTIFY_ENDPOINT}?${parameters}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`Trail closure identify failed with ${response.status}.`);
  }

  const payload = (await response.json()) as IdentifyResponse;
  const feature = payload.results?.find(isIdentifyFeature);

  if (!feature) {
    return null;
  }

  return {
    featureId: feature.featureId,
    context,
  };
}

/**
 * Loads and sanitizes the localized official metadata panel for one feature.
 *
 * @param closure - Feature and map context returned by `identifyTrailClosure`.
 * @param signal - Abort signal for superseded clicks or panel closure.
 * @returns Safe HTML preserving the official labels and values.
 * @throws {Error} When the popup endpoint fails or returns no usable content.
 */
export async function fetchTrailClosurePopup(
  closure: IdentifiedTrailClosure,
  signal: AbortSignal,
): Promise<string> {
  const { context } = closure;
  const parameters = new URLSearchParams({
    lang: context.language,
    sr: '2056',
    mapExtent: context.mapExtent.join(','),
    imageDisplay: `${Math.round(context.imageSize[0])},${Math.round(context.imageSize[1])},${IDENTIFY_DPI}`,
    coord: `${context.coordinate[0]},${context.coordinate[1]}`,
  });
  const featureId = encodeURIComponent(String(closure.featureId));
  const endpoint = `https://api3.geo.admin.ch/rest/services/ech/MapServer/${TRAIL_CLOSURES_LAYER_ID}/${featureId}/htmlPopup?${parameters}`;
  const response = await fetch(endpoint, { signal });

  if (!response.ok) {
    throw new Error(`Trail closure popup failed with ${response.status}.`);
  }

  const sanitizedHtml = sanitizeGeoAdminPopupHtml(await response.text());

  if (!sanitizedHtml) {
    throw new Error('Trail closure popup returned no usable content.');
  }

  return sanitizedHtml;
}

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
  /** Click coordinate in the OpenLayers display projection (EPSG:3857). */
  coordinate: Coordinate;
  /** Current visible map extent in EPSG:3857. */
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
 * Converts one URL from official popup markup into a safe absolute HTTP URL.
 * @param value - Raw attribute value returned by GeoAdmin.
 * @returns Safe absolute URL, or `null` when the protocol is not allowed.
 */
function normalizeSafeUrl(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const url = new URL(value, 'https://api3.geo.admin.ch/');
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Removes executable markup while retaining headings, tables, links, and text
 * from the trusted GeoAdmin HTML-popup response.
 *
 * @param html - Raw HTML returned by the official popup endpoint.
 * @returns Sanitized HTML suitable for the dedicated React information panel.
 */
function sanitizePopupHtml(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set([
    'A',
    'B',
    'BR',
    'DIV',
    'EM',
    'H1',
    'H2',
    'H3',
    'H4',
    'I',
    'IMG',
    'LI',
    'OL',
    'P',
    'SPAN',
    'STRONG',
    'TABLE',
    'TBODY',
    'TD',
    'TH',
    'THEAD',
    'TR',
    'UL',
  ]);
  const allowedClasses = new Set([
    'htmlpopup-container',
    'htmlpopup-header',
    'htmlpopup-content',
    'cell-left',
  ]);

  // Process deepest nodes first so unwrapping an unknown container preserves
  // already-sanitized descendants and readable official table structure.
  const elements = Array.from(documentNode.body.querySelectorAll('*')).reverse();

  for (const element of elements) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const originalClassName = element.getAttribute('class') ?? '';
    const originalHref = element.getAttribute('href') ?? '';
    const originalSrc = element.getAttribute('src') ?? '';
    const originalAlt = element.getAttribute('alt') ?? '';

    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }

    if (originalClassName) {
      const safeClasses = originalClassName
        .split(/\s+/)
        .filter((className) => allowedClasses.has(className));

      if (safeClasses.length > 0) {
        element.setAttribute('class', safeClasses.join(' '));
      }
    }

    if (element instanceof HTMLAnchorElement) {
      const href = normalizeSafeUrl(originalHref);

      if (href) {
        element.href = href;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
      }
    }

    if (element instanceof HTMLImageElement) {
      const src = normalizeSafeUrl(originalSrc);

      if (src) {
        element.src = src;
        element.alt = originalAlt;
      } else {
        element.remove();
      }
    }
  }

  return documentNode.body.innerHTML.trim();
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
    projection: 'EPSG:3857',
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
    sr: '3857',
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
    sr: '3857',
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

  const sanitizedHtml = sanitizePopupHtml(await response.text());

  if (!sanitizedHtml) {
    throw new Error('Trail closure popup returned no usable content.');
  }

  return sanitizedHtml;
}

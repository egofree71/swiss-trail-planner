/**
 * Business context: loads passenger-relevant public-transport stops from the
 * official GeoAdmin feature service and renders them as client-side vectors.
 * The vector representation is necessary because the official raster layer
 * also portrays operational or out-of-service points that are not useful when
 * planning access to a hike and cannot be filtered after tile rendering.
 */
import type { Coordinate } from 'ol/coordinate.js';
import type { Extent } from 'ol/extent.js';
import Feature, { type FeatureLike } from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { toLonLat } from 'ol/proj.js';
import { getDistance } from 'ol/sphere.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Icon from 'ol/style/Icon.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import boatIconUrl from '../assets/public-transport-stops/boat.png';
import busIconUrl from '../assets/public-transport-stops/bus.png';
import cableCarIconUrl from '../assets/public-transport-stops/cable-car.png';
import chairliftIconUrl from '../assets/public-transport-stops/chairlift.png';
import funicularIconUrl from '../assets/public-transport-stops/funicular.png';
import trainIconUrl from '../assets/public-transport-stops/train.png';
import tramIconUrl from '../assets/public-transport-stops/tram.png';
import type { Language } from '../i18n/translations';

/** Technical GeoAdmin identifier for official public-transport stops. */
export const PUBLIC_TRANSPORT_STOPS_LAYER_ID = 'ch.bav.haltestellen-oev';

/**
 * Stops are useful only at detailed scales. OpenLayers treats this boundary as
 * exclusive, so a value of 12 displays the layer from integer zoom 13.
 */
export const PUBLIC_TRANSPORT_STOPS_MIN_ZOOM = 12;

/** GeoAdmin identify endpoint used for viewport feature loading. */
const IDENTIFY_ENDPOINT =
  'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify';

/** Maximum number of features returned by one GeoAdmin identify request. */
const IDENTIFY_RESULT_LIMIT = 200;

/**
 * Maximum recursive viewport subdivision depth. Dense city centres can exceed
 * the API limit, while a bounded depth prevents an accidental request storm.
 */
const MAX_SUBDIVISION_DEPTH = 5;

/** Browser display resolution sent to GeoAdmin for scale-aware identification. */
const IDENTIFY_DPI = 96;

/** Web Mercator ground resolution at zoom level zero, in map units per pixel. */
const WEB_MERCATOR_INITIAL_RESOLUTION = 156543.03392804097;

/**
 * GeoAdmin exposes operational sub-points such as platform numbers at the
 * closest scales. Stop loading is therefore evaluated at no more than zoom 17,
 * even when the user zooms further in, so the passenger-stop representation
 * remains stable instead of changing to technical objects.
 */
const PUBLIC_TRANSPORT_IDENTIFY_MAX_ZOOM = 17;

/** Minimum map resolution used only for GeoAdmin stop identification. */
const PUBLIC_TRANSPORT_IDENTIFY_MIN_RESOLUTION =
  WEB_MERCATOR_INITIAL_RESOLUTION /
  2 ** PUBLIC_TRANSPORT_IDENTIFY_MAX_ZOOM;

/** Attribution attached to the vector source built from the official layer. */
const PUBLIC_TRANSPORT_STOPS_ATTRIBUTION =
  '<a href="https://www.bav.admin.ch/" target="_blank" rel="noopener noreferrer">© BAV</a>';

/** Internal feature property containing the structured stop metadata. */
const STOP_PROPERTY_NAME = 'publicTransportStop';

/** Internal feature property describing how a close stop is visually separated. */
const STOP_OVERLAP_LAYOUT_PROPERTY_NAME = 'publicTransportStopOverlapLayout';

/**
 * Passenger transport categories accepted by the map overlay.
 *
 * The official layer also contains pure operating points with no passenger
 * service. Keeping this list explicit prevents an unknown or empty transport
 * value from silently becoming a generic stop symbol.
 */
export const ACCEPTED_PUBLIC_TRANSPORT_MODES = [
  'train',
  'metro',
  'tram',
  'bus',
  'boat',
  'cableCar',
  'chairlift',
  'funicular',
] as const;

/** Passenger transport category represented in the stop overlay and popup. */
export type PublicTransportMode =
  (typeof ACCEPTED_PUBLIC_TRANSPORT_MODES)[number];

/** Primary-mode ordering keeps the most structurally useful symbol visible. */
const MODE_PRIORITY: PublicTransportMode[] = [
  'train',
  'metro',
  'tram',
  'boat',
  'cableCar',
  'chairlift',
  'funicular',
  'bus',
];

/**
 * Distinct stops closer than this ground distance can render on top of each
 * other at medium zoom levels. They remain separate data objects and are only
 * fanned apart visually until the map scale reveals their real positions.
 */
const STOP_OVERLAP_DISTANCE_METERS = 60;

/** Radius in screen pixels used when close stop symbols must be fanned apart. */
const STOP_OVERLAP_DISPLAY_RADIUS_PIXELS = 17;

/**
 * Once the real group radius reaches this many pixels, symbol displacement is
 * no longer needed and every stop returns to its true map position.
 */
const STOP_OVERLAP_RELEASE_RADIUS_PIXELS = 14;

/** Passenger stop displayed on the map and in the compact information popup. */
export interface PublicTransportStop {
  /** Stable official feature identifier used by OpenLayers and React. */
  id: string;
  /** Official BAV identifier used by the timetable API. */
  stationId: string;
  /** Official stop name in the selected GeoAdmin language when available. */
  name: string;
  /** Normalized transport categories used for symbols and translated titles. */
  modes: PublicTransportMode[];
  /** Point coordinate in the OpenLayers display projection (EPSG:3857). */
  coordinate: Coordinate;
}

/** OpenLayers resources owned by the root application for the stop overlay. */
export interface PublicTransportStopsDisplay {
  /** Vector layer placed above hiking and closure information. */
  layer: VectorLayer<VectorSource<Feature<Point>>>;
  /** Mutable source replaced after each completed viewport request. */
  source: VectorSource<Feature<Point>>;
  /** Halo layer that keeps the selected stop identifiable under the popup. */
  selectionLayer: VectorLayer<VectorSource<Feature<Point>>>;
  /** Source containing at most one selected-stop marker. */
  selectionSource: VectorSource<Feature<Point>>;
}

/** Visual layout for one stop that belongs to a close-symbol group. */
interface StopOverlapLayout {
  /** Shared group centre in EPSG:3857 map coordinates. */
  center: Coordinate;
  /** Furthest real stop distance from the group centre in map units. */
  radiusMapUnits: number;
  /** Desired symbol position relative to the centre, measured in pixels. */
  targetOffsetPixels: Coordinate;
}

/** GeoJSON point returned by the identify service. */
interface GeoJsonPoint {
  type: 'Point';
  coordinates: unknown[];
}

/** Minimal identify feature shape; layer attributes vary by publication. */
interface IdentifyFeature {
  featureId?: string | number;
  id?: string | number;
  layerBodId?: string;
  geometry?: GeoJsonPoint;
  bbox?: unknown[];
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

/** JSON envelope returned by the GeoAdmin identify service. */
interface IdentifyResponse {
  results?: unknown[];
}

/** Viewport context required to load and filter visible passenger stops. */
export interface PublicTransportStopsLoadContext {
  /** Current map extent in EPSG:3857. */
  extent: Extent;
  /** Current map canvas size in CSS pixels. */
  imageSize: [number, number];
  /** Language requested for official names and attribute values. */
  language: Language;
}

/** Normalizes field names and values for multilingual, punctuation-free matching. */
function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalizes a technical property key without spaces for candidate matching. */
function normalizeKey(value: string): string {
  return normalizeText(value).replaceAll(' ', '');
}

/** Returns the first non-empty string value matching one technical field key. */
function findStringProperty(
  properties: Record<string, unknown>,
  candidates: string[],
): string | null {
  const normalizedCandidates = candidates.map(normalizeKey);

  for (const [key, value] of Object.entries(properties)) {
    const normalizedPropertyKey = normalizeKey(key);
    const matchesCandidate = normalizedCandidates.some(
      (candidate) =>
        normalizedPropertyKey === candidate ||
        normalizedPropertyKey.startsWith(candidate) ||
        normalizedPropertyKey.endsWith(candidate),
    );

    if (matchesCandidate && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

/** Extracts a point coordinate from GeoJSON geometry or a point-like bbox. */
function extractCoordinate(feature: IdentifyFeature): Coordinate | null {
  const coordinates = feature.geometry?.coordinates;

  if (
    feature.geometry?.type === 'Point' &&
    Array.isArray(coordinates) &&
    typeof coordinates[0] === 'number' &&
    typeof coordinates[1] === 'number'
  ) {
    return [coordinates[0], coordinates[1]];
  }

  const bbox = feature.bbox;

  if (
    Array.isArray(bbox) &&
    bbox.length >= 4 &&
    bbox.every((value) => typeof value === 'number')
  ) {
    return [
      (Number(bbox[0]) + Number(bbox[2])) / 2,
      (Number(bbox[1]) + Number(bbox[3])) / 2,
    ];
  }

  return null;
}

/**
 * Maps the official multilingual transport description to stable UI modes.
 * Cable systems are checked before generic railway words because names such as
 * `Seilbahn` also contain the German word `Bahn`.
 */
function detectTransportModes(value: string): PublicTransportMode[] {
  const normalized = normalizeText(value);
  const modes = new Set<PublicTransportMode>();
  const isFunicular =
    /standseilbahn|funiculaire|funicolare|funicular/.test(normalized);
  const isChairlift =
    /sesselbahn|sessellift|telesiege|seggiovia|chairlift|chair lift/.test(
      normalized,
    );

  if (isFunicular) {
    modes.add('funicular');
  }

  if (isChairlift) {
    modes.add('chairlift');
  }

  // `Standseilbahn` and `Sesselbahn` both contain the generic word `Seilbahn`.
  // Keeping cable-system categories mutually exclusive prevents funiculars and
  // chairlifts from inheriting the gondola icon through that shared substring.
  if (
    !isFunicular &&
    !isChairlift &&
    /kabinenbahn|gondelbahn|pendelbahn|seilbahn|luftseilbahn|gondel|telepherique|telecabine|funivia|cabinovia|cable car/.test(
      normalized,
    )
  ) {
    modes.add('cableCar');
  }

  if (/schiff|bateau|navire|battello|nave|boat|ship|ferry/.test(normalized)) {
    modes.add('boat');
  }

  if (
    /metro|metropolitain|metropolitana|u bahn|underground|subway/.test(
      normalized,
    )
  ) {
    modes.add('metro');
  }

  if (/tram|strassenbahn|streetcar/.test(normalized)) {
    modes.add('tram');
  }

  if (/bus|autobus|trolleybus|car postal|postauto/.test(normalized)) {
    modes.add('bus');
  }

  if (
    /zug|train|treno|rail|eisenbahn|chemin de fer|ferrovia|zahnrad|cremaillere/.test(
      normalized,
    )
  ) {
    modes.add('train');
  }

  return [...modes];
}

/**
 * Reads only a final parenthesized mode qualifier from an official stop name.
 *
 * A few useful cableway records omit the transport field but retain a suffix
 * such as `(téléphérique)`. Restricting the fallback to that explicit suffix
 * avoids classifying place names such as `Zug Süd` as railway passenger stops.
 */
function detectTransportModesFromNameQualifier(
  name: string,
): PublicTransportMode[] {
  const qualifier = name.match(/\(([^()]*)\)\s*$/)?.[1];
  return qualifier ? detectTransportModes(qualifier) : [];
}

/** Tests localized type values that explicitly describe an unavailable stop. */
function isOutOfServiceType(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return /hors service|ausser betrieb|außer betrieb|out of service|fuori servizio|disused/.test(
    normalizeText(value),
  );
}

/** Converts one loosely typed identify result into a passenger stop or `null`. */
function parsePublicTransportStop(value: unknown): PublicTransportStop | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const feature = value as IdentifyFeature;

  if (feature.layerBodId !== PUBLIC_TRANSPORT_STOPS_LAYER_ID) {
    return null;
  }

  const coordinate = extractCoordinate(feature);
  const featureId = feature.featureId ?? feature.id;

  if (!coordinate || (typeof featureId !== 'string' && typeof featureId !== 'number')) {
    return null;
  }

  const properties = {
    ...(feature.attributes ?? {}),
    ...(feature.properties ?? {}),
  };
  const name = findStringProperty(properties, [
    'name',
    'nom',
    'nome',
    'bezeichnung',
    'designation',
    'stopName',
    'haltestellenname',
    'label',
  ]);
  const meansOfTransport = findStringProperty(properties, [
    'verkehrsmittel',
    'meansOfTransport',
    'moyenDeTransport',
    'moyenTransport',
    'mezzoDiTrasporto',
    'transportmittel',
    'transportMode',
    'modeTransport',
  ]);
  const stopType = findStringProperty(properties, [
    'type',
    'typ',
    'art',
    'stopType',
    'haltestellentyp',
  ]);

  // Explicitly retired stops remain hidden even when their name contains a
  // transport word. Empty or unknown transport fields are handled below by a
  // narrowly scoped final-parenthesis fallback for useful cableway records.
  if (!name || isOutOfServiceType(stopType)) {
    return null;
  }

  // Very close zoom levels can expose technical operating points named only
  // `01`, `02`, and similar platform identifiers. Passenger stop names always
  // contain at least one letter, so rejecting numeric-only labels removes
  // those duplicates without hiding legitimate named stations.
  if (!/\p{L}/u.test(name)) {
    return null;
  }

  const usableMeansOfTransport =
    meansOfTransport && meansOfTransport.trim() !== '-'
      ? meansOfTransport
      : '';
  const metadataModes = detectTransportModes(usableMeansOfTransport);
  const modes =
    metadataModes.length > 0
      ? metadataModes
      : detectTransportModesFromNameQualifier(name);

  // The BAV layer intentionally includes pure operating points. A feature is
  // passenger-relevant only when its metadata, or the explicit name qualifier
  // fallback above, resolves to one of the accepted transport categories.
  if (modes.length === 0) {
    return null;
  }

  return {
    id: String(featureId),
    stationId: String(featureId),
    name,
    modes: normalizeModes(modes),
    coordinate,
  };
}

/** Returns the stable display priority of one normalized transport mode. */
function getModePriority(mode: PublicTransportMode): number {
  const priority = MODE_PRIORITY.indexOf(mode);
  return priority === -1 ? MODE_PRIORITY.length : priority;
}

/** Sorts and deduplicates accepted passenger transport modes. */
function normalizeModes(
  modes: Iterable<PublicTransportMode>,
): PublicTransportMode[] {
  const uniqueModes = new Set(modes);

  return [...uniqueModes].sort(
    (first, second) => getModePriority(first) - getModePriority(second),
  );
}

/** Returns geodesic ground distance between two EPSG:3857 coordinates. */
function stopDistanceMeters(
  first: Coordinate,
  second: Coordinate,
): number {
  return getDistance(toLonLat(first), toLonLat(second));
}

/** Returns planar map-unit distance between two EPSG:3857 coordinates. */
function mapCoordinateDistance(
  first: Coordinate,
  second: Coordinate,
): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

/**
 * Assigns a deterministic fan layout to distinct stops whose symbols would
 * otherwise overlap. This does not merge station identifiers or timetables:
 * nearby facilities such as `Plan-Francey` and `Plan-Francey (téléphérique)`
 * remain independently selectable.
 */
function createStopOverlapLayouts(
  stops: PublicTransportStop[],
): Map<string, StopOverlapLayout> {
  const layouts = new Map<string, StopOverlapLayout>();
  const remaining = new Set(stops.map((stop) => stop.id));
  const orderedStops = [...stops].sort((first, second) =>
    first.id.localeCompare(second.id),
  );

  for (const anchor of orderedStops) {
    if (!remaining.has(anchor.id)) {
      continue;
    }

    const closeStops = orderedStops.filter(
      (candidate) =>
        remaining.has(candidate.id) &&
        stopDistanceMeters(anchor.coordinate, candidate.coordinate) <=
          STOP_OVERLAP_DISTANCE_METERS,
    );

    for (const stop of closeStops) {
      remaining.delete(stop.id);
    }

    if (closeStops.length < 2) {
      continue;
    }

    const center: Coordinate = [
      closeStops.reduce((sum, stop) => sum + stop.coordinate[0], 0) /
        closeStops.length,
      closeStops.reduce((sum, stop) => sum + stop.coordinate[1], 0) /
        closeStops.length,
    ];
    const radiusMapUnits = Math.max(
      ...closeStops.map((stop) =>
        mapCoordinateDistance(stop.coordinate, center),
      ),
    );

    closeStops.forEach((stop, index) => {
      const angle = (2 * Math.PI * index) / closeStops.length;
      layouts.set(stop.id, {
        center,
        radiusMapUnits,
        targetOffsetPixels: [
          Math.cos(angle) * STOP_OVERLAP_DISPLAY_RADIUS_PIXELS,
          Math.sin(angle) * STOP_OVERLAP_DISPLAY_RADIUS_PIXELS,
        ],
      });
    });
  }

  return layouts;
}

/** Reads an internal close-symbol layout from one rendered feature. */
function getStopOverlapLayout(
  feature: FeatureLike,
): StopOverlapLayout | null {
  const value = feature.get(STOP_OVERLAP_LAYOUT_PROPERTY_NAME) as unknown;

  if (!value || typeof value !== 'object') {
    return null;
  }

  const layout = value as Partial<StopOverlapLayout>;
  return Array.isArray(layout.center) &&
    typeof layout.radiusMapUnits === 'number' &&
    Array.isArray(layout.targetOffsetPixels)
    ? (layout as StopOverlapLayout)
    : null;
}

/**
 * Converts a close-stop layout into an OpenLayers pixel displacement.
 * At detailed zoom levels the real coordinates become sufficiently separated,
 * so the displacement fades out completely rather than distorting the map.
 */
function calculateStopDisplacement(
  coordinate: Coordinate,
  layout: StopOverlapLayout | null,
  resolution: number,
): Coordinate {
  if (!layout || !Number.isFinite(resolution) || resolution <= 0) {
    return [0, 0];
  }

  if (
    layout.radiusMapUnits / resolution >=
    STOP_OVERLAP_RELEASE_RADIUS_PIXELS
  ) {
    return [0, 0];
  }

  const naturalOffsetPixels: Coordinate = [
    (coordinate[0] - layout.center[0]) / resolution,
    (coordinate[1] - layout.center[1]) / resolution,
  ];

  return [
    layout.targetOffsetPixels[0] - naturalOffsetPixels[0],
    layout.targetOffsetPixels[1] - naturalOffsetPixels[1],
  ];
}

/**
 * Returns the map extent used only to tell GeoAdmin which portrayal scale to
 * identify. The feature geometry still uses the real viewport extent; only the
 * scale context is widened when the user zooms beyond the passenger-stop level.
 */
function createIdentifyScaleExtent(
  extent: Extent,
  imageSize: [number, number],
): Extent {
  const currentResolution = Math.max(
    (extent[2] - extent[0]) / Math.max(imageSize[0], 1),
    (extent[3] - extent[1]) / Math.max(imageSize[1], 1),
  );

  if (currentResolution >= PUBLIC_TRANSPORT_IDENTIFY_MIN_RESOLUTION) {
    return extent;
  }

  const centerX = (extent[0] + extent[2]) / 2;
  const centerY = (extent[1] + extent[3]) / 2;
  const halfWidth =
    (imageSize[0] * PUBLIC_TRANSPORT_IDENTIFY_MIN_RESOLUTION) / 2;
  const halfHeight =
    (imageSize[1] * PUBLIC_TRANSPORT_IDENTIFY_MIN_RESOLUTION) / 2;

  return [
    centerX - halfWidth,
    centerY - halfHeight,
    centerX + halfWidth,
    centerY + halfHeight,
  ];
}

/** Splits an extent into four overlapping-free quadrants. */
function subdivideExtent(extent: Extent): Extent[] {
  const centerX = (extent[0] + extent[2]) / 2;
  const centerY = (extent[1] + extent[3]) / 2;

  return [
    [extent[0], extent[1], centerX, centerY],
    [centerX, extent[1], extent[2], centerY],
    [extent[0], centerY, centerX, extent[3]],
    [centerX, centerY, extent[2], extent[3]],
  ];
}

/** Requests one envelope and recursively subdivides cells that hit the API cap. */
async function fetchStopsForExtent(
  extent: Extent,
  context: PublicTransportStopsLoadContext,
  signal: AbortSignal,
  depth: number,
): Promise<unknown[]> {
  const parameters = new URLSearchParams({
    geometry: extent.join(','),
    geometryType: 'esriGeometryEnvelope',
    geometryFormat: 'geojson',
    layers: `all:${PUBLIC_TRANSPORT_STOPS_LAYER_ID}`,
    tolerance: '0',
    mapExtent: createIdentifyScaleExtent(
      context.extent,
      context.imageSize,
    ).join(','),
    imageDisplay: `${Math.round(context.imageSize[0])},${Math.round(context.imageSize[1])},${IDENTIFY_DPI}`,
    returnGeometry: 'true',
    sr: '3857',
    lang: context.language,
    limit: String(IDENTIFY_RESULT_LIMIT),
  });
  const response = await fetch(`${IDENTIFY_ENDPOINT}?${parameters}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Public-transport stop loading failed with ${response.status}.`,
    );
  }

  const payload = (await response.json()) as IdentifyResponse;
  const results = Array.isArray(payload.results) ? payload.results : [];

  if (
    results.length < IDENTIFY_RESULT_LIMIT ||
    depth >= MAX_SUBDIVISION_DEPTH
  ) {
    return results;
  }

  const subdivisions = subdivideExtent(extent);
  const nestedResults = await Promise.all(
    subdivisions.map((cell) =>
      fetchStopsForExtent(cell, context, signal, depth + 1),
    ),
  );

  return nestedResults.flat();
}

/**
 * Loads current passenger stops for the visible map extent.
 *
 * @param context - Current viewport, image size, and interface language.
 * @param signal - Abort signal for superseded pans, zooms, or layer hiding.
 * @returns Passenger stops deduplicated strictly by official feature identifier.
 * @throws {Error} When the official GeoAdmin service fails.
 */
export async function loadPublicTransportStops(
  context: PublicTransportStopsLoadContext,
  signal: AbortSignal,
): Promise<PublicTransportStop[]> {
  const rawResults = await fetchStopsForExtent(
    context.extent,
    context,
    signal,
    0,
  );
  const stops = new Map<string, PublicTransportStop>();

  for (const rawResult of rawResults) {
    const stop = parsePublicTransportStop(rawResult);

    if (stop) {
      stops.set(stop.id, stop);
    }
  }

  // Recursive viewport subdivision can return the same feature more than
  // once. The map above removes only those exact-ID duplicates; distinct
  // official stops are never merged from name similarity or proximity.
  return [...stops.values()];
}

/**
 * Official GeoAdmin legend symbols bundled locally for reliable client-side
 * filtering. The original WMTS layer used these clearer mode-specific icons,
 * but raster tiles could not hide out-of-service operating points.
 */
const MODE_ICON_URLS: Record<PublicTransportMode, string> = {
  train: trainIconUrl,
  // Metro keeps its own popup label but uses the clear railway map symbol.
  metro: trainIconUrl,
  tram: tramIconUrl,
  bus: busIconUrl,
  boat: boatIconUrl,
  cableCar: cableCarIconUrl,
  chairlift: chairliftIconUrl,
  funicular: funicularIconUrl,
};

/** Shared immutable OpenLayers styles for symbols at their real position. */
const MODE_STYLES = new Map<PublicTransportMode, Style>(
  MODE_PRIORITY.map((mode) => [
    mode,
    new Style({
      image: new Icon({
        src: MODE_ICON_URLS[mode],
        // All bundled legend crops share a 28 px transparent canvas.
        scale: 25 / 28,
      }),
    }),
  ]),
);

/** Cached displaced variants used only for the few close-symbol groups. */
const DISPLACED_MODE_STYLES = new Map<string, Style>();

/** Returns a mode style whose symbol follows one rounded pixel displacement. */
function getModeStyle(
  mode: PublicTransportMode,
  displacement: Coordinate,
): Style {
  const roundedDisplacement: Coordinate = [
    Math.round(displacement[0]),
    Math.round(displacement[1]),
  ];

  if (roundedDisplacement[0] === 0 && roundedDisplacement[1] === 0) {
    return MODE_STYLES.get(mode)!;
  }

  const key = `${mode}:${roundedDisplacement[0]}:${roundedDisplacement[1]}`;
  const cached = DISPLACED_MODE_STYLES.get(key);

  if (cached) {
    return cached;
  }

  const style = new Style({
    image: new Icon({
      src: MODE_ICON_URLS[mode],
      scale: 25 / 28,
      displacement: roundedDisplacement,
    }),
  });
  DISPLACED_MODE_STYLES.set(key, style);
  return style;
}

/** Cached selection-halo variants aligned with displaced stop symbols. */
const SELECTED_STOP_STYLES = new Map<string, Style>();

/** Returns the selected-stop halo for one rounded symbol displacement. */
function getSelectedStopStyle(displacement: Coordinate): Style {
  const roundedDisplacement: Coordinate = [
    Math.round(displacement[0]),
    Math.round(displacement[1]),
  ];
  const key = `${roundedDisplacement[0]}:${roundedDisplacement[1]}`;
  const cached = SELECTED_STOP_STYLES.get(key);

  if (cached) {
    return cached;
  }

  const style = new Style({
    image: new CircleStyle({
      radius: 17,
      displacement: roundedDisplacement,
      fill: new Fill({ color: 'rgba(255, 255, 255, 0.88)' }),
      stroke: new Stroke({ color: '#1769e0', width: 3 }),
    }),
  });
  SELECTED_STOP_STYLES.set(key, style);
  return style;
}

/** Selects the first mode according to the stable visual priority. */
function getPrimaryMode(modes: PublicTransportMode[]): PublicTransportMode {
  return MODE_PRIORITY.find((mode) => modes.includes(mode)) ?? modes[0];
}

/** Creates the persistent vector layers for filtered and selected stops. */
export function createPublicTransportStopsDisplay(): PublicTransportStopsDisplay {
  const source = new VectorSource<Feature<Point>>({
    attributions: PUBLIC_TRANSPORT_STOPS_ATTRIBUTION,
  });
  const selectionSource = new VectorSource<Feature<Point>>();
  const selectionLayer = new VectorLayer({
    source: selectionSource,
    minZoom: PUBLIC_TRANSPORT_STOPS_MIN_ZOOM,
    zIndex: 15,
    style: (feature, resolution) => {
      const geometry = feature.getGeometry();
      const coordinate = geometry instanceof Point
        ? geometry.getCoordinates()
        : null;
      const displacement = coordinate
        ? calculateStopDisplacement(
            coordinate,
            getStopOverlapLayout(feature),
            resolution,
          )
        : [0, 0];
      return getSelectedStopStyle(displacement);
    },
  });
  const layer = new VectorLayer({
    source,
    minZoom: PUBLIC_TRANSPORT_STOPS_MIN_ZOOM,
    zIndex: 16,
    style: (feature, resolution) => {
      const stop = getPublicTransportStopFromFeature(feature);

      if (!stop) {
        return undefined;
      }

      const displacement = calculateStopDisplacement(
        stop.coordinate,
        getStopOverlapLayout(feature),
        resolution,
      );
      return getModeStyle(getPrimaryMode(stop.modes), displacement);
    },
  });

  return { layer, source, selectionLayer, selectionSource };
}

/** Replaces the visible stop features after one completed viewport load. */
export function updatePublicTransportStopsDisplay(
  display: PublicTransportStopsDisplay,
  stops: PublicTransportStop[],
): void {
  const overlapLayouts = createStopOverlapLayouts(stops);
  const features = stops.map((stop) => {
    const feature = new Feature<Point>({
      geometry: new Point(stop.coordinate),
    });
    feature.setId(stop.id);
    feature.set(STOP_PROPERTY_NAME, stop);

    const overlapLayout = overlapLayouts.get(stop.id);

    if (overlapLayout) {
      feature.set(STOP_OVERLAP_LAYOUT_PROPERTY_NAME, overlapLayout);
    }

    return feature;
  });

  display.source.clear();
  display.source.addFeatures(features);
}

/** Updates the selected-stop halo without changing the loaded stop features. */
export function updatePublicTransportStopSelection(
  display: PublicTransportStopsDisplay,
  stop: PublicTransportStop | null,
): void {
  display.selectionSource.clear();

  if (!stop) {
    return;
  }

  const selectionFeature = new Feature<Point>({
    geometry: new Point(stop.coordinate),
  });
  const sourceFeature = display.source.getFeatureById(stop.id);
  const overlapLayout = sourceFeature?.get(
    STOP_OVERLAP_LAYOUT_PROPERTY_NAME,
  ) as unknown;

  if (overlapLayout) {
    selectionFeature.set(STOP_OVERLAP_LAYOUT_PROPERTY_NAME, overlapLayout);
  }

  display.selectionSource.addFeature(selectionFeature);
}

/** Reads structured stop metadata from one feature hit by OpenLayers. */
export function getPublicTransportStopFromFeature(
  feature: FeatureLike,
): PublicTransportStop | null {
  const value = feature.get(STOP_PROPERTY_NAME) as unknown;

  if (!value || typeof value !== 'object') {
    return null;
  }

  const stop = value as Partial<PublicTransportStop>;
  return typeof stop.name === 'string' &&
    Array.isArray(stop.modes) &&
    typeof stop.stationId === 'string'
    ? (stop as PublicTransportStop)
    : null;
}

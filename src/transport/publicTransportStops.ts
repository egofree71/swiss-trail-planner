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
import funicularIconUrl from '../assets/public-transport-stops/funicular.png';
import otherIconUrl from '../assets/public-transport-stops/other.png';
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

/** Attribution attached to the vector source built from the official layer. */
const PUBLIC_TRANSPORT_STOPS_ATTRIBUTION =
  '<a href="https://www.bav.admin.ch/" target="_blank" rel="noopener noreferrer">© BAV</a>';

/** Internal feature property containing the structured stop metadata. */
const STOP_PROPERTY_NAME = 'publicTransportStop';

/** Passenger transport categories represented by distinct map symbols. */
export type PublicTransportMode =
  | 'train'
  | 'tram'
  | 'bus'
  | 'boat'
  | 'cableCar'
  | 'funicular'
  | 'other';

/** Primary-mode ordering keeps the most structurally useful symbol visible. */
const MODE_PRIORITY: PublicTransportMode[] = [
  'train',
  'tram',
  'boat',
  'cableCar',
  'funicular',
  'bus',
  'other',
];

/** Maximum ground distance in metres for merging records of one named stop. */
const STOP_GROUPING_DISTANCE_METERS = 150;

/** Passenger stop displayed on the map and in the compact information popup. */
export interface PublicTransportStop {
  /** Stable identifier from the official BAV layer. */
  id: string;
  /** Official stop name in the selected GeoAdmin language when available. */
  name: string;
  /** Normalized transport categories used for symbols and translated titles. */
  modes: PublicTransportMode[];
  /** Original means-of-transport value for an unknown category fallback. */
  rawMeansOfTransport: string;
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

  if (
    /seilbahn|luftseilbahn|gondel|telepherique|telecabine|funivia|cabinovia|cable car/.test(
      normalized,
    )
  ) {
    modes.add('cableCar');
  }

  if (/standseilbahn|funiculaire|funicolare|funicular/.test(normalized)) {
    modes.add('funicular');
  }

  if (/schiff|bateau|navire|battello|nave|boat|ship|ferry/.test(normalized)) {
    modes.add('boat');
  }

  if (
    /metro|metropolitain|metropolitana|u bahn|underground|subway/.test(
      normalized,
    )
  ) {
    // Metro services use the train symbol because the official generic metro
    // crop is visually ambiguous at map scale.
    modes.add('train');
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

  if (modes.size === 0 && normalized && normalized !== '-') {
    modes.add('other');
  }

  return [...modes];
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

  // Operating points and retired stops have no passenger transport mode. They
  // are deliberately omitted from the hiking-planning overlay.
  if (
    !name ||
    !meansOfTransport ||
    meansOfTransport.trim() === '-' ||
    isOutOfServiceType(stopType)
  ) {
    return null;
  }

  const modes = detectTransportModes(meansOfTransport);

  if (modes.length === 0) {
    return null;
  }

  return {
    id: String(featureId),
    name,
    modes,
    rawMeansOfTransport: meansOfTransport,
    coordinate,
  };
}

/**
 * Reduces common station suffixes so nearby train and bus records can be
 * grouped when providers publish them as separate stop objects.
 */
function normalizeStopGroupingName(name: string): string {
  const normalized = normalizeText(name);
  const withoutStationSuffix = normalized.replace(
    /(?:\s+(?:gare|bahnhof|stazione|station|hb|cff|sbb|ffs))+$/,
    '',
  );

  return withoutStationSuffix || normalized;
}

/** Returns the stable display priority of one normalized transport mode. */
function getModePriority(mode: PublicTransportMode): number {
  const priority = MODE_PRIORITY.indexOf(mode);
  return priority === -1 ? MODE_PRIORITY.length : priority;
}

/** Sorts modes and drops the generic fallback when a known mode is present. */
function normalizeModes(
  modes: Iterable<PublicTransportMode>,
): PublicTransportMode[] {
  const uniqueModes = new Set(modes);

  if (uniqueModes.size > 1) {
    uniqueModes.delete('other');
  }

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

/**
 * Merges two records representing the same passenger stop.
 * The coordinate and label of the highest-priority mode are retained so a
 * train/bus interchange uses the train symbol and the railway stop name.
 */
function mergeStops(
  current: PublicTransportStop,
  incoming: PublicTransportStop,
): PublicTransportStop {
  const currentPrimary = current.modes[0] ?? 'other';
  const incomingPrimary = incoming.modes[0] ?? 'other';
  const preferIncoming =
    getModePriority(incomingPrimary) < getModePriority(currentPrimary);
  const rawMeans = new Set(
    [current.rawMeansOfTransport, incoming.rawMeansOfTransport].filter(Boolean),
  );

  return {
    id: [current.id, incoming.id].sort().join('|'),
    name: preferIncoming ? incoming.name : current.name,
    modes: normalizeModes([...current.modes, ...incoming.modes]),
    rawMeansOfTransport: [...rawMeans].join(' / '),
    coordinate: preferIncoming ? incoming.coordinate : current.coordinate,
  };
}

/**
 * Groups nearby records with the same normalized stop name.
 * Separate platform or mode records are common around railway stations; the
 * distance guard avoids combining identically named stops in another district.
 */
function groupPublicTransportStops(
  stops: PublicTransportStop[],
): PublicTransportStop[] {
  const groupsByName = new Map<string, PublicTransportStop[]>();

  for (const stop of stops) {
    const key = normalizeStopGroupingName(stop.name);
    const groups = groupsByName.get(key) ?? [];
    const groupIndex = groups.findIndex(
      (candidate) =>
        stopDistanceMeters(candidate.coordinate, stop.coordinate) <=
        STOP_GROUPING_DISTANCE_METERS,
    );

    if (groupIndex === -1) {
      groups.push({ ...stop, modes: normalizeModes(stop.modes) });
    } else {
      groups[groupIndex] = mergeStops(groups[groupIndex], stop);
    }

    groupsByName.set(key, groups);
  }

  return [...groupsByName.values()].flat();
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
    mapExtent: context.extent.join(','),
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
 * @returns Deduplicated passenger stops with no out-of-service/operational-only points.
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

  return groupPublicTransportStops([...stops.values()]);
}

/**
 * Official GeoAdmin legend symbols bundled locally for reliable client-side
 * filtering. The original WMTS layer used these clearer mode-specific icons,
 * but raster tiles could not hide out-of-service operating points.
 */
const MODE_ICON_URLS: Record<PublicTransportMode, string> = {
  train: trainIconUrl,
  tram: tramIconUrl,
  bus: busIconUrl,
  boat: boatIconUrl,
  cableCar: cableCarIconUrl,
  funicular: funicularIconUrl,
  other: otherIconUrl,
};

/** Shared immutable OpenLayers styles, one per transport category. */
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

/**
 * Selection halo drawn below the stop icon so the popup remains visually tied
 * to one marker even when several stops are clustered nearby.
 */
const SELECTED_STOP_STYLE = new Style({
  image: new CircleStyle({
    radius: 17,
    fill: new Fill({ color: 'rgba(255, 255, 255, 0.88)' }),
    stroke: new Stroke({ color: '#1769e0', width: 3 }),
  }),
});

/** Selects the first mode according to the stable visual priority. */
function getPrimaryMode(modes: PublicTransportMode[]): PublicTransportMode {
  return MODE_PRIORITY.find((mode) => modes.includes(mode)) ?? 'other';
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
    style: SELECTED_STOP_STYLE,
  });
  const layer = new VectorLayer({
    source,
    minZoom: PUBLIC_TRANSPORT_STOPS_MIN_ZOOM,
    zIndex: 16,
    style: (feature) => {
      const stop = getPublicTransportStopFromFeature(feature);
      return stop ? MODE_STYLES.get(getPrimaryMode(stop.modes)) : undefined;
    },
  });

  return { layer, source, selectionLayer, selectionSource };
}

/** Replaces the visible stop features after one completed viewport load. */
export function updatePublicTransportStopsDisplay(
  display: PublicTransportStopsDisplay,
  stops: PublicTransportStop[],
): void {
  const features = stops.map((stop) => {
    const feature = new Feature<Point>({
      geometry: new Point(stop.coordinate),
    });
    feature.setId(stop.id);
    feature.set(STOP_PROPERTY_NAME, stop);
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

  display.selectionSource.addFeature(
    new Feature<Point>({
      geometry: new Point(stop.coordinate),
    }),
  );
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
  return typeof stop.name === 'string' && Array.isArray(stop.modes)
    ? (stop as PublicTransportStop)
    : null;
}

/**
 * Business context: loads the next public-transport departures for one selected
 * stop without coupling the map overlay to a specific timetable UI. The module
 * wraps the documented transport.opendata.ch stationboard endpoint, validates
 * its loosely typed JSON, combines multimodal stop identifiers, and keeps a
 * short in-memory cache to avoid unnecessary repeat requests while a popup is
 * reopened.
 */

import type { PublicTransportMode } from './publicTransportStops';

/** Public transport departure normalized for the compact stop popup. */
export interface StationBoardDeparture {
  /** Stable client-side identifier used as the React list key. */
  id: string;
  /** Passenger-facing line label such as `29`, `M1`, or `IC 1`. */
  line: string;
  /** Destination published by the timetable provider. */
  destination: string;
  /** Planned departure as an ISO date string. */
  plannedDeparture: string;
  /** Real-time departure when available, otherwise `null`. */
  estimatedDeparture: string | null;
  /** Positive delay in whole minutes, otherwise `null`. */
  delayMinutes: number | null;
  /** Planned or predicted platform when available. */
  platform: string | null;
  /** Transport category inferred from the timetable journey itself. */
  mode: PublicTransportMode;
}

/** Combined stationboard data used by the popup. */
export interface StationBoardResult {
  /** Chronologically sorted passenger departures. */
  departures: StationBoardDeparture[];
  /** Modes confirmed by the timetable for the selected stop identifiers. */
  modes: PublicTransportMode[];
}

/** Number of departures requested for each underlying stop identifier. */
const DEPARTURES_PER_STOP = 8;

/** Cache duration in milliseconds; departures change often but not every click. */
const CACHE_DURATION_MS = 45_000;

/** Documented stationboard resource. CORS is enabled by the provider. */
const STATIONBOARD_ENDPOINT =
  'https://transport.opendata.ch/v1/stationboard';

/** One validated cache entry for a grouped stop. */
interface StationBoardCacheEntry {
  expiresAt: number;
  result: StationBoardResult;
}

/** Minimal station object used to distinguish an empty board from an invalid ID. */
interface RawStation {
  id?: unknown;
  name?: unknown;
}

/** Minimal prognosis fields used for real-time time and platform data. */
interface RawPrognosis {
  departure?: unknown;
  platform?: unknown;
}

/** Minimal stop fields nested inside one stationboard journey. */
interface RawJourneyStop {
  departure?: unknown;
  departureTimestamp?: unknown;
  platform?: unknown;
  prognosis?: unknown;
}

/** Minimal journey fields returned by transport.opendata.ch. */
interface RawJourney {
  stop?: unknown;
  name?: unknown;
  category?: unknown;
  number?: unknown;
  to?: unknown;
}

/** Minimal stationboard response envelope. */
interface RawStationBoardResponse {
  station?: unknown;
  stationboard?: unknown;
}

const stationBoardCache = new Map<string, StationBoardCacheEntry>();

/** Returns a trimmed string or `null` for all other values. */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Returns an ISO string only when the value represents a valid date. */
function readIsoDate(value: unknown): string | null {
  const text = readString(value);

  if (!text || Number.isNaN(Date.parse(text))) {
    return null;
  }

  return text;
}

/** Falls back to the documented Unix timestamp when an ISO value is absent. */
function readPlannedDeparture(stop: RawJourneyStop): string | null {
  const isoDate = readIsoDate(stop.departure);

  if (isoDate) {
    return isoDate;
  }

  if (
    typeof stop.departureTimestamp === 'number' &&
    Number.isFinite(stop.departureTimestamp)
  ) {
    return new Date(stop.departureTimestamp * 1_000).toISOString();
  }

  return null;
}

/**
 * Builds a compact passenger-facing line label.
 * Bus/tram numbers are clearer without their generic category, while railway
 * categories such as IC, IR, RE, or S remain useful alongside the number.
 */
function createLineLabel(journey: RawJourney): string {
  const category = readString(journey.category);
  const number = readString(journey.number);
  const name = readString(journey.name);
  const normalizedCategory = category?.toLowerCase() ?? '';

  if (number && !/^\d{5,}$/.test(number)) {
    if (/bus|tram|metro|métro/.test(normalizedCategory)) {
      return number;
    }

    if (category) {
      return `${category} ${number}`.trim();
    }

    return number;
  }

  if (name && !/^(?:bus|zug|train)\d{5,}$/i.test(name.replaceAll(' ', ''))) {
    return name;
  }

  return category ?? number ?? name ?? '–';
}


/**
 * Infers the passenger mode from timetable fields rather than map metadata.
 * Some BAV stop records list every mode available in a wider interchange even
 * when the selected physical stop serves only one of them.
 */
function detectJourneyMode(journey: RawJourney): PublicTransportMode {
  const value = [journey.category, journey.name, journey.number]
    .map(readString)
    .filter((part): part is string => part !== null)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\b(?:bus|autobus|postauto|car postal|b|nfb)\b/.test(value)) {
    return 'bus';
  }

  if (/\b(?:tram|t)\b/.test(value)) {
    return 'tram';
  }

  if (/\b(?:bat|bateau|schiff|ship|ferry|boat)\b/.test(value)) {
    return 'boat';
  }

  if (/\b(?:fun|funicular|funiculaire|standseilbahn)\b/.test(value)) {
    return 'funicular';
  }

  if (/\b(?:pb|gb|kabinenbahn|gondel|telepherique|cable car)\b/.test(value)) {
    return 'cableCar';
  }

  if (/\b(?:sesselbahn|sessellift|telesiege|chairlift)\b/.test(value)) {
    return 'chairlift';
  }

  // Metro categories such as `M` are operationally railway services in this
  // interface, alongside S-Bahn and conventional train categories.
  if (
    /\b(?:m|metro|subway|zug|train|treno|rail|s|r|re|ir|ic|ec|ice|tgv|ter|rjx)\b/.test(
      value,
    )
  ) {
    return 'train';
  }

  return 'other';
}

/** Converts one loosely typed journey into the stable popup contract. */
function parseDeparture(
  value: unknown,
  stationId: string,
  index: number,
): StationBoardDeparture | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const journey = value as RawJourney;
  const stop =
    journey.stop && typeof journey.stop === 'object'
      ? (journey.stop as RawJourneyStop)
      : null;
  const prognosis =
    stop?.prognosis && typeof stop.prognosis === 'object'
      ? (stop.prognosis as RawPrognosis)
      : null;
  const plannedDeparture = stop
    ? readPlannedDeparture(stop)
    : null;
  const destination = readString(journey.to);

  if (!plannedDeparture || !destination) {
    return null;
  }

  const estimatedDeparture = readIsoDate(prognosis?.departure);
  const plannedTimestamp = Date.parse(plannedDeparture);
  const estimatedTimestamp = estimatedDeparture
    ? Date.parse(estimatedDeparture)
    : plannedTimestamp;
  const delay = Math.round(
    (estimatedTimestamp - plannedTimestamp) / 60_000,
  );
  const platform =
    readString(prognosis?.platform) ?? readString(stop?.platform);
  const line = createLineLabel(journey);

  return {
    id: `${stationId}:${plannedDeparture}:${line}:${destination}:${index}`,
    line,
    destination,
    plannedDeparture,
    estimatedDeparture,
    delayMinutes: delay > 0 ? delay : null,
    platform,
    mode: detectJourneyMode(journey),
  };
}

/** Tests whether the provider matched a real station, even with no departures. */
function hasMatchedStation(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const station = value as RawStation;
  return Boolean(readString(station.id) ?? readString(station.name));
}

/**
 * Generates the raw and zero-padded ID forms accepted by different datasets.
 * BAV features commonly expose seven digits, while the API documentation also
 * uses nine-character identifiers prefixed with two zeros.
 */
function createStationIdCandidates(stationId: string): string[] {
  const normalized = stationId.trim();
  const candidates = [normalized];

  if (/^\d+$/.test(normalized) && normalized.length < 9) {
    candidates.push(normalized.padStart(9, '0'));
  }

  return [...new Set(candidates)];
}

/** Requests one physical stop ID, retrying its zero-padded representation. */
async function fetchStationDepartures(
  stationId: string,
  signal: AbortSignal,
): Promise<StationBoardDeparture[]> {
  for (const candidate of createStationIdCandidates(stationId)) {
    const parameters = new URLSearchParams({
      id: candidate,
      limit: String(DEPARTURES_PER_STOP),
    });
    const response = await fetch(`${STATIONBOARD_ENDPOINT}?${parameters}`, {
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Stationboard loading failed with ${response.status}.`,
      );
    }

    const payload = (await response.json()) as RawStationBoardResponse;
    const rawJourneys = Array.isArray(payload.stationboard)
      ? payload.stationboard
      : [];
    const departures = rawJourneys
      .map((journey, index) => parseDeparture(journey, candidate, index))
      .filter(
        (departure): departure is StationBoardDeparture =>
          departure !== null,
      );

    if (hasMatchedStation(payload.station) || departures.length > 0) {
      return departures;
    }
  }

  return [];
}

/** Returns the predicted departure timestamp used for sorting. */
function effectiveDepartureTimestamp(
  departure: StationBoardDeparture,
): number {
  return Date.parse(
    departure.estimatedDeparture ?? departure.plannedDeparture,
  );
}

/**
 * Deduplicates departures returned by multiple records of one multimodal stop.
 * Providers can publish rail and bus identifiers separately while returning
 * overlapping journeys, so time, line, and destination form the stable key.
 */
function mergeStationBoards(
  departureLists: StationBoardDeparture[][],
): StationBoardResult {
  const departures = new Map<string, StationBoardDeparture>();
  const modes = new Set<PublicTransportMode>();

  for (const departure of departureLists.flat()) {
    const key = [
      departure.plannedDeparture,
      departure.line.toLowerCase(),
      departure.destination.toLowerCase(),
    ].join('|');

    modes.add(departure.mode);

    if (!departures.has(key)) {
      departures.set(key, departure);
    }
  }

  const modePriority: PublicTransportMode[] = [
    'train',
    'tram',
    'boat',
    'cableCar',
    'chairlift',
    'funicular',
    'bus',
    'other',
  ];

  if (modes.size > 1) {
    modes.delete('other');
  }

  return {
    departures: [...departures.values()]
      .sort(
        (first, second) =>
          effectiveDepartureTimestamp(first) -
          effectiveDepartureTimestamp(second),
      )
      .slice(0, DEPARTURES_PER_STOP),
    modes: [...modes].sort(
      (first, second) =>
        modePriority.indexOf(first) - modePriority.indexOf(second),
    ),
  };
}

/**
 * Loads the next departures for one displayed stop.
 *
 * @param stationIds - One or more BAV identifiers merged into the map marker.
 * @param signal - Abort signal used when another stop is selected or closed.
 * @returns Sorted departures and transport modes confirmed by timetable data.
 * @throws {Error} When every provider request fails.
 */
export async function loadStationBoard(
  stationIds: string[],
  signal: AbortSignal,
): Promise<StationBoardResult> {
  const uniqueIds = [...new Set(stationIds.map((id) => id.trim()).filter(Boolean))]
    .sort();
  const cacheKey = uniqueIds.join('|');
  const cached = stationBoardCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const results = await Promise.allSettled(
    uniqueIds.map((stationId) =>
      fetchStationDepartures(stationId, signal),
    ),
  );

  if (signal.aborted) {
    throw new DOMException('Stationboard request aborted.', 'AbortError');
  }

  const successfulResults = results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<StationBoardDeparture[]> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value);

  if (successfulResults.length === 0) {
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );

    throw firstFailure?.reason instanceof Error
      ? firstFailure.reason
      : new Error('Stationboard loading failed.');
  }

  const result = mergeStationBoards(successfulResults);
  stationBoardCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_DURATION_MS,
    result,
  });

  return result;
}

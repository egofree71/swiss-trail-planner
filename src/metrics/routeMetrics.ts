/**
 * Business context: derives the compact planning statistics shown for the
 * current route. Distance is calculated immediately in the browser, while
 * ascent and descent come from GeoAdmin's official elevation-profile service.
 * The resulting values also feed the standard Swiss hiking-time estimate.
 */
import type { Coordinate } from 'ol/coordinate.js';
import LineString from 'ol/geom/LineString.js';
import { toLonLat } from 'ol/proj.js';
import { getLength } from 'ol/sphere.js';

/** Official GeoAdmin endpoint returning elevations along an LV95 polyline. */
const ELEVATION_PROFILE_ENDPOINT =
  'https://api3.geo.admin.ch/rest/services/profile.json';
/** Target spacing in metres between elevation samples along the route. */
const PROFILE_SAMPLE_INTERVAL_METERS = 20;
/** Minimum profile size required to calculate ascent and descent. */
const PROFILE_MIN_SAMPLE_POINTS = 2;
/**
 * Maximum response size requested from the profile service. This keeps long
 * regional routes responsive while retaining roughly 20 metre sampling for
 * ordinary hikes.
 */
const PROFILE_MAX_SAMPLE_POINTS = 1_000;
/**
 * Maximum amount of route vertices sent to GeoAdmin. The service accepts up to
 * roughly 5,000 coordinates; staying below that cap leaves room for future
 * endpoint changes and limits request-body size.
 */
const PROFILE_MAX_INPUT_COORDINATES = 4_000;
/**
 * Number of neighbouring samples on either side used by the service's moving
 * average. A small value reduces terrain noise without flattening genuine
 * climbs over normal hiking distances.
 */
const PROFILE_SMOOTHING_OFFSET = 2;
/** Minutes allocated by the Swiss rule of thumb for one kilometre walked. */
const MINUTES_PER_KILOMETRE = 15;
/** Minutes added by the Swiss rule of thumb for 100 metres of ascent. */
const MINUTES_PER_100_METERS_ASCENT = 15;
/** Minutes added by the Swiss rule of thumb for 200 metres of descent. */
const MINUTES_PER_200_METERS_DESCENT = 15;

/** One ordered elevation sample along the route. */
export interface RouteElevationPoint {
  /** Cumulative distance from the start of the route in metres. */
  distanceMeters: number;
  /** Smoothed terrain elevation in metres. */
  elevationMeters: number;
}

/** Elevation values used by the route summary and optional profile chart. */
export interface RouteElevationSummary {
  /** Accumulated positive elevation change in metres. */
  ascentMeters: number;
  /** Accumulated negative elevation change in metres, expressed positively. */
  descentMeters: number;
  /** Ordered samples returned by the profile service. */
  points: RouteElevationPoint[];
}

/** Untrusted altitude container returned by the profile service. */
interface ElevationProfileAltitudes {
  /** Combined best-available terrain model value. */
  COMB?: unknown;
}

/** One untrusted elevation sample returned by GeoAdmin. */
interface ElevationProfilePoint {
  /** Available terrain-model altitudes for the sample. */
  alts?: ElevationProfileAltitudes;
  /** Cumulative distance from the start of the requested profile. */
  dist?: unknown;
}

/** Returns a finite number from an external numeric value or numeric string. */
function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}

/**
 * Converts WGS 84 longitude/latitude to approximate Swiss LV95 coordinates.
 *
 * The polynomial is the official swisstopo approximation, accurate to better
 * than one metre throughout Switzerland. That is more precise than needed for
 * selecting terrain samples spaced about 20 metres apart.
 *
 * @param longitude - WGS 84 longitude in decimal degrees.
 * @param latitude - WGS 84 latitude in decimal degrees.
 * @returns LV95 easting and northing in metres.
 */
function wgs84ToLv95(longitude: number, latitude: number): Coordinate {
  const latitudeSeconds = latitude * 3_600;
  const longitudeSeconds = longitude * 3_600;
  const latitudeOffset = (latitudeSeconds - 169_028.66) / 10_000;
  const longitudeOffset = (longitudeSeconds - 26_782.5) / 10_000;

  const easting =
    2_600_072.37 +
    211_455.93 * longitudeOffset -
    10_938.51 * longitudeOffset * latitudeOffset -
    0.36 * longitudeOffset * latitudeOffset ** 2 -
    44.54 * longitudeOffset ** 3;
  const northing =
    1_200_147.07 +
    308_807.95 * latitudeOffset +
    3_745.25 * longitudeOffset ** 2 +
    76.63 * latitudeOffset ** 2 -
    194.56 * longitudeOffset ** 2 * latitudeOffset +
    119.79 * latitudeOffset ** 3;

  return [easting, northing];
}

/** Converts one EPSG:3857 map coordinate to LV95 for the profile service. */
function mapCoordinateToLv95(coordinate: Coordinate): Coordinate {
  const [longitude, latitude] = toLonLat(coordinate);
  return wgs84ToLv95(longitude, latitude);
}

/**
 * Reduces very dense route geometry while preserving the first and last point.
 *
 * The elevation service resamples the complete polyline itself, so uniformly
 * retaining up to 4,000 source vertices is sufficient for height lookup while
 * preventing oversized request bodies on unusually detailed routes.
 */
function limitProfileCoordinates(coordinates: Coordinate[]): Coordinate[] {
  if (coordinates.length <= PROFILE_MAX_INPUT_COORDINATES) {
    return coordinates;
  }

  const limitedCoordinates: Coordinate[] = [];
  const lastIndex = coordinates.length - 1;

  for (let index = 0; index < PROFILE_MAX_INPUT_COORDINATES; index += 1) {
    const sourceIndex = Math.round(
      (index * lastIndex) / (PROFILE_MAX_INPUT_COORDINATES - 1),
    );
    limitedCoordinates.push(coordinates[sourceIndex]);
  }

  return limitedCoordinates;
}

/** Calculates the requested amount of elevation samples from route length. */
function profileSampleCount(distanceMeters: number): number {
  return Math.min(
    PROFILE_MAX_SAMPLE_POINTS,
    Math.max(
      PROFILE_MIN_SAMPLE_POINTS,
      Math.ceil(distanceMeters / PROFILE_SAMPLE_INTERVAL_METERS) + 1,
    ),
  );
}

/**
 * Calculates geodesic route length from the displayed Web Mercator geometry.
 * @param coordinates - Ordered route vertices in EPSG:3857.
 * @returns Horizontal distance in metres, or zero for fewer than two points.
 */
export function calculateRouteDistance(coordinates: Coordinate[]): number {
  if (coordinates.length < 2) {
    return 0;
  }

  const line = new LineString(
    coordinates.map((coordinate) => [coordinate[0], coordinate[1]]),
  );
  return getLength(line, { projection: 'EPSG:3857' });
}

/**
 * Retrieves and accumulates smoothed elevations along the current route.
 *
 * @param coordinates - Ordered route vertices in EPSG:3857.
 * @param distanceMeters - Already calculated route distance used to size the profile.
 * @param signal - Abort signal used when route history changes before completion.
 * @returns Total ascent and descent in metres.
 * @throws {Error} If the profile response is unavailable, malformed, or incomplete.
 */
export async function fetchRouteElevationSummary(
  coordinates: Coordinate[],
  distanceMeters: number,
  signal: AbortSignal,
): Promise<RouteElevationSummary> {
  if (coordinates.length < 2 || distanceMeters <= 0) {
    throw new Error('An elevation profile requires a route line.');
  }

  const profileCoordinates = limitProfileCoordinates(coordinates).map(
    mapCoordinateToLv95,
  );
  const geometry = {
    type: 'LineString',
    coordinates: profileCoordinates.map(([easting, northing]) => [
      Number(easting.toFixed(2)),
      Number(northing.toFixed(2)),
    ]),
  };
  const requestUrl = new URL(ELEVATION_PROFILE_ENDPOINT);
  requestUrl.searchParams.set('sr', '2056');
  requestUrl.searchParams.set(
    'nb_points',
    String(profileSampleCount(distanceMeters)),
  );
  requestUrl.searchParams.set('offset', String(PROFILE_SMOOTHING_OFFSET));

  /*
   * GeoAdmin accepts the GeoJSON LineString directly as the POST body. Keeping
   * numeric options in the query avoids wrapping the geometry in a provider-
   * specific payload and mirrors the service's documented parameter contract.
   */
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(geometry),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Elevation profile request failed with ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error('Elevation profile response is not an array.');
  }

  const points = payload
    .map((point): RouteElevationPoint | null => {
      if (!point || typeof point !== 'object') {
        return null;
      }

      const profilePoint = point as ElevationProfilePoint;
      const elevationMeters = readFiniteNumber(profilePoint.alts?.COMB);
      const distanceMeters = readFiniteNumber(profilePoint.dist);

      if (elevationMeters === null || distanceMeters === null) {
        return null;
      }

      return {
        distanceMeters,
        elevationMeters,
      };
    })
    .filter((point): point is RouteElevationPoint => point !== null);

  if (points.length < PROFILE_MIN_SAMPLE_POINTS) {
    throw new Error('Elevation profile contains too few valid samples.');
  }

  let ascentMeters = 0;
  let descentMeters = 0;

  for (let index = 1; index < points.length; index += 1) {
    const difference =
      points[index].elevationMeters - points[index - 1].elevationMeters;

    if (difference > 0) {
      ascentMeters += difference;
    } else {
      descentMeters -= difference;
    }
  }

  return {
    ascentMeters,
    descentMeters,
    points,
  };
}

/**
 * Applies the standard Swiss hiking-time rule of thumb.
 * @param distanceMeters - Horizontal route distance in metres.
 * @param ascentMeters - Accumulated ascent in metres.
 * @param descentMeters - Accumulated descent in metres.
 * @returns Estimated walking time in minutes, excluding breaks.
 */
export function estimateHikingDuration(
  distanceMeters: number,
  ascentMeters: number,
  descentMeters: number,
): number {
  return (
    (distanceMeters / 1_000) * MINUTES_PER_KILOMETRE +
    (ascentMeters / 100) * MINUTES_PER_100_METERS_ASCENT +
    (descentMeters / 200) * MINUTES_PER_200_METERS_DESCENT
  );
}

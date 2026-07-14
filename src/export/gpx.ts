/**
 * Business context: exports the route currently edited in Swiss Trail Planner
 * as a standalone GPX 1.1 track. Routed section vertices are preserved so
 * external hiking applications display the exact swissTLM3D geometry, while
 * the smoothed elevation samples are embedded when available so compatible
 * applications do not need to rebuild a noisier terrain profile.
 */
import type { Coordinate } from 'ol/coordinate.js';
import { toLonLat } from 'ol/proj.js';
import { getDistance } from 'ol/sphere.js';
import {
  collectRouteCoordinates,
  type RouteClosure,
  type RouteStep,
} from '../map/route';
import type { RouteElevationPoint } from '../metrics/routeMetrics';

/** Language-neutral fallback used if a route name contains no valid filename characters. */
const GPX_FILENAME_FALLBACK = 'swiss-trail-planner-route';
/** Decimal places for WGS 84 coordinates; seven digits provide sub-metre precision. */
const GPX_COORDINATE_PRECISION = 7;
/** Decimal places for elevation values supplied by the terrain profile service. */
const GPX_ELEVATION_PRECISION = 1;
/** Distance tolerance in metres used to merge route vertices and regular profile samples. */
const GPX_DISTANCE_MERGE_TOLERANCE_METERS = 0.01;


/**
 * Converts a route name into a portable GPX filename while preserving readable
 * spaces and Unicode characters. Browser save dialogs may still let the user
 * rename the file afterwards, but the initial filename and internal GPX name
 * now originate from the same value.
 *
 * @param routeName - Name entered in the export dialog.
 * @returns Filename ending in `.gpx`.
 */
function createGpxFilename(routeName: string): string {
  const withoutExtension = routeName.trim().replace(/\.gpx$/i, '');
  const sanitizedName = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();

  return `${sanitizedName || GPX_FILENAME_FALLBACK}.gpx`;
}

/** One GPX track point assembled from route geometry and optional terrain elevation. */
interface GpxTrackPoint {
  /** WGS 84 longitude and latitude in that order. */
  coordinate: Coordinate;
  /** Smoothed terrain elevation in metres, or `null` when no profile is available. */
  elevationMeters: number | null;
}

/** Route geometry prepared for distance-based interpolation. */
interface MeasuredRoute {
  /** Original map coordinates in EPSG:3857. */
  coordinates: Coordinate[];
  /** WGS 84 coordinates used for geodesic segment lengths and GPX output. */
  lonLatCoordinates: Coordinate[];
  /** Cumulative geodesic distance at each original route vertex, in metres. */
  cumulativeDistances: number[];
  /** Total geodesic route distance in metres. */
  totalDistanceMeters: number;
}

/**
 * Escapes text inserted into XML nodes.
 * @param value - Untrusted or application-provided text.
 * @returns XML-safe text content.
 */
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Measures the displayed route once so coordinates can be interpolated at the
 * same regular distances used by the elevation profile.
 * @param coordinates - Ordered route vertices in EPSG:3857.
 * @returns Route coordinates and cumulative geodesic distances.
 */
function measureRoute(coordinates: Coordinate[]): MeasuredRoute {
  const lonLatCoordinates = coordinates.map((coordinate) =>
    toLonLat(coordinate),
  );
  const cumulativeDistances = [0];

  for (let index = 1; index < lonLatCoordinates.length; index += 1) {
    const segmentDistance = getDistance(
      lonLatCoordinates[index - 1],
      lonLatCoordinates[index],
    );
    cumulativeDistances.push(
      cumulativeDistances[cumulativeDistances.length - 1] + segmentDistance,
    );
  }

  return {
    coordinates,
    lonLatCoordinates,
    cumulativeDistances,
    totalDistanceMeters:
      cumulativeDistances[cumulativeDistances.length - 1] ?? 0,
  };
}

/**
 * Returns the route coordinate at a cumulative distance.
 *
 * Interpolation is performed in the map projection between adjacent original
 * vertices. Since route segments are short, this preserves the displayed path
 * while the cumulative lookup itself uses geodesic metre distances.
 *
 * @param route - Pre-measured route geometry.
 * @param distanceMeters - Target cumulative distance from the route start.
 * @returns Interpolated WGS 84 longitude/latitude coordinate.
 */
function coordinateAtDistance(
  route: MeasuredRoute,
  distanceMeters: number,
): Coordinate {
  if (distanceMeters <= 0) {
    return [...route.lonLatCoordinates[0]];
  }

  if (distanceMeters >= route.totalDistanceMeters) {
    return [...route.lonLatCoordinates[route.lonLatCoordinates.length - 1]];
  }

  let upperIndex = 1;

  while (
    upperIndex < route.cumulativeDistances.length &&
    route.cumulativeDistances[upperIndex] < distanceMeters
  ) {
    upperIndex += 1;
  }

  const lowerIndex = Math.max(0, upperIndex - 1);
  const lowerDistance = route.cumulativeDistances[lowerIndex];
  const upperDistance = route.cumulativeDistances[upperIndex];
  const segmentDistance = upperDistance - lowerDistance;
  const fraction =
    segmentDistance > 0
      ? (distanceMeters - lowerDistance) / segmentDistance
      : 0;
  const lowerCoordinate = route.coordinates[lowerIndex];
  const upperCoordinate = route.coordinates[upperIndex];
  const interpolatedMapCoordinate: Coordinate = [
    lowerCoordinate[0] +
      (upperCoordinate[0] - lowerCoordinate[0]) * fraction,
    lowerCoordinate[1] +
      (upperCoordinate[1] - lowerCoordinate[1]) * fraction,
  ];

  return toLonLat(interpolatedMapCoordinate);
}

/**
 * Normalizes untrusted profile input into strictly increasing finite samples.
 * @param points - Smoothed distance/elevation samples used by the profile chart.
 * @returns Ordered samples with duplicate distances removed.
 */
function normalizeElevationPoints(
  points: RouteElevationPoint[],
): RouteElevationPoint[] {
  const sortedPoints = points
    .filter(
      (point) =>
        Number.isFinite(point.distanceMeters) &&
        Number.isFinite(point.elevationMeters),
    )
    .slice()
    .sort((first, second) => first.distanceMeters - second.distanceMeters);
  const normalizedPoints: RouteElevationPoint[] = [];

  for (const point of sortedPoints) {
    const previousPoint = normalizedPoints[normalizedPoints.length - 1];

    if (
      previousPoint &&
      Math.abs(point.distanceMeters - previousPoint.distanceMeters) <=
        GPX_DISTANCE_MERGE_TOLERANCE_METERS
    ) {
      // The later value replaces a duplicate distance so interpolation never
      // divides by an effectively zero profile section.
      normalizedPoints[normalizedPoints.length - 1] = point;
    } else {
      normalizedPoints.push(point);
    }
  }

  return normalizedPoints;
}

/**
 * Interpolates smoothed elevation at one distance along the profile.
 * @param points - Strictly increasing normalized elevation samples.
 * @param distanceMeters - Distance in the profile service's own distance scale.
 * @returns Interpolated elevation in metres.
 */
function elevationAtDistance(
  points: RouteElevationPoint[],
  distanceMeters: number,
): number {
  if (distanceMeters <= points[0].distanceMeters) {
    return points[0].elevationMeters;
  }

  const lastPoint = points[points.length - 1];

  if (distanceMeters >= lastPoint.distanceMeters) {
    return lastPoint.elevationMeters;
  }

  let upperIndex = 1;

  while (
    upperIndex < points.length &&
    points[upperIndex].distanceMeters < distanceMeters
  ) {
    upperIndex += 1;
  }

  const lowerPoint = points[upperIndex - 1];
  const upperPoint = points[upperIndex];
  const profileSectionDistance =
    upperPoint.distanceMeters - lowerPoint.distanceMeters;
  const fraction =
    profileSectionDistance > 0
      ? (distanceMeters - lowerPoint.distanceMeters) /
        profileSectionDistance
      : 0;

  return (
    lowerPoint.elevationMeters +
    (upperPoint.elevationMeters - lowerPoint.elevationMeters) * fraction
  );
}

/**
 * Merges exact route vertices with regular elevation samples.
 *
 * Keeping original vertices preserves sharp swissTLM3D bends. Adding the
 * profile distances ensures long straight sections still contain enough GPX
 * points for another application to reproduce the same smooth altitude curve.
 *
 * @param route - Pre-measured exact displayed geometry.
 * @param elevationPoints - Smoothed profile samples already shown in the UI.
 * @returns GPX points with interpolated WGS 84 coordinates and elevations.
 */
function createElevationAwareTrackPoints(
  route: MeasuredRoute,
  elevationPoints: RouteElevationPoint[],
): GpxTrackPoint[] | null {
  const normalizedElevationPoints = normalizeElevationPoints(elevationPoints);

  if (
    normalizedElevationPoints.length < 2 ||
    route.totalDistanceMeters <= 0
  ) {
    return null;
  }

  const firstProfileDistance =
    normalizedElevationPoints[0].distanceMeters;
  const lastProfileDistance =
    normalizedElevationPoints[normalizedElevationPoints.length - 1]
      .distanceMeters;
  const profileDistanceSpan = lastProfileDistance - firstProfileDistance;

  if (profileDistanceSpan <= 0) {
    return null;
  }

  const routeDistances = [
    ...route.cumulativeDistances,
    ...normalizedElevationPoints.map((point) =>
      ((point.distanceMeters - firstProfileDistance) /
        profileDistanceSpan) *
      route.totalDistanceMeters,
    ),
  ].sort((first, second) => first - second);
  const mergedDistances: number[] = [];

  for (const distance of routeDistances) {
    const clampedDistance = Math.min(
      route.totalDistanceMeters,
      Math.max(0, distance),
    );
    const previousDistance = mergedDistances[mergedDistances.length - 1];

    if (
      previousDistance === undefined ||
      Math.abs(clampedDistance - previousDistance) >
        GPX_DISTANCE_MERGE_TOLERANCE_METERS
    ) {
      mergedDistances.push(clampedDistance);
    }
  }

  return mergedDistances.map((routeDistance): GpxTrackPoint => {
    const profileDistance =
      firstProfileDistance +
      (routeDistance / route.totalDistanceMeters) * profileDistanceSpan;

    return {
      coordinate: coordinateAtDistance(route, routeDistance),
      elevationMeters: elevationAtDistance(
        normalizedElevationPoints,
        profileDistance,
      ),
    };
  });
}

/** Creates geometry-only GPX points when no valid elevation profile is available. */
function createGeometryTrackPoints(route: MeasuredRoute): GpxTrackPoint[] {
  return route.lonLatCoordinates.map((coordinate) => ({
    coordinate: [...coordinate],
    elevationMeters: null,
  }));
}

/** Serializes one GPX track point with optional elevation. */
function serializeTrackPoint(point: GpxTrackPoint): string {
  const [longitude, latitude] = point.coordinate;
  const attributes = `lat="${latitude.toFixed(GPX_COORDINATE_PRECISION)}" lon="${longitude.toFixed(GPX_COORDINATE_PRECISION)}"`;

  if (point.elevationMeters === null) {
    return `      <trkpt ${attributes} />`;
  }

  return `      <trkpt ${attributes}>\n        <ele>${point.elevationMeters.toFixed(GPX_ELEVATION_PRECISION)}</ele>\n      </trkpt>`;
}

/**
 * Builds a GPX 1.1 track from the exact displayed route geometry.
 * @param steps - Applied route steps in display order.
 * @param generatedAt - Timestamp written to GPX metadata.
 * @param routeName - Localized track name written to metadata and track nodes.
 * @param elevationPoints - Optional smoothed profile samples to embed as `<ele>` values.
 * @param closure - Optional dedicated section returning the last waypoint to the first.
 * @returns Complete UTF-8 XML document.
 * @throws {Error} If the route does not contain at least two coordinates.
 */
export function createRouteGpx(
  steps: RouteStep[],
  generatedAt: Date = new Date(),
  routeName = 'Swiss Trail Planner route',
  elevationPoints: RouteElevationPoint[] = [],
  closure: RouteClosure | null = null,
): string {
  const coordinates = collectRouteCoordinates(steps, closure);

  if (coordinates.length < 2) {
    throw new Error('A GPX route requires at least two coordinates.');
  }

  const route = measureRoute(coordinates);
  const trackPoints =
    createElevationAwareTrackPoints(route, elevationPoints) ??
    createGeometryTrackPoints(route);
  const serializedTrackPoints = trackPoints
    .map(serializeTrackPoint)
    .join('\n');
  const escapedRouteName = escapeXml(routeName);

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Swiss Trail Planner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapedRouteName}</name>
    <time>${generatedAt.toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapedRouteName}</name>
    <trkseg>
${serializedTrackPoints}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Starts a browser download for the current route as a GPX file.
 *
 * The object URL is revoked on the next task so the click can consume it first
 * without retaining the generated document in memory for the page lifetime.
 *
 * @param steps - Applied route steps in display order.
 * @param routeName - Localized track name written into the GPX document.
 * @param elevationPoints - Optional smoothed profile samples embedded in track points.
 * @param closure - Optional dedicated section returning the last waypoint to the first.
 * @throws {Error} If the route is too short to export.
 */
export function downloadRouteGpx(
  steps: RouteStep[],
  routeName = 'Swiss Trail Planner route',
  elevationPoints: RouteElevationPoint[] = [],
  closure: RouteClosure | null = null,
): void {
  const generatedAt = new Date();
  const gpxDocument = createRouteGpx(
    steps,
    generatedAt,
    routeName,
    elevationPoints,
    closure,
  );
  const blob = new Blob([gpxDocument], {
    type: 'application/gpx+xml;charset=utf-8',
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement('a');

  link.href = objectUrl;
  link.download = createGpxFilename(routeName);
  link.style.display = 'none';
  window.document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

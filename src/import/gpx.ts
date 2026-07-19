/**
 * Business context: reads external GPX tracks and routes so hikers can display
 * a current read-only itinerary without turning it into editable route history.
 * The parser accepts common GPX track and route structures, preserves complete
 * embedded elevations, and keeps all file handling local to the browser.
 */
import type { Coordinate } from 'ol/coordinate.js';

/** Maximum accepted GPX size in bytes; protects the browser from accidental huge files. */
export const MAX_GPX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** One independent GPX line and its optional complete elevation series. */
export interface ImportedGpxSegment {
  /** Ordered WGS 84 longitude/latitude coordinates. */
  coordinates: Coordinate[];
  /** Elevation for every coordinate, or `null` when at least one value is unavailable. */
  elevationsMeters: number[] | null;
}

/** Parsed read-only itinerary extracted from one GPX document. */
export interface ImportedGpxRoute {
  /** Human-readable name from the GPX, or the source filename when absent. */
  name: string;
  /** Independent GPX segments; disconnected track segments stay disconnected. */
  segments: ImportedGpxSegment[];
}

/** Error categories exposed to the UI without leaking parser implementation details. */
export type GpxImportErrorCode = 'invalid' | 'empty';

/** Expected validation error raised while importing a GPX document. */
export class GpxImportError extends Error {
  /** Stable category used to select a translated user message. */
  readonly code: GpxImportErrorCode;

  constructor(code: GpxImportErrorCode, message: string) {
    super(message);
    this.name = 'GpxImportError';
    this.code = code;
  }
}

/** Returns direct child text without accidentally reading a nested track point name. */
function directChildText(element: Element, localName: string): string | null {
  for (let index = 0; index < element.children.length; index += 1) {
    const child = element.children.item(index);

    if (child?.localName === localName) {
      const text = child.textContent?.trim();
      return text || null;
    }
  }

  return null;
}

/** Parses a finite direct-child elevation value when one is available. */
function parseElevation(element: Element): number | null {
  const text = directChildText(element, 'ele');

  if (text === null) {
    return null;
  }

  const elevationMeters = Number(text);
  return Number.isFinite(elevationMeters) ? elevationMeters : null;
}

/** Parses and validates one GPX latitude/longitude element. */
function parseCoordinate(element: Element): Coordinate | null {
  const latitudeText = element.getAttribute('lat');
  const longitudeText = element.getAttribute('lon');

  // Missing and empty attributes must not silently become zero through Number().
  if (!latitudeText?.trim() || !longitudeText?.trim()) {
    return null;
  }

  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return [longitude, latitude];
}

/**
 * Extracts one valid GPX segment while validating and deduplicating points in
 * one pass. Avoiding intermediate point objects and array pipelines keeps large
 * GPS recordings from doing several complete allocation-heavy traversals.
 *
 * @param parent - Track-segment or route element containing point descendants.
 * @param pointLocalName - Namespace-independent GPX point element name.
 * @returns A usable line with at least two coordinates, or `null`.
 */
function extractSegment(
  parent: Element,
  pointLocalName: string,
): ImportedGpxSegment | null {
  const pointElements = parent.getElementsByTagNameNS('*', pointLocalName);
  const coordinates: Coordinate[] = [];
  const elevationsMeters: number[] = [];
  let missingElevationCount = 0;

  for (let index = 0; index < pointElements.length; index += 1) {
    const pointElement = pointElements.item(index);

    if (!pointElement) {
      continue;
    }

    const coordinate = parseCoordinate(pointElement);

    if (!coordinate) {
      continue;
    }

    const elevationMeters = parseElevation(pointElement);
    const previousIndex = coordinates.length - 1;
    const previousCoordinate = coordinates[previousIndex];

    if (
      previousCoordinate &&
      previousCoordinate[0] === coordinate[0] &&
      previousCoordinate[1] === coordinate[1]
    ) {
      // A duplicate carrying the only valid elevation should enrich the kept
      // point rather than forcing the complete segment to use GeoAdmin later.
      if (
        !Number.isFinite(elevationsMeters[previousIndex]) &&
        elevationMeters !== null
      ) {
        elevationsMeters[previousIndex] = elevationMeters;
        missingElevationCount -= 1;
      }
      continue;
    }

    coordinates.push(coordinate);

    if (elevationMeters === null) {
      elevationsMeters.push(Number.NaN);
      missingElevationCount += 1;
    } else {
      elevationsMeters.push(elevationMeters);
    }
  }

  if (coordinates.length < 2) {
    return null;
  }

  return {
    coordinates,
    elevationsMeters: missingElevationCount === 0 ? elevationsMeters : null,
  };
}

/** Derives a readable fallback from the uploaded filename. */
function filenameWithoutExtension(filename: string): string {
  const trimmed = filename.trim();
  const withoutExtension = trimmed.replace(/\.gpx$/i, '').trim();
  return withoutExtension || 'GPX';
}

/**
 * Parses GPX tracks (`trk/trkseg/trkpt`) and routes (`rte/rtept`).
 *
 * Separate track segments remain separate so the display never invents a line
 * across a deliberate GPX gap. Elevation is exposed only when every retained
 * point in a segment has a valid `<ele>` value; callers can then use the file's
 * own profile or fall back to the terrain service. Waypoints alone are not
 * treated as an itinerary.
 *
 * @param xml - Complete GPX XML text.
 * @param filename - Source filename used when the GPX has no route name.
 * @returns A named read-only route with independent WGS 84 segments.
 * @throws {GpxImportError} When XML is invalid or no usable line is present.
 */
export function parseGpxRoute(xml: string, filename: string): ImportedGpxRoute {
  const document = new DOMParser().parseFromString(xml, 'application/xml');

  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new GpxImportError('invalid', 'Invalid GPX XML.');
  }

  const root = document.documentElement;

  if (!root || root.localName.toLowerCase() !== 'gpx') {
    throw new GpxImportError('invalid', 'The document is not GPX.');
  }

  const segments: ImportedGpxSegment[] = [];
  let routeName: string | null = null;

  const tracks = root.getElementsByTagNameNS('*', 'trk');

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks.item(trackIndex);

    if (!track) {
      continue;
    }

    routeName ??= directChildText(track, 'name');
    const trackSegments = track.getElementsByTagNameNS('*', 'trkseg');

    for (
      let segmentIndex = 0;
      segmentIndex < trackSegments.length;
      segmentIndex += 1
    ) {
      const trackSegment = trackSegments.item(segmentIndex);
      const segment = trackSegment
        ? extractSegment(trackSegment, 'trkpt')
        : null;

      if (segment) {
        segments.push(segment);
      }
    }
  }

  const routes = root.getElementsByTagNameNS('*', 'rte');

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes.item(routeIndex);

    if (!route) {
      continue;
    }

    routeName ??= directChildText(route, 'name');
    const segment = extractSegment(route, 'rtept');

    if (segment) {
      segments.push(segment);
    }
  }

  if (segments.length === 0) {
    throw new GpxImportError('empty', 'No usable GPX track or route was found.');
  }

  const metadata = root.getElementsByTagNameNS('*', 'metadata')[0];
  routeName ??= metadata ? directChildText(metadata, 'name') : null;

  return {
    name: routeName ?? filenameWithoutExtension(filename),
    segments,
  };
}

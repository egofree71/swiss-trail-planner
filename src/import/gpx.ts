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

/** Valid coordinate and optional altitude parsed from one GPX point element. */
interface ParsedGpxPoint {
  /** WGS 84 longitude and latitude. */
  coordinate: Coordinate;
  /** Embedded GPX elevation, or `null` when missing or invalid. */
  elevationMeters: number | null;
}

/** Returns direct child text without accidentally reading a nested track point name. */
function directChildText(element: Element, localName: string): string | null {
  for (const child of Array.from(element.children)) {
    if (child.localName === localName) {
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
function parsePoint(element: Element): ParsedGpxPoint | null {
  const latitude = Number(element.getAttribute('lat'));
  const longitude = Number(element.getAttribute('lon'));

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

  return {
    coordinate: [longitude, latitude],
    elevationMeters: parseElevation(element),
  };
}

/**
 * Removes consecutive duplicate coordinates that can create zero-length
 * features. When only one duplicate contains elevation, that useful value is
 * retained so a harmless duplicate does not force a terrain-service fallback.
 */
function deduplicatePoints(points: ParsedGpxPoint[]): ParsedGpxPoint[] {
  const result: ParsedGpxPoint[] = [];

  for (const point of points) {
    const previous = result[result.length - 1];

    if (
      previous &&
      previous.coordinate[0] === point.coordinate[0] &&
      previous.coordinate[1] === point.coordinate[1]
    ) {
      if (
        previous.elevationMeters === null &&
        point.elevationMeters !== null
      ) {
        result[result.length - 1] = point;
      }
      continue;
    }

    result.push(point);
  }

  return result;
}

/** Extracts one valid GPX segment from descendant point elements. */
function extractSegment(
  parent: Element,
  pointLocalName: string,
): ImportedGpxSegment | null {
  const points = deduplicatePoints(
    Array.from(parent.getElementsByTagNameNS('*', pointLocalName))
      .map(parsePoint)
      .filter((point): point is ParsedGpxPoint => point !== null),
  );

  if (points.length < 2) {
    return null;
  }

  const hasCompleteElevations = points.every(
    (point) => point.elevationMeters !== null,
  );

  return {
    coordinates: points.map((point) => point.coordinate),
    elevationsMeters: hasCompleteElevations
      ? points.map((point) => point.elevationMeters as number)
      : null,
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

  for (const track of Array.from(root.getElementsByTagNameNS('*', 'trk'))) {
    routeName ??= directChildText(track, 'name');

    for (const trackSegment of Array.from(
      track.getElementsByTagNameNS('*', 'trkseg'),
    )) {
      const segment = extractSegment(trackSegment, 'trkpt');

      if (segment) {
        segments.push(segment);
      }
    }
  }

  for (const route of Array.from(root.getElementsByTagNameNS('*', 'rte'))) {
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

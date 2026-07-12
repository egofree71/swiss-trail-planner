/**
 * Business context: reads external GPX tracks and routes so hikers can display
 * a reference itinerary without turning it into editable route history. The
 * parser intentionally accepts common GPX track and route structures while
 * keeping file handling local to the browser.
 */
import type { Coordinate } from 'ol/coordinate.js';

/** Maximum accepted GPX size in bytes; protects the browser from accidental huge files. */
export const MAX_GPX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** Parsed read-only itinerary extracted from one GPX document. */
export interface ImportedGpxRoute {
  /** Human-readable name from the GPX, or the source filename when absent. */
  name: string;
  /** Independent WGS 84 line segments; disconnected GPX segments stay disconnected. */
  segments: Coordinate[][];
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
  for (const child of Array.from(element.children)) {
    if (child.localName === localName) {
      const text = child.textContent?.trim();
      return text || null;
    }
  }

  return null;
}

/** Parses and validates one GPX latitude/longitude element. */
function parsePoint(element: Element): Coordinate | null {
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

  return [longitude, latitude];
}

/** Removes consecutive duplicate coordinates that can create zero-length features. */
function deduplicateCoordinates(coordinates: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];

  for (const coordinate of coordinates) {
    const previous = result[result.length - 1];

    if (
      !previous ||
      previous[0] !== coordinate[0] ||
      previous[1] !== coordinate[1]
    ) {
      result.push(coordinate);
    }
  }

  return result;
}

/** Extracts valid points from all descendant elements with the supplied GPX name. */
function extractPoints(parent: Element, pointLocalName: string): Coordinate[] {
  const coordinates = Array.from(
    parent.getElementsByTagNameNS('*', pointLocalName),
  )
    .map(parsePoint)
    .filter((coordinate): coordinate is Coordinate => coordinate !== null);

  return deduplicateCoordinates(coordinates);
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
 * across a deliberate GPX gap. Waypoints alone are not treated as an itinerary.
 *
 * @param xml - Complete GPX XML text.
 * @param filename - Source filename used when the GPX has no route name.
 * @returns A named read-only route with WGS 84 line segments.
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

  const segments: Coordinate[][] = [];
  let routeName: string | null = null;

  for (const track of Array.from(root.getElementsByTagNameNS('*', 'trk'))) {
    routeName ??= directChildText(track, 'name');

    for (const trackSegment of Array.from(
      track.getElementsByTagNameNS('*', 'trkseg'),
    )) {
      const coordinates = extractPoints(trackSegment, 'trkpt');

      if (coordinates.length >= 2) {
        segments.push(coordinates);
      }
    }
  }

  for (const route of Array.from(root.getElementsByTagNameNS('*', 'rte'))) {
    routeName ??= directChildText(route, 'name');
    const coordinates = extractPoints(route, 'rtept');

    if (coordinates.length >= 2) {
      segments.push(coordinates);
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

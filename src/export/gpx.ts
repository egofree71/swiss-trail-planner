/**
 * Business context: exports the route currently edited in Swiss Trail Planner
 * as a standalone GPX 1.1 track. Routed section vertices are preserved so
 * external hiking applications display the exact swissTLM3D geometry instead
 * of recalculating a route between only the user waypoints.
 */
import { toLonLat } from 'ol/proj.js';
import {
  collectRouteCoordinates,
  type RouteStep,
} from '../map/route';

/** Language-neutral filename prefix; the ISO date keeps downloads easy to identify. */
const GPX_FILENAME_PREFIX = 'swiss-trail-planner-route';
/** Decimal places for WGS 84 coordinates; seven digits provide sub-metre precision. */
const GPX_COORDINATE_PRECISION = 7;

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
 * Builds a GPX 1.1 track from the exact displayed route geometry.
 * @param steps - Applied route steps in display order.
 * @param generatedAt - Timestamp written to GPX metadata.
 * @param routeName - Localized track name written to metadata and track nodes.
 * @returns Complete UTF-8 XML document.
 * @throws {Error} If the route does not contain at least two coordinates.
 */
export function createRouteGpx(
  steps: RouteStep[],
  generatedAt: Date = new Date(),
  routeName = 'Swiss Trail Planner route',
): string {
  const coordinates = collectRouteCoordinates(steps);

  if (coordinates.length < 2) {
    throw new Error('A GPX route requires at least two coordinates.');
  }

  const trackPoints = coordinates
    .map((coordinate) => {
      const [longitude, latitude] = toLonLat(coordinate);
      return `      <trkpt lat="${latitude.toFixed(GPX_COORDINATE_PRECISION)}" lon="${longitude.toFixed(GPX_COORDINATE_PRECISION)}" />`;
    })
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
${trackPoints}
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
 * @throws {Error} If the route is too short to export.
 */
export function downloadRouteGpx(
  steps: RouteStep[],
  routeName = 'Swiss Trail Planner route',
): void {
  const generatedAt = new Date();
  const gpxDocument = createRouteGpx(steps, generatedAt, routeName);
  const blob = new Blob([gpxDocument], {
    type: 'application/gpx+xml;charset=utf-8',
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement('a');

  link.href = objectUrl;
  link.download = `${GPX_FILENAME_PREFIX}-${generatedAt.toISOString().slice(0, 10)}.gpx`;
  link.style.display = 'none';
  window.document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

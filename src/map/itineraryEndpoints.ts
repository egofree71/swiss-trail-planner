/**
 * Business context: renders compact start and finish markers shared by editable
 * routes and imported GPX itineraries. The markers communicate direction
 * without becoming a second source of route geometry or interaction state.
 */
import type { Coordinate } from 'ol/coordinate.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import {
  Circle as CircleStyle,
  Fill,
  Icon,
  Stroke,
  Style,
  Text,
} from 'ol/style.js';

/** Semantic role stored on endpoint features for route-specific interaction wiring. */
export const ITINERARY_ENDPOINT_ROLE_PROPERTY = 'itineraryEndpointRole';

/** Start, finish, or combined loop marker role. */
export type ItineraryEndpointRole = 'start' | 'finish' | 'loop';

/** Endpoints closer than this are visually treated as one closed itinerary. */
const LOOP_ENDPOINT_TOLERANCE_METRES = 5;

/** Accessible, high-contrast colours that stay readable over every map background. */
const START_MARKER_COLOR = '#16794b';
const FINISH_MARKER_COLOR = '#d52b1e';

/** Creates one compact circular marker with a white casing and centred label. */
function createEndpointStyle(label: string, color: string): Style {
  return new Style({
    image: new CircleStyle({
      radius: 10,
      fill: new Fill({ color }),
      stroke: new Stroke({
        color: 'rgba(255, 255, 255, 0.98)',
        width: 3,
      }),
    }),
    text: new Text({
      text: label,
      font: '700 11px system-ui, sans-serif',
      fill: new Fill({ color: '#ffffff' }),
    }),
    zIndex: 20,
  });
}

const START_MARKER_STYLE = createEndpointStyle('A', START_MARKER_COLOR);
const FINISH_MARKER_STYLE = createEndpointStyle('B', FINISH_MARKER_COLOR);

/**
 * The split loop badge makes exact start/finish overlap explicit without one
 * endpoint hiding the other. A hard divide stays more legible than a gradient.
 */
const LOOP_MARKER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
    <defs>
      <clipPath id="loop-marker-circle">
        <circle cx="15" cy="15" r="12"/>
      </clipPath>
    </defs>
    <g clip-path="url(#loop-marker-circle)">
      <rect x="3" y="3" width="12" height="24" fill="${START_MARKER_COLOR}"/>
      <rect x="15" y="3" width="12" height="24" fill="${FINISH_MARKER_COLOR}"/>
    </g>
    <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,0.98)" stroke-width="3"/>
    <text x="10.1" y="18.7" fill="white" font-family="system-ui,sans-serif" font-size="10" font-weight="700" text-anchor="middle">A</text>
    <text x="19.9" y="18.7" fill="white" font-family="system-ui,sans-serif" font-size="10" font-weight="700" text-anchor="middle">B</text>
  </svg>
`;

const LOOP_MARKER_STYLE = new Style({
  image: new Icon({
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOOP_MARKER_SVG)}`,
    width: 30,
    height: 30,
  }),
  zIndex: 20,
});

/** Returns whether two LV95 coordinates are close enough to represent one endpoint. */
function endpointsAreCoLocated(
  start: Coordinate,
  finish: Coordinate,
): boolean {
  const deltaX = finish[0] - start[0];
  const deltaY = finish[1] - start[1];
  return (
    deltaX * deltaX + deltaY * deltaY <=
    LOOP_ENDPOINT_TOLERANCE_METRES * LOOP_ENDPOINT_TOLERANCE_METRES
  );
}

/** Creates one endpoint marker feature with its semantic role. */
function createEndpointFeature(
  coordinate: Coordinate,
  role: ItineraryEndpointRole,
): Feature<Point> {
  const feature = new Feature<Point>({
    geometry: new Point([...coordinate]),
  });

  feature.set(ITINERARY_ENDPOINT_ROLE_PROPERTY, role);
  feature.setStyle(
    role === 'start'
      ? START_MARKER_STYLE
      : role === 'finish'
        ? FINISH_MARKER_STYLE
        : LOOP_MARKER_STYLE,
  );
  return feature;
}

/**
 * Creates start/finish markers for one displayed itinerary.
 *
 * A route with one known point receives only `A`. A closed route receives one
 * split `A/B` marker so neither endpoint is hidden by exact overlap.
 * Imported GPX loops are recognized with a small LV95 tolerance because
 * independently recorded start and finish coordinates are rarely bit-identical.
 */
export function createItineraryEndpointFeatures(
  start: Coordinate | null,
  finish: Coordinate | null,
  forceLoop = false,
): Feature<Point>[] {
  if (!start) {
    return [];
  }

  if (
    finish &&
    (forceLoop || endpointsAreCoLocated(start, finish))
  ) {
    return [createEndpointFeature(start, 'loop')];
  }

  const features = [createEndpointFeature(start, 'start')];

  if (finish) {
    features.push(createEndpointFeature(finish, 'finish'));
  }

  return features;
}

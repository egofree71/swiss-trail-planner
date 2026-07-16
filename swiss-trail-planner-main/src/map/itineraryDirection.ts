/**
 * Business context: adds sparse direction arrowheads to displayed itineraries
 * without turning them into permanent map clutter. Placement is derived from
 * screen resolution, stays away from visible route controls, and remains purely
 * presentational so route geometry and interaction are unchanged.
 */
import type { Coordinate } from 'ol/coordinate.js';
import type { FeatureLike } from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Icon, Style } from 'ol/style.js';

/** Approximate screen separation that keeps direction readable without visual noise. */
const DIRECTION_ARROW_SPACING_PX = 150;
/** Route must occupy this many screen pixels before an arrow adds useful information. */
const MINIMUM_VISIBLE_ROUTE_LENGTH_PX = 105;
/**
 * Direction is deliberately hidden above the detailed planning scale. At broad
 * scales, small bends collapse visually and a local tangent can suggest a
 * direction that the displayed route no longer makes apparent.
 */
const MAX_DIRECTION_ARROW_RESOLUTION = 20;
/** Keeps arrows clear of route endpoints and disconnected GPX segment ends. */
const LINE_END_MARGIN_PX = 38;
/** Keeps arrows from covering editable waypoints and A/B endpoint badges. */
const AVOID_COORDINATE_MARGIN_PX = 30;
/** Defensive cap for unusually long routes or very wide displays. */
const MAX_DIRECTION_ARROWS_PER_LINE = 16;
/**
 * Minimum centre-to-centre separation between direction symbols. This keeps
 * opposite arrows on an out-and-back section from touching or forming one
 * ambiguous combined shape.
 */
const DIRECTION_ARROW_COLLISION_DISTANCE_PX = 30;
/**
 * Screen-space phase shift tried when a candidate collides with an earlier
 * symbol. Moving along the route preserves the true direction while
 * desynchronizing repeated passes over the same geometry.
 */
const DIRECTION_ARROW_PHASE_SHIFT_PX = 42;
/** Number of alternating forward/backward phase shifts attempted per symbol. */
const DIRECTION_ARROW_PHASE_SHIFT_ATTEMPTS = 2;
/**
 * Hollow arrowhead dimensions in CSS pixels. The symbol is deliberately
 * larger than the first compact version, but remains much smaller than the
 * earlier full arrows that overwhelmed the route at broad scales.
 */
const DIRECTION_ARROW_WIDTH_PX = 24;
const DIRECTION_ARROW_HEIGHT_PX = 16;
/**
 * Direction is measured across this many pixels on either side of the marker,
 * rather than from one tiny geometry edge that may be invisible at the current
 * scale.
 */
const DIRECTION_TANGENT_HALF_WINDOW_PX = 12;
/** Tight folds whose smoothed chord is still tiny are skipped instead of guessing. */
const MINIMUM_TANGENT_CHORD_PX = 7;
/** Resolution changes below this relative threshold reuse the prior render cache. */
const RESOLUTION_CACHE_EPSILON = 1e-9;

export interface DirectionalLineStyleOptions {
  /** Existing casing and centre-line styles returned before arrow styles. */
  lineStyles: Style[];
  /** Ordered coordinates in displayed travel direction. */
  coordinates: Coordinate[];
  /** Route colour used for the arrowhead outline. */
  color: string;
  /** Visible points that arrows must not cover. */
  avoidCoordinates?: Coordinate[];
}

interface DirectionSample {
  coordinate: Coordinate;
  rotation: number;
}

interface CoordinateSample {
  coordinate: Coordinate;
  localRotation: number;
}

/** Returns planar LV95 distance between two route coordinates. */
function coordinateDistance(first: Coordinate, second: Coordinate): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

/**
 * Creates a right-facing hollow triangular arrowhead centred on the route.
 * A white interior interrupts the coloured line just enough to remain legible,
 * while the route-coloured outline keeps the symbol visually attached to it.
 */
function createArrowDataUrl(color: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${DIRECTION_ARROW_WIDTH_PX}" height="${DIRECTION_ARROW_HEIGHT_PX}" viewBox="0 0 24 16">
      <path d="M3 1.8 L21 8 L3 14.2 Z"
        fill="rgba(255,255,255,0.98)" stroke="${color}" stroke-width="2.3"
        stroke-linejoin="round"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Samples one coordinate from cumulative distance along a line. */
function sampleCoordinateAtDistance(
  coordinates: Coordinate[],
  distance: number,
): CoordinateSample | null {
  let traversedDistance = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const segmentLength = coordinateDistance(start, end);

    if (segmentLength <= 0) {
      continue;
    }

    if (traversedDistance + segmentLength >= distance) {
      const ratio = Math.max(
        0,
        Math.min(1, (distance - traversedDistance) / segmentLength),
      );

      return {
        coordinate: [
          start[0] + (end[0] - start[0]) * ratio,
          start[1] + (end[1] - start[1]) * ratio,
        ],
        localRotation: -Math.atan2(end[1] - start[1], end[0] - start[0]),
      };
    }

    traversedDistance += segmentLength;
  }

  return null;
}

/**
 * Samples a marker coordinate and a scale-aware smoothed tangent. Using a
 * visible chord avoids orienting an arrow from a tiny bend hidden at broad
 * zoom levels. A tight fold with no meaningful chord is omitted.
 */
function sampleDirectionAtDistance(
  coordinates: Coordinate[],
  distance: number,
  totalLength: number,
  resolution: number,
): DirectionSample | null {
  const centre = sampleCoordinateAtDistance(coordinates, distance);

  if (!centre) {
    return null;
  }

  const halfWindow = DIRECTION_TANGENT_HALF_WINDOW_PX * resolution;
  const before = sampleCoordinateAtDistance(
    coordinates,
    Math.max(0, distance - halfWindow),
  );
  const after = sampleCoordinateAtDistance(
    coordinates,
    Math.min(totalLength, distance + halfWindow),
  );

  if (!before || !after) {
    return {
      coordinate: centre.coordinate,
      rotation: centre.localRotation,
    };
  }

  const chordLength = coordinateDistance(before.coordinate, after.coordinate);

  if (chordLength / resolution < MINIMUM_TANGENT_CHORD_PX) {
    return null;
  }

  return {
    coordinate: centre.coordinate,
    rotation: -Math.atan2(
      after.coordinate[1] - before.coordinate[1],
      after.coordinate[0] - before.coordinate[0],
    ),
  };
}

/** Returns whether one candidate would visually collide with a protected point. */
function isNearAvoidCoordinate(
  coordinate: Coordinate,
  avoidCoordinates: Coordinate[],
  minimumDistance: number,
): boolean {
  const minimumDistanceSquared = minimumDistance * minimumDistance;

  return avoidCoordinates.some((avoidCoordinate) => {
    const deltaX = coordinate[0] - avoidCoordinate[0];
    const deltaY = coordinate[1] - avoidCoordinate[1];
    return deltaX * deltaX + deltaY * deltaY < minimumDistanceSquared;
  });
}

/** Returns whether a candidate direction symbol overlaps one already retained. */
function collidesWithDirectionSample(
  candidate: DirectionSample,
  samples: DirectionSample[],
  minimumDistance: number,
): boolean {
  const minimumDistanceSquared = minimumDistance * minimumDistance;

  return samples.some((sample) => {
    const deltaX = candidate.coordinate[0] - sample.coordinate[0];
    const deltaY = candidate.coordinate[1] - sample.coordinate[1];
    return deltaX * deltaX + deltaY * deltaY < minimumDistanceSquared;
  });
}

/**
 * Returns the base distance followed by alternating phase-shifted distances.
 * Repeated passes usually collide at the same screen ratio; trying later and
 * earlier positions keeps both directions readable without moving the route.
 */
function createCandidateDistances(
  baseDistance: number,
  minimumDistance: number,
  maximumDistance: number,
  resolution: number,
): number[] {
  const distances = [baseDistance];
  const phaseShift = DIRECTION_ARROW_PHASE_SHIFT_PX * resolution;

  for (
    let attempt = 1;
    attempt <= DIRECTION_ARROW_PHASE_SHIFT_ATTEMPTS;
    attempt += 1
  ) {
    const forward = baseDistance + phaseShift * attempt;
    const backward = baseDistance - phaseShift * attempt;

    if (forward <= maximumDistance) {
      distances.push(forward);
    }
    if (backward >= minimumDistance) {
      distances.push(backward);
    }
  }

  return distances;
}

/** Builds sparse arrow samples for one resolution without altering the line. */
function createDirectionSamples(
  coordinates: Coordinate[],
  avoidCoordinates: Coordinate[],
  resolution: number,
): DirectionSample[] {
  if (
    coordinates.length < 2 ||
    !Number.isFinite(resolution) ||
    resolution <= 0 ||
    resolution > MAX_DIRECTION_ARROW_RESOLUTION
  ) {
    return [];
  }

  let totalLength = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    totalLength += coordinateDistance(coordinates[index - 1], coordinates[index]);
  }

  const visibleLengthPx = totalLength / resolution;

  if (visibleLengthPx < MINIMUM_VISIBLE_ROUTE_LENGTH_PX) {
    return [];
  }

  const endMargin = LINE_END_MARGIN_PX * resolution;
  const usableLength = totalLength - endMargin * 2;

  if (usableLength <= 0) {
    return [];
  }

  const naturalArrowCount = Math.max(
    1,
    Math.floor(usableLength / (DIRECTION_ARROW_SPACING_PX * resolution)),
  );
  const arrowCount = Math.min(
    MAX_DIRECTION_ARROWS_PER_LINE,
    naturalArrowCount,
  );
  const evenSpacing = usableLength / (arrowCount + 1);
  const avoidMargin = AVOID_COORDINATE_MARGIN_PX * resolution;
  const collisionDistance = DIRECTION_ARROW_COLLISION_DISTANCE_PX * resolution;
  const samples: DirectionSample[] = [];
  const minimumSampleDistance = endMargin;
  const maximumSampleDistance = totalLength - endMargin;

  for (let index = 1; index <= arrowCount; index += 1) {
    const baseDistance = endMargin + evenSpacing * index;
    const candidateDistances = createCandidateDistances(
      baseDistance,
      minimumSampleDistance,
      maximumSampleDistance,
      resolution,
    );

    for (const candidateDistance of candidateDistances) {
      const sample = sampleDirectionAtDistance(
        coordinates,
        candidateDistance,
        totalLength,
        resolution,
      );

      if (
        !sample ||
        isNearAvoidCoordinate(sample.coordinate, avoidCoordinates, avoidMargin) ||
        collidesWithDirectionSample(sample, samples, collisionDistance)
      ) {
        continue;
      }

      samples.push(sample);
      break;
    }
  }

  return samples;
}

/**
 * Creates a resolution-aware line style with sparse direction arrows.
 *
 * The closure captures immutable geometry from one display rebuild. A small
 * per-resolution cache avoids recreating icons on every render frame while a
 * zoom change still recalculates screen-based spacing immediately.
 */
export function createDirectionalLineStyle({
  lineStyles,
  coordinates,
  color,
  avoidCoordinates = [],
}: DirectionalLineStyleOptions): (
  feature: FeatureLike,
  resolution: number,
) => Style[] {
  const arrowDataUrl = createArrowDataUrl(color);
  let cachedResolution = Number.NaN;
  let cachedStyles = lineStyles;

  return (_feature: FeatureLike, resolution: number): Style[] => {
    if (
      Number.isFinite(cachedResolution) &&
      Math.abs(cachedResolution - resolution) <=
        Math.max(1, Math.abs(resolution)) * RESOLUTION_CACHE_EPSILON
    ) {
      return cachedStyles;
    }

    const arrowStyles = createDirectionSamples(
      coordinates,
      avoidCoordinates,
      resolution,
    ).map(
      ({ coordinate, rotation }) =>
        new Style({
          geometry: new Point(coordinate),
          image: new Icon({
            src: arrowDataUrl,
            width: DIRECTION_ARROW_WIDTH_PX,
            height: DIRECTION_ARROW_HEIGHT_PX,
            rotation,
            rotateWithView: true,
          }),
          zIndex: 4,
        }),
    );

    cachedResolution = resolution;
    cachedStyles = [...lineStyles, ...arrowStyles];
    return cachedStyles;
  };
}

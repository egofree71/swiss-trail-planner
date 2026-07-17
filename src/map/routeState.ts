/**
 * Business context: defines the immutable editable-route domain independently
 * from React and OpenLayers rendering. The stored geometry is the source of
 * truth for undo, redo, reversal, GPX export, metrics, and route display, so
 * every transformation returns new coordinate arrays instead of sharing
 * mutable OpenLayers data.
 */
import type { Coordinate } from 'ol/coordinate.js';

/** Geometry source used when one route section was created. */
export type RouteMode =
  /** Direct line between waypoints. */
  | 'straight'
  /** Geometry calculated on the swissTLM3D routing network. */
  | 'network';

/** Immutable history entry representing one user waypoint and its incoming section. */
export interface RouteStep {
  /**
   * Effective waypoint coordinate; network mode replaces the original click
   * with the snapped coordinate.
   */
  waypoint: Coordinate;
  /** Geometry from the previous waypoint to this one, or `null` for the first point. */
  segment: Coordinate[] | null;
  /** Whether the incoming section is straight or network-routed. */
  mode: RouteMode;
}

/** Optional final section that connects the last waypoint back to the first. */
export interface RouteClosure {
  /** Exact displayed geometry from the last waypoint to the first waypoint. */
  segment: Coordinate[];
  /** Whether the closing section is straight or network-routed. */
  mode: RouteMode;
}

/** Complete immutable route geometry shared by editing, display, metrics, and export. */
export interface RouteState {
  /** Ordered user waypoints and their normal incoming sections. */
  steps: RouteStep[];
  /** Dedicated loop-closing section, without a duplicate waypoint marker. */
  closure: RouteClosure | null;
}

/** Immutable undo/redo state for route editing. */
export interface RouteHistory extends RouteState {
  /** Complete prior route states stored in chronological order. */
  undoStates: RouteState[];
  /** Complete undone route states stored in reverse restoration order. */
  redoStates: RouteState[];
}

/**
 * Squared distance in square LV95 metres below which consecutive display
 * vertices are treated as duplicates. Avoiding the square root keeps route
 * flattening cheap while the 10-centimetre threshold remains visually exact.
 */
const DUPLICATE_COORDINATE_DISTANCE_SQUARED = 0.01;

/**
 * Returns the immutable route portion of a history entry without its stacks.
 * @param history - Current route geometry and undo/redo stacks.
 * @returns Route state that preserves the same immutable geometry references.
 */
export function getRouteState(history: RouteHistory): RouteState {
  return {
    steps: history.steps,
    closure: history.closure,
  };
}

/**
 * Checks whether asynchronous work still owns the displayed immutable state.
 * Reference equality is intentional because every committed edit replaces the
 * affected route arrays instead of mutating them in place.
 * @param history - Current route history.
 * @param expectedState - Route state captured when the operation started.
 * @returns `true` only while neither steps nor loop closure has changed.
 */
export function routeStateMatches(
  history: RouteHistory,
  expectedState: RouteState,
): boolean {
  return (
    history.steps === expectedState.steps &&
    history.closure === expectedState.closure
  );
}

/**
 * Returns squared horizontal distance in LV95 square metres.
 * @param first - First coordinate.
 * @param second - Second coordinate.
 * @returns Squared XY distance without calculating a square root.
 */
export function coordinateDistanceSquared(
  first: Coordinate,
  second: Coordinate,
): number {
  const deltaX = first[0] - second[0];
  const deltaY = first[1] - second[1];
  return deltaX * deltaX + deltaY * deltaY;
}

/** Appends a coordinate unless it would create a sub-decimetre duplicate vertex. */
function appendCoordinate(
  coordinates: Coordinate[],
  coordinate: Coordinate,
): void {
  const previousCoordinate = coordinates[coordinates.length - 1];

  if (
    !previousCoordinate ||
    coordinateDistanceSquared(previousCoordinate, coordinate) >
      DUPLICATE_COORDINATE_DISTANCE_SQUARED
  ) {
    coordinates.push([...coordinate]);
  }
}

/**
 * Flattens incoming step geometries into one continuous display line.
 * @param steps - Ordered immutable route steps.
 * @param closure - Optional final section back to the first waypoint.
 * @returns Deduplicated route coordinates in display order.
 */
export function collectRouteCoordinates(
  steps: RouteStep[],
  closure: RouteClosure | null = null,
): Coordinate[] {
  const coordinates: Coordinate[] = [];

  for (const step of steps) {
    if (step.segment && step.segment.length >= 2) {
      for (const coordinate of step.segment) {
        appendCoordinate(coordinates, coordinate);
      }
    } else {
      appendCoordinate(coordinates, step.waypoint);
    }
  }

  if (closure?.segment && closure.segment.length >= 2) {
    for (const coordinate of closure.segment) {
      appendCoordinate(coordinates, coordinate);
    }
  }

  return coordinates;
}

/**
 * Reverses waypoint order and every stored incoming section without routing again.
 *
 * Each original section belongs to its destination step. After reversal, that
 * same section belongs to the former start waypoint, so both the geometry and
 * owning step must be rebuilt in the opposite direction.
 *
 * @param steps - Applied route steps in their current display order.
 * @returns A new immutable step array representing the same geometry backwards.
 */
export function reverseRouteSteps(steps: RouteStep[]): RouteStep[] {
  if (steps.length === 0) {
    return [];
  }

  const lastStep = steps[steps.length - 1];
  const reversedSteps: RouteStep[] = [
    {
      waypoint: [...lastStep.waypoint],
      segment: null,
      mode: lastStep.mode,
    },
  ];

  for (let index = steps.length - 1; index > 0; index -= 1) {
    const sourceStep = steps[index];
    const destinationStep = steps[index - 1];
    const reversedSegment = sourceStep.segment
      ? sourceStep.segment
          .slice()
          .reverse()
          .map((coordinate): Coordinate => [...coordinate])
      : [[...sourceStep.waypoint], [...destinationStep.waypoint]];

    reversedSteps.push({
      waypoint: [...destinationStep.waypoint],
      segment: reversedSegment,
      mode: sourceStep.mode,
    });
  }

  return reversedSteps;
}

/** Reverses one coordinate sequence without sharing mutable point arrays. */
function reverseSegment(segment: Coordinate[]): Coordinate[] {
  return segment
    .slice()
    .reverse()
    .map((coordinate): Coordinate => [...coordinate]);
}

/**
 * Reverses a closed route while preserving its physical start waypoint.
 *
 * A loop has no inherent geometric endpoint, but the user's first waypoint is
 * still meaningful as the start shown by the combined A/B marker. Reversal
 * therefore rotates section ownership around that fixed waypoint instead of
 * making the former last waypoint the new start.
 */
function reverseClosedRouteState(state: RouteState): RouteState {
  const { steps, closure } = state;

  if (!closure || steps.length < 2) {
    return state;
  }

  const reversedSteps: RouteStep[] = [
    {
      ...steps[0],
      waypoint: [...steps[0].waypoint],
      segment: null,
    },
    {
      waypoint: [...steps[steps.length - 1].waypoint],
      segment: reverseSegment(closure.segment),
      mode: closure.mode,
    },
  ];

  for (let index = steps.length - 1; index > 1; index -= 1) {
    const sourceStep = steps[index];
    const destinationStep = steps[index - 1];
    const reversedSegment = sourceStep.segment
      ? reverseSegment(sourceStep.segment)
      : [[...sourceStep.waypoint], [...destinationStep.waypoint]];

    reversedSteps.push({
      waypoint: [...destinationStep.waypoint],
      segment: reversedSegment,
      mode: sourceStep.mode,
    });
  }

  const firstNormalSection = steps[1];
  const reversedClosure: RouteClosure = {
    segment: firstNormalSection.segment
      ? reverseSegment(firstNormalSection.segment)
      : [[...firstNormalSection.waypoint], [...steps[0].waypoint]],
    mode: firstNormalSection.mode,
  };

  return {
    steps: reversedSteps,
    closure: reversedClosure,
  };
}

/**
 * Reverses an open or closed route without recalculating any geometry.
 * @param state - Current immutable route geometry.
 * @returns A new state with the same path traversed in the opposite direction.
 */
export function reverseRouteState(state: RouteState): RouteState {
  if (state.closure) {
    return reverseClosedRouteState(state);
  }

  return {
    steps: reverseRouteSteps(state.steps),
    closure: null,
  };
}

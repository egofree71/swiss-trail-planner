/**
 * Business context: protects the immutable route geometry used by undo, redo,
 * rendering, metrics, reversal, and GPX export. These tests focus on exact
 * section ownership because a subtle mutation or reversal error can corrupt
 * several user-visible workflows at once.
 */
import { describe, expect, it } from 'vitest';
import {
  collectRouteCoordinates,
  reverseRouteState,
  reverseRouteSteps,
  routeStateMatches,
  type RouteState,
  type RouteStep,
} from './routeState';

function createOpenRouteSteps(): RouteStep[] {
  return [
    {
      waypoint: [0, 0],
      segment: null,
      mode: 'straight',
    },
    {
      waypoint: [10, 0],
      segment: [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
      mode: 'network',
    },
    {
      waypoint: [10, 10],
      segment: [
        [10, 0],
        [10, 10],
      ],
      mode: 'straight',
    },
  ];
}

describe('routeState', () => {
  it('flattens stored sections without duplicate junction vertices', () => {
    const steps = createOpenRouteSteps();

    expect(collectRouteCoordinates(steps)).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it('removes only sub-decimetre consecutive duplicates', () => {
    const steps: RouteStep[] = [
      { waypoint: [0, 0], segment: null, mode: 'straight' },
      {
        waypoint: [1, 0],
        segment: [
          [0, 0],
          [0.05, 0],
          [0.11, 0],
          [1, 0],
        ],
        mode: 'straight',
      },
    ];

    expect(collectRouteCoordinates(steps)).toEqual([
      [0, 0],
      [0.11, 0],
      [1, 0],
    ]);
  });

  it('reverses an open route while transferring each incoming section', () => {
    const steps = createOpenRouteSteps();
    const originalSnapshot = structuredClone(steps);

    expect(reverseRouteSteps(steps)).toEqual([
      {
        waypoint: [10, 10],
        segment: null,
        mode: 'straight',
      },
      {
        waypoint: [10, 0],
        segment: [
          [10, 10],
          [10, 0],
        ],
        mode: 'straight',
      },
      {
        waypoint: [0, 0],
        segment: [
          [10, 0],
          [5, 0],
          [0, 0],
        ],
        mode: 'network',
      },
    ]);
    expect(steps).toEqual(originalSnapshot);
  });

  it('reverses a closed route while preserving its physical start', () => {
    const state: RouteState = {
      steps: createOpenRouteSteps(),
      closure: {
        segment: [
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        mode: 'network',
      },
    };

    const reversed = reverseRouteState(state);

    expect(reversed.steps.map((step) => step.waypoint)).toEqual([
      [0, 0],
      [10, 10],
      [10, 0],
    ]);
    expect(collectRouteCoordinates(reversed.steps, reversed.closure)).toEqual([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [5, 0],
      [0, 0],
    ]);
    expect(reverseRouteState(reversed)).toEqual(state);
  });

  it('matches asynchronous work only while immutable geometry references remain current', () => {
    const state: RouteState = {
      steps: createOpenRouteSteps(),
      closure: null,
    };
    const history = {
      ...state,
      undoStates: [],
      redoStates: [],
    };

    expect(routeStateMatches(history, state)).toBe(true);
    expect(
      routeStateMatches(
        {
          ...history,
          steps: [...history.steps],
        },
        state,
      ),
    ).toBe(false);
  });
});

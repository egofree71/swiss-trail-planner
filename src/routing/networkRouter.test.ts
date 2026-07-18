/**
 * Business context: protects optional benchmark timing diagnostics without
 * changing normal swissTLM3D routing results. The application does not request
 * these timings, while the local benchmark relies on every phase being present.
 */
import { describe, expect, it } from 'vitest';
import {
  RoutingNetwork,
  type RoutingNetworkPhaseTimings,
} from './networkRouter';
import type { SwissTlmNetworkData } from './swissTlmApi';

/** Creates a small connected path whose endpoints require graph traversal. */
function createTestNetwork(): RoutingNetwork {
  const data: SwissTlmNetworkData = {
    roads: [
      {
        id: 'test-road',
        lines: [
          [
            [0, 0],
            [100, 0],
            [200, 0],
          ],
        ],
        attributes: { objectType: 16 },
      },
    ],
    hikingTrails: [],
  };

  return RoutingNetwork.fromSwissTlm([-100, -100, 300, 100], data);
}

/** Returns a fresh accumulator matching the benchmark contract. */
function createTimings(): RoutingNetworkPhaseTimings {
  return {
    startSnapDurationMs: 0,
    endSnapDurationMs: 0,
    aStarDurationMs: 0,
    routeReconstructionDurationMs: 0,
  };
}

describe('RoutingNetwork benchmark diagnostics', () => {

  it('returns a structured-clone-safe plain-data route result', () => {
    const route = createTestNetwork().route([10, 2], [190, -2]);

    expect(route).not.toBeNull();
    expect(structuredClone(route)).toEqual(route);
  });

  it('returns the same route while filling non-negative phase timings', () => {
    const network = createTestNetwork();
    const normalRoute = network.route([10, 2], [190, -2]);
    const timings = createTimings();
    const diagnosedRoute = network.route([10, 2], [190, -2], timings);

    expect(diagnosedRoute).toEqual(normalRoute);
    expect(diagnosedRoute?.coordinates.length).toBeGreaterThanOrEqual(3);
    expect(Object.values(timings).every((duration) => duration >= 0)).toBe(
      true,
    );
  });
});

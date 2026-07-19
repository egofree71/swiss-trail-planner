/**
 * Business context: protects the plain-data route contract returned across the
 * dedicated Worker boundary without contacting live GeoAdmin services.
 */
import { describe, expect, it } from 'vitest';
import { RoutingNetwork } from './networkRouter';
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

describe('RoutingNetwork route result', () => {
  it('returns a structured-clone-safe plain-data route result', () => {
    const route = createTestNetwork().route([10, 2], [190, -2]);

    expect(route).not.toBeNull();
    expect(structuredClone(route)).toEqual(route);
  });
});

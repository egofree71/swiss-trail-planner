/**
 * Business context: protects the worker-owned routing engine independently
 * from the Worker transport. The suite verifies bounded corridor retries,
 * straight-fallback signalling, cell-request reuse, and the derived-graph LRU
 * without live GeoAdmin traffic or expensive graph construction.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const moduleMocks = vi.hoisted(() => ({
  fetchSwissTlmNetworkData: vi.fn(),
  fromSwissTlm: vi.fn(),
}));

vi.mock('./swissTlmApi', () => ({
  fetchSwissTlmNetworkData: moduleMocks.fetchSwissTlmNetworkData,
}));

vi.mock('./networkRouter', () => {
  class NoWalkableNetworkError extends Error {
    constructor(message = 'No walkable network is available.') {
      super(message);
      this.name = 'NoWalkableNetworkError';
    }
  }

  class RoutingNetwork {
    static fromSwissTlm(...args: unknown[]): unknown {
      return moduleMocks.fromSwissTlm(...args);
    }
  }

  return { NoWalkableNetworkError, RoutingNetwork };
});

import type { Coordinate } from 'ol/coordinate.js';
import { DynamicRoutingNetworkEngine } from './dynamicRoutingEngine';
import { RoutingAreaTooLargeError } from './dynamicRoutingProtocol';
import { createCorridorCellKeys } from './routingGrid';
import type { RoutedNetworkPath } from './networkRouter';
import type { SwissTlmNetworkData } from './swissTlmApi';

const EMPTY_NETWORK_DATA: SwissTlmNetworkData = {
  roads: [],
  hikingTrails: [],
};

const DEFAULT_PATH: RoutedNetworkPath = {
  coordinates: [
    [1_200, 1_200],
    [1_300, 1_200],
  ],
  snapDistanceStart: 0,
  snapDistanceEnd: 0,
};

/** Minimal graph double exposing only the methods used by the engine. */
function createNetwork(
  routeResult: RoutedNetworkPath | null = DEFAULT_PATH,
): {
  snap: ReturnType<typeof vi.fn>;
  route: ReturnType<typeof vi.fn>;
} {
  return {
    snap: vi.fn((coordinate: Coordinate) => coordinate),
    route: vi.fn(() => routeResult),
  };
}

/** Returns a coordinate safely centred inside a chosen grid column. */
function coordinateInColumn(column: number): Coordinate {
  return [column * 2_400 + 1_200, 1_200];
}

describe('DynamicRoutingNetworkEngine', () => {
  beforeEach(() => {
    moduleMocks.fetchSwissTlmNetworkData.mockReset();
    moduleMocks.fetchSwissTlmNetworkData.mockResolvedValue(EMPTY_NETWORK_DATA);
    moduleMocks.fromSwissTlm.mockReset();
    moduleMocks.fromSwissTlm.mockImplementation(() => createNetwork());
  });

  it('retries with the wider corridor and reuses cells loaded by the first attempt', async () => {
    moduleMocks.fromSwissTlm
      .mockImplementationOnce(() => createNetwork(null))
      .mockImplementationOnce(() => createNetwork(DEFAULT_PATH));
    const engine = new DynamicRoutingNetworkEngine();
    const start: Coordinate = [1_200, 1_200];
    const end: Coordinate = [3_600, 1_200];

    const result = await engine.route(
      start,
      end,
      new AbortController().signal,
    );

    expect(result).toEqual(DEFAULT_PATH);
    expect(moduleMocks.fromSwissTlm).toHaveBeenCalledTimes(2);
    expect(moduleMocks.fetchSwissTlmNetworkData).toHaveBeenCalledTimes(
      createCorridorCellKeys(start, end, 2).size,
    );
  });

  it('returns null after both corridor widths fail to find a connected path', async () => {
    moduleMocks.fromSwissTlm.mockImplementation(() => createNetwork(null));
    const engine = new DynamicRoutingNetworkEngine();

    const result = await engine.route(
      [1_200, 1_200],
      [3_600, 1_200],
      new AbortController().signal,
    );

    expect(result).toBeNull();
    expect(moduleMocks.fromSwissTlm).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight cell request between concurrent snap operations', async () => {
    let resolveFetch: ((data: SwissTlmNetworkData) => void) | undefined;
    moduleMocks.fetchSwissTlmNetworkData.mockImplementation(
      () =>
        new Promise<SwissTlmNetworkData>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const engine = new DynamicRoutingNetworkEngine();
    const coordinate: Coordinate = [1_200, 1_200];

    const first = engine.snap(coordinate, new AbortController().signal);
    const second = engine.snap(coordinate, new AbortController().signal);

    await vi.waitFor(() => {
      expect(moduleMocks.fetchSwissTlmNetworkData).toHaveBeenCalledTimes(1);
    });

    resolveFetch?.(EMPTY_NETWORK_DATA);

    await expect(Promise.all([first, second])).resolves.toEqual([
      coordinate,
      coordinate,
    ]);
  });

  it('cleans an aborted pending cell so the same area can be retried', async () => {
    moduleMocks.fetchSwissTlmNetworkData.mockImplementationOnce(
      (_extent: unknown, signal: AbortSignal) =>
        new Promise<SwissTlmNetworkData>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const engine = new DynamicRoutingNetworkEngine();
    const coordinate: Coordinate = [1_200, 1_200];
    const controller = new AbortController();
    const abortedSnap = engine.snap(coordinate, controller.signal);

    await vi.waitFor(() => {
      expect(moduleMocks.fetchSwissTlmNetworkData).toHaveBeenCalledTimes(1);
    });

    controller.abort();

    await expect(abortedSnap).rejects.toMatchObject({ name: 'AbortError' });
    moduleMocks.fetchSwissTlmNetworkData.mockResolvedValueOnce(
      EMPTY_NETWORK_DATA,
    );

    await expect(
      engine.snap(coordinate, new AbortController().signal),
    ).resolves.toEqual(coordinate);
    expect(moduleMocks.fetchSwissTlmNetworkData).toHaveBeenCalledTimes(2);
  });

  it('promotes cache hits and evicts the least-recently used graph', async () => {
    const engine = new DynamicRoutingNetworkEngine();
    const signal = new AbortController().signal;
    const coordinates = Array.from({ length: 9 }, (_, index) =>
      coordinateInColumn(index * 10),
    );

    for (const coordinate of coordinates.slice(0, 8)) {
      await engine.route(coordinate, coordinate, signal);
    }

    expect(moduleMocks.fromSwissTlm).toHaveBeenCalledTimes(8);

    // Reusing the oldest graph promotes it before the ninth graph is inserted.
    await engine.route(coordinates[0], coordinates[0], signal);
    await engine.route(coordinates[8], coordinates[8], signal);
    await engine.route(coordinates[0], coordinates[0], signal);

    expect(moduleMocks.fromSwissTlm).toHaveBeenCalledTimes(9);

    // The second-oldest untouched graph was evicted and must now be rebuilt.
    await engine.route(coordinates[1], coordinates[1], signal);
    expect(moduleMocks.fromSwissTlm).toHaveBeenCalledTimes(10);
  });

  it('rejects an oversized corridor before making provider requests', async () => {
    const engine = new DynamicRoutingNetworkEngine();

    await expect(
      engine.route(
        [0, 0],
        [240_000, 0],
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RoutingAreaTooLargeError);
    expect(moduleMocks.fetchSwissTlmNetworkData).not.toHaveBeenCalled();
  });

  it('propagates provider failures instead of treating them as missing coverage', async () => {
    moduleMocks.fetchSwissTlmNetworkData.mockRejectedValue(
      new Error('GeoAdmin unavailable'),
    );
    const engine = new DynamicRoutingNetworkEngine();

    await expect(
      engine.snap([1_200, 1_200], new AbortController().signal),
    ).rejects.toThrow('GeoAdmin unavailable');
  });
});

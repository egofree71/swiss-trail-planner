/**
 * Business context: protects the main-thread routing facade that now isolates
 * expensive swissTLM3D work in a Web Worker. These tests verify structured
 * responses, typed errors, cancellation, and disposal without making network
 * requests or constructing a real graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DynamicRoutingNetworkLoader,
  RoutingAreaTooLargeError,
} from './dynamicRoutingNetwork';
import type {
  RoutingWorkerRequest,
  RoutingWorkerResponse,
} from './dynamicRoutingProtocol';

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];

  readonly messages: RoutingWorkerRequest[] = [];
  terminated = false;

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: RoutingWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: RoutingWorkerResponse): void {
    this.dispatchEvent(new MessageEvent('message', { data: response }));
  }
}

function currentWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);

  if (!worker) {
    throw new Error('Expected the routing facade to create a worker.');
  }

  return worker;
}

describe('DynamicRoutingNetworkLoader worker facade', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns route geometry from the matching worker response', async () => {
    const loader = new DynamicRoutingNetworkLoader();
    const pending = loader.route(
      [2_500_000, 1_100_000],
      [2_500_100, 1_100_100],
      new AbortController().signal,
    );
    const worker = currentWorker();
    const request = worker.messages[0];

    expect(request.type).toBe('request');

    if (request.type !== 'request') {
      throw new Error('Expected a routing operation request.');
    }

    expect(request.operation).toBe('route');

    worker.respond({
      type: 'success',
      requestId: request.requestId,
      result: {
        coordinates: [
          [2_500_000, 1_100_000],
          [2_500_100, 1_100_100],
        ],
        snapDistanceStart: 1,
        snapDistanceEnd: 2,
      },
    });

    await expect(pending).resolves.toMatchObject({
      snapDistanceStart: 1,
      snapDistanceEnd: 2,
    });
    loader.dispose();
  });

  it('reconstructs the area-limit error used by the route UI', async () => {
    const loader = new DynamicRoutingNetworkLoader();
    const pending = loader.snap(
      [2_500_000, 1_100_000],
      new AbortController().signal,
    );
    const worker = currentWorker();
    const request = worker.messages[0];

    worker.respond({
      type: 'error',
      requestId: request.requestId,
      error: {
        name: 'RoutingAreaTooLargeError',
        message: 'too many cells',
      },
    });

    await expect(pending).rejects.toBeInstanceOf(RoutingAreaTooLargeError);
    loader.dispose();
  });

  it('rejects immediately and asks the worker to cancel an aborted request', async () => {
    const loader = new DynamicRoutingNetworkLoader();
    const controller = new AbortController();
    const pending = loader.snap([2_500_000, 1_100_000], controller.signal);
    const worker = currentWorker();
    const request = worker.messages[0];

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.messages).toContainEqual({
      type: 'cancel',
      requestId: request.requestId,
    });
    loader.dispose();
  });

  it('terminates the worker and rejects pending work on disposal', async () => {
    const loader = new DynamicRoutingNetworkLoader();
    const pending = loader.getCacheStats();
    const worker = currentWorker();

    loader.dispose();

    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

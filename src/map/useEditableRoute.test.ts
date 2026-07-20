/**
 * Lifecycle regression tests for the editable-route controller. They protect
 * the routing Worker notice subscription against React Strict Mode's deliberate
 * setup-cleanup-setup development cycle.
 */
import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditableRoute } from './useEditableRoute';

const loaderState = vi.hoisted(() => ({
  instances: [] as Array<{
    disposed: boolean;
    emit: (notice: 'hiking-enrichment-unavailable') => void;
  }>,
}));

vi.mock('../routing/dynamicRoutingNetwork', () => {
  class RoutingAreaTooLargeError extends Error {}

  class DynamicRoutingNetworkLoader {
    private readonly listeners = new Set<
      (notice: 'hiking-enrichment-unavailable') => void
    >();
    disposed = false;

    constructor() {
      loaderState.instances.push(this);
    }

    subscribeToNotices(
      listener: (notice: 'hiking-enrichment-unavailable') => void,
    ): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(notice: 'hiking-enrichment-unavailable'): void {
      for (const listener of this.listeners) {
        listener(notice);
      }
    }

    snap(): Promise<null> {
      return Promise.resolve(null);
    }

    route(): Promise<null> {
      return Promise.resolve(null);
    }

    dispose(): void {
      this.disposed = true;
      this.listeners.clear();
    }
  }

  return {
    DynamicRoutingNetworkLoader,
    RoutingAreaTooLargeError,
  };
});

vi.mock('./useRouteInteractions', () => ({
  useRouteInteractions: () => ({
    routeContextHint: null,
    isInteractionActive: false,
    isPointerInteractionActive: () => false,
  }),
}));

vi.mock('./route', () => ({
  updateRouteDisplay: vi.fn(),
}));

function Harness() {
  const controller = useEditableRoute({
    mapRuntimeRef: { current: null },
    mapTargetRef: { current: null },
    t: (key) =>
      key === 'route.hikingEnrichmentUnavailable'
        ? 'Roads-only routing warning'
        : key,
  });

  return createElement('div', null, controller.routeMessage);
}

describe('useEditableRoute routing notice lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    loaderState.instances.length = 0;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('subscribes the replacement Worker created by React Strict Mode', async () => {
    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(Harness)));
    });

    expect(loaderState.instances).toHaveLength(2);
    expect(loaderState.instances[0].disposed).toBe(true);
    expect(loaderState.instances[1].disposed).toBe(false);

    await act(async () => {
      loaderState.instances[1].emit('hiking-enrichment-unavailable');
    });

    expect(container.textContent).toBe('Roads-only routing warning');
  });
});


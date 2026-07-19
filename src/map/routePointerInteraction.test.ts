/**
 * Business context: protects the touch input split used while reshaping an
 * editable route. Deliberate drags that start on a waypoint or very close to a
 * stored section may edit the itinerary, while gestures starting elsewhere and
 * every multi-touch gesture remain available to normal map navigation.
 */
import type Map from 'ol/Map.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type { Pixel } from 'ol/pixel.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createRouteDisplay,
  getRouteWaypointIndex,
  updateRouteDisplay,
} from './routeDisplay';
import {
  createRouteDragInteraction,
  type RouteDragCallbacks,
} from './routePointerInteraction';
import type { RouteState } from './routeState';

const ROUTE_STATE: RouteState = {
  steps: [
    {
      waypoint: [100, 100],
      segment: null,
      mode: 'straight',
    },
    {
      waypoint: [200, 100],
      segment: [
        [100, 100],
        [200, 100],
      ],
      mode: 'straight',
    },
  ],
  closure: null,
};

type HitTarget = 'waypoint' | 'segment' | 'none';

interface InteractionHarness {
  interaction: ReturnType<typeof createRouteDragInteraction>;
  callbacks: {
    [Key in keyof RouteDragCallbacks]: ReturnType<typeof vi.fn>;
  };
  createEvent: (
    type: string,
    pixel: Pixel,
    pointerType?: string,
    pointerCount?: number,
  ) => MapBrowserEvent;
}

/** Creates a small OpenLayers interaction harness without rendering a map. */
function createHarness(hitTarget: HitTarget): InteractionHarness {
  const display = createRouteDisplay();
  updateRouteDisplay(display, ROUTE_STATE.steps, ROUTE_STATE.closure);
  const waypointFeature = display.source
    .getFeatures()
    .find((feature) => getRouteWaypointIndex(feature) === 0);

  expect(waypointFeature).toBeDefined();

  const target = document.createElement('div');
  const map = {
    forEachFeatureAtPixel: (
      _pixel: Pixel,
      callback: (feature: NonNullable<typeof waypointFeature>) => unknown,
    ) =>
      hitTarget === 'waypoint' ? callback(waypointFeature!) : undefined,
    getTargetElement: () => target,
    getCoordinateFromPixel: (pixel: Pixel) => [...pixel],
    getView: () => ({ getResolution: () => 1 }),
  } as unknown as Map;

  const callbacks = {
    canStart: vi.fn(() => true),
    getRouteState: vi.fn(() => ROUTE_STATE),
    onStart: vi.fn(),
    onDrag: vi.fn(),
    onCancel: vi.fn(),
    onHover: vi.fn(),
    onEnd: vi.fn(),
  } satisfies RouteDragCallbacks;

  const interaction = createRouteDragInteraction(display, callbacks);
  const createEvent = (
    type: string,
    pixel: Pixel,
    pointerType = 'touch',
    pointerCount = 1,
  ) => {
    const originalEvent = {
      pointerType,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent;
    const activePointers = Array.from(
      { length: pointerCount },
      (_, index) =>
        ({
          pointerId: index + 1,
          pointerType,
          clientX: pixel[0] + index * 20,
          clientY: pixel[1],
        }) as PointerEvent,
    );

    return {
      type,
      map,
      originalEvent,
      activePointers,
      pixel: [...pixel],
      coordinate: [...pixel],
    } as unknown as MapBrowserEvent;
  };

  return {
    interaction,
    callbacks: callbacks as InteractionHarness['callbacks'],
    createEvent,
  };
}

describe('route pointer interaction on touch screens', () => {
  it('leaves finger gestures away from the itinerary available to map navigation', () => {
    const { interaction, callbacks, createEvent } = createHarness('none');

    const shouldPropagate = interaction.handleEvent(
      createEvent('pointerdown', [150, 120]),
    );

    expect(shouldPropagate).toBe(true);
    expect(callbacks.onStart).not.toHaveBeenCalled();
  });

  it('does not turn a waypoint tap or normal finger tremor into an edit', () => {
    const { interaction, callbacks, createEvent } = createHarness('waypoint');

    expect(
      interaction.handleEvent(createEvent('pointerdown', [100, 100])),
    ).toBe(false);
    interaction.handleEvent(createEvent('pointerdrag', [105, 100]));
    interaction.handleEvent(createEvent('pointerup', [105, 100], 'touch', 0));

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onDrag).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it('moves an existing waypoint after deliberate one-finger movement', () => {
    const { interaction, callbacks, createEvent } = createHarness('waypoint');

    interaction.handleEvent(createEvent('pointerdown', [100, 100]));
    interaction.handleEvent(createEvent('pointerdrag', [112, 100]));
    interaction.handleEvent(createEvent('pointerup', [112, 100], 'touch', 0));

    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onStart).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'waypoint', waypointIndex: 0 }),
    );
    expect(callbacks.onDrag).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'waypoint', waypointIndex: 0 }),
      [112, 100],
    );
    expect(callbacks.onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'waypoint', waypointIndex: 0 }),
      [112, 100],
      true,
      [112, 100],
    );
  });

  it('does not turn a route-section tap or normal finger tremor into an edit', () => {
    const { interaction, callbacks, createEvent } = createHarness('segment');

    expect(
      interaction.handleEvent(createEvent('pointerdown', [150, 100])),
    ).toBe(false);
    interaction.handleEvent(createEvent('pointerdrag', [155, 100]));
    interaction.handleEvent(createEvent('pointerup', [155, 100], 'touch', 0));

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onDrag).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it('pulls a new waypoint from a nearby route section after deliberate movement', () => {
    const { interaction, callbacks, createEvent } = createHarness('segment');

    interaction.handleEvent(createEvent('pointerdown', [150, 100]));
    interaction.handleEvent(createEvent('pointerdrag', [150, 112]));
    interaction.handleEvent(createEvent('pointerup', [150, 112], 'touch', 0));

    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onStart).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'segment', stepIndex: 1 }),
    );
    expect(callbacks.onDrag).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'segment', stepIndex: 1 }),
      [150, 112],
    );
    expect(callbacks.onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'segment', stepIndex: 1 }),
      [150, 112],
      true,
      [150, 112],
    );
  });

  it('cancels a waypoint preview when a second finger starts pinch zoom', () => {
    const { interaction, callbacks, createEvent } = createHarness('waypoint');

    interaction.handleEvent(createEvent('pointerdown', [100, 100]));
    interaction.handleEvent(createEvent('pointerdrag', [112, 100]));
    interaction.handleEvent(
      createEvent('pointerdown', [112, 100], 'touch', 2),
    );
    interaction.handleEvent(
      createEvent('pointerdrag', [116, 100], 'touch', 2),
    );
    interaction.handleEvent(createEvent('pointerup', [116, 100], 'touch', 1));

    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it('cancels a route-section preview when a second finger starts pinch zoom', () => {
    const { interaction, callbacks, createEvent } = createHarness('segment');

    interaction.handleEvent(createEvent('pointerdown', [150, 100]));
    interaction.handleEvent(createEvent('pointerdrag', [150, 112]));
    interaction.handleEvent(
      createEvent('pointerdown', [150, 112], 'touch', 2),
    );
    interaction.handleEvent(
      createEvent('pointerdrag', [150, 116], 'touch', 2),
    );
    interaction.handleEvent(createEvent('pointerup', [150, 116], 'touch', 1));

    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it('does not commit when one finger is released from a multi-touch gesture', () => {
    const { interaction, callbacks, createEvent } = createHarness('waypoint');

    interaction.handleEvent(createEvent('pointerdown', [100, 100]));
    interaction.handleEvent(createEvent('pointerdrag', [112, 100]));
    interaction.handleEvent(
      createEvent('pointerdown', [112, 100], 'touch', 2),
    );
    interaction.handleEvent(createEvent('pointerup', [112, 100], 'touch', 1));

    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });
});

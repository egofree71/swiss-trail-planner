/**
 * Business context: protects the geometry preparation and pointer exploration
 * behind the compact elevation chart. Dense imported GPX profiles must reuse
 * encoded SVG paths, while touch dragging must keep publishing route position.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nContext';
import type { RouteElevationPoint } from '../metrics/routeMetrics';
import RouteElevationProfile, {
  buildChartPoints,
} from './RouteElevationProfile';

describe('buildChartPoints', () => {
  it('preserves real extrema while applying rounded display bounds', () => {
    const geometry = buildChartPoints([
      { distanceMeters: 0, elevationMeters: 503 },
      { distanceMeters: 500, elevationMeters: 517 },
      { distanceMeters: 1_000, elevationMeters: 509 },
    ]);

    expect(geometry.minimumElevation).toBe(503);
    expect(geometry.maximumElevation).toBe(517);
    expect(geometry.chartMinimumElevation).toBeLessThanOrEqual(503);
    expect(geometry.chartMaximumElevation).toBeGreaterThanOrEqual(517);
    expect(
      geometry.chartMaximumElevation - geometry.chartMinimumElevation,
    ).toBeGreaterThanOrEqual(40);
    expect(geometry.totalDistance).toBe(1_000);
    expect(geometry.linePoints.split(' ')).toHaveLength(3);
    expect(geometry.areaPath).toMatch(/^M .+ Z$/);
  });

  it('handles more samples than argument-spread extrema calculations safely support', () => {
    const sampleCount = 150_000;
    const points: RouteElevationPoint[] = Array.from(
      { length: sampleCount },
      (_, index) => ({
        distanceMeters: index * 20,
        elevationMeters: index === 73_421 ? -120 : 400 + (index % 600),
      }),
    );
    points[121_337] = {
      distanceMeters: 121_337 * 20,
      elevationMeters: 2_450,
    };

    const geometry = buildChartPoints(points);

    expect(geometry.minimumElevation).toBe(-120);
    expect(geometry.maximumElevation).toBe(2_450);
    expect(geometry.totalDistance).toBe((sampleCount - 1) * 20);
    expect(geometry.linePoints).not.toBe('');
    expect(geometry.areaPath.endsWith(' Z')).toBe(true);
  });
});

describe('RouteElevationProfile touch exploration', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.localStorage.setItem('via-helvetica-language', 'en');
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

  it('publishes route distance while one finger drags horizontally', async () => {
    const onHoverDistanceChange = vi.fn();

    await act(async () => {
      root?.render(
        createElement(
          I18nProvider,
          null,
          createElement(RouteElevationProfile, {
            id: 'profile',
            points: [
              { distanceMeters: 0, elevationMeters: 500 },
              { distanceMeters: 1_000, elevationMeters: 600 },
            ],
            onHoverDistanceChange,
          }),
        ),
      );
    });

    const chart = container.querySelector<SVGSVGElement>(
      '.route-elevation-profile-chart',
    );

    expect(chart).not.toBeNull();

    let capturedPointerId: number | null = null;
    Object.defineProperties(chart!, {
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          right: 720,
          bottom: 150,
          left: 0,
          width: 720,
          height: 150,
          toJSON: () => undefined,
        }),
      },
      setPointerCapture: {
        configurable: true,
        value: (pointerId: number) => {
          capturedPointerId = pointerId;
        },
      },
      hasPointerCapture: {
        configurable: true,
        value: (pointerId: number) => capturedPointerId === pointerId,
      },
      releasePointerCapture: {
        configurable: true,
        value: (pointerId: number) => {
          if (capturedPointerId === pointerId) {
            capturedPointerId = null;
          }
        },
      },
    });

    const dispatchTouchPointer = (type: string, clientX: number) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: 'touch' },
        isPrimary: { value: true },
        clientX: { value: clientX },
        clientY: { value: 75 },
      });
      chart?.dispatchEvent(event);
    };

    onHoverDistanceChange.mockClear();

    await act(async () => {
      dispatchTouchPointer('pointerdown', 64);
      dispatchTouchPointer('pointermove', 381);
    });

    expect(capturedPointerId).toBe(7);
    expect(onHoverDistanceChange).toHaveBeenCalledWith(0);
    expect(onHoverDistanceChange).toHaveBeenCalledWith(500);

    await act(async () => {
      dispatchTouchPointer('pointerup', 381);
    });

    expect(capturedPointerId).toBeNull();
    expect(onHoverDistanceChange).toHaveBeenLastCalledWith(null);
  });
});

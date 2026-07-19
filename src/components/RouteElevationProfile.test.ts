/**
 * Business context: protects the pure geometry preparation behind the compact
 * elevation chart. Hover renders must be able to reuse these encoded SVG paths,
 * including for unusually dense imported GPX profiles.
 */
import { describe, expect, it } from 'vitest';
import type { RouteElevationPoint } from '../metrics/routeMetrics';
import { buildChartPoints } from './RouteElevationProfile';

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

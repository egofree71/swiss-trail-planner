/**
 * Business context: protects responsive GPX framing so mobile viewports never
 * lose almost all usable map space to desktop-oriented fit padding.
 */
import { describe, expect, it } from 'vitest';
import { calculateImportedRouteFitPadding } from './useImportedRoute';

describe('calculateImportedRouteFitPadding', () => {
  it('keeps the intended margins on a sufficiently large viewport', () => {
    expect(calculateImportedRouteFitPadding([1_200, 800])).toEqual([
      80, 80, 180, 80,
    ]);
  });

  it('scales vertical margins while preserving a usable landscape fit area', () => {
    const padding = calculateImportedRouteFitPadding([667, 240]);

    expect(padding[0] + padding[2]).toBeLessThanOrEqual(80);
    expect(240 - padding[0] - padding[2]).toBeGreaterThanOrEqual(160);
    expect(padding[1]).toBe(80);
    expect(padding[3]).toBe(80);
  });

  it('scales both axes on a very small viewport', () => {
    const padding = calculateImportedRouteFitPadding([200, 200]);

    expect(200 - padding[1] - padding[3]).toBeGreaterThanOrEqual(160);
    expect(200 - padding[0] - padding[2]).toBeGreaterThanOrEqual(160);
  });
});

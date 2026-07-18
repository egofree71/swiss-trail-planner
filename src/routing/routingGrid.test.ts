/**
 * Business context: protects the bounded LV95 cell footprints used by the
 * routing worker. A regression here can silently over-fetch GeoAdmin data or
 * omit cells required for snapping and corridor routing.
 */
import { describe, expect, it } from 'vitest';
import {
  combinedExtent,
  createCorridorCellKeys,
  createLocalCellKeys,
  extentForCellKey,
} from './routingGrid';

/** Returns deterministic sorted keys for readable grid assertions. */
function sortedKeys(keys: Set<string>): string[] {
  return [...keys].sort();
}

describe('routingGrid', () => {
  it('keeps the first-waypoint footprint to one, two, or four intersecting cells', () => {
    expect(sortedKeys(createLocalCellKeys([1_200, 1_200]))).toEqual(['0:0']);
    expect(sortedKeys(createLocalCellKeys([2_300, 1_200]))).toEqual([
      '0:0',
      '1:0',
    ]);
    expect(sortedKeys(createLocalCellKeys([2_300, 2_300]))).toEqual([
      '0:0',
      '0:1',
      '1:0',
      '1:1',
    ]);
  });

  it('walks every cell crossed by a horizontal segment before expansion', () => {
    expect(
      sortedKeys(createCorridorCellKeys([1_200, 1_200], [6_000, 1_200], 0)),
    ).toEqual(['0:0', '1:0', '2:0']);
  });

  it('expands a three-cell corridor by one cell without filling a large bounding box', () => {
    const keys = createCorridorCellKeys([1_200, 1_200], [6_000, 1_200], 1);

    expect(keys.size).toBe(15);
    expect(keys).toContain('-1:-1');
    expect(keys).toContain('3:1');
    expect(keys).not.toContain('4:0');
  });

  it('handles negative cell indices and combines exact cell extents', () => {
    expect(extentForCellKey('-1:2')).toEqual([-2_400, 4_800, 0, 7_200]);
    expect(combinedExtent(new Set(['-1:0', '1:2']))).toEqual([
      -2_400,
      0,
      4_800,
      7_200,
    ]);
  });
});

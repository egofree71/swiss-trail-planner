/**
 * Business context: protects the first-waypoint loading footprint. Local
 * snapping should request only cells that can contain a network segment within
 * the configured snap distance, rather than a fixed 3 x 3 neighbourhood.
 */
import { describe, expect, it } from 'vitest';
import { createLocalCellKeys } from './dynamicRoutingNetwork';

/** Returns deterministic sorted keys for readable grid-footprint assertions. */
function localCellKeys(coordinate: [number, number]): string[] {
  return [...createLocalCellKeys(coordinate)].sort();
}

describe('createLocalCellKeys', () => {
  it('loads one cell when the snap box remains inside the containing cell', () => {
    expect(localCellKeys([1_200, 1_200])).toEqual(['0:0']);
  });

  it('loads two cells when the snap box crosses one cell edge', () => {
    expect(localCellKeys([2_300, 1_200])).toEqual(['0:0', '1:0']);
  });

  it('loads four cells when the snap box crosses a cell corner', () => {
    expect(localCellKeys([2_300, 2_300])).toEqual([
      '0:0',
      '0:1',
      '1:0',
      '1:1',
    ]);
  });

  it('includes both cells when the snap limit lands exactly on their boundary', () => {
    expect(localCellKeys([260, 1_200])).toEqual(['-1:0', '0:0']);
  });
});

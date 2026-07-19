/**
 * Business context: protects the WGS 84/LV95 exchange boundary used by GPX,
 * search, and browser geolocation. Batch conversion must preserve the exact
 * coordinate order and numerical result of the established single-point API.
 */
import { describe, expect, it } from 'vitest';
import {
  fromWgs84,
  fromWgs84Coordinates,
  toWgs84,
  toWgs84Coordinates,
} from './projection';

describe('projection coordinate batches', () => {
  it('matches single-point WGS 84 to LV95 conversion without mutating input', () => {
    const coordinates = [
      [6.1432, 46.2044],
      [7.4474, 46.9479],
      [8.5417, 47.3769],
    ];
    const original = coordinates.map((coordinate) => [...coordinate]);

    const projected = fromWgs84Coordinates(coordinates);

    expect(projected).toHaveLength(coordinates.length);
    expect(coordinates).toEqual(original);

    for (let index = 0; index < coordinates.length; index += 1) {
      const expected = fromWgs84(coordinates[index]);
      expect(projected[index][0]).toBeCloseTo(expected[0], 8);
      expect(projected[index][1]).toBeCloseTo(expected[1], 8);
    }
  });

  it('matches single-point LV95 to WGS 84 conversion and handles empty arrays', () => {
    const coordinates = [
      [2_500_000, 1_117_000],
      [2_600_000, 1_200_000],
      [2_683_000, 1_248_000],
    ];

    const geographic = toWgs84Coordinates(coordinates);

    for (let index = 0; index < coordinates.length; index += 1) {
      const expected = toWgs84(coordinates[index]);
      expect(geographic[index][0]).toBeCloseTo(expected[0], 8);
      expect(geographic[index][1]).toBeCloseTo(expected[1], 8);
    }

    expect(fromWgs84Coordinates([])).toEqual([]);
    expect(toWgs84Coordinates([])).toEqual([]);
  });
});

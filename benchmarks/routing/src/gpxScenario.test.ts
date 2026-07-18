/**
 * Business context: protects deterministic GPX waypoint sampling so benchmark
 * results remain comparable across code versions and devices.
 */
import { describe, expect, it } from 'vitest';
import { generateWaypointDistances } from './gpxScenario';

describe('generateWaypointDistances', () => {
  it('supports short fixed intervals for small-route benchmarks', () => {
    expect(
      generateWaypointDistances(550, {
        kind: 'regular',
        spacingMeters: 100,
      }),
    ).toEqual([0, 100, 200, 300, 400, 500, 550]);
  });

  it('keeps adaptive scenarios bounded while preserving both endpoints', () => {
    const distances = generateWaypointDistances(18_000, { kind: 'adaptive' });

    expect(distances[0]).toBe(0);
    expect(distances[distances.length - 1]).toBe(18_000);
    expect(distances).toHaveLength(25);
  });

  it('generates reproducible irregular spacing from a fixed seed', () => {
    const first = generateWaypointDistances(4_000, {
      kind: 'irregular',
      averageSpacingMeters: 500,
      seed: 42,
    });
    const second = generateWaypointDistances(4_000, {
      kind: 'irregular',
      averageSpacingMeters: 500,
      seed: 42,
    });
    const differentSeed = generateWaypointDistances(4_000, {
      kind: 'irregular',
      averageSpacingMeters: 500,
      seed: 43,
    });

    expect(second).toEqual(first);
    expect(differentSeed).not.toEqual(first);
    expect(first[0]).toBe(0);
    expect(first[first.length - 1]).toBe(4_000);
  });

  it('rejects a tiny interval on a long GPX instead of creating one huge final section', () => {
    expect(() =>
      generateWaypointDistances(10_000, {
        kind: 'regular',
        spacingMeters: 50,
      }),
    ).toThrow('use a shorter GPX');
  });

  it('rejects fixed intervals below the diagnostic safety minimum', () => {
    expect(() =>
      generateWaypointDistances(500, {
        kind: 'regular',
        spacingMeters: 25,
      }),
    ).toThrow('at least 50 metres');
  });
});

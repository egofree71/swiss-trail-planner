/**
 * Business context: protects the local-only routing switch so a developer can
 * test roads-only behavior without accidentally changing production routing.
 */
import { describe, expect, it } from 'vitest';
import { shouldUseHikingEnrichment } from './routingConfig';

describe('routing development configuration', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])(
    'uses the configured hiking-enrichment value on %s',
    (hostname) => {
      expect(
        shouldUseHikingEnrichment(hostname, {
          useHikingEnrichment: false,
        }),
      ).toBe(false);
      expect(
        shouldUseHikingEnrichment(hostname, {
          useHikingEnrichment: true,
        }),
      ).toBe(true);
    },
  );

  it('always enables hiking enrichment outside local development', () => {
    expect(
      shouldUseHikingEnrichment('egofree71.github.io', {
        useHikingEnrichment: false,
      }),
    ).toBe(true);
  });
});

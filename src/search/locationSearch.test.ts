/**
 * Regression tests for the GeoAdmin location-search adapter. The suite protects
 * cache identity, provider validation, label sanitization, and deduplication
 * without contacting the live SearchServer endpoint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLocationSearchCache,
  getCachedLocationSearch,
  searchLocations,
} from './locationSearch';

function jsonResponse(
  payload: unknown,
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function providerItem(
  id: string,
  label: unknown,
  latitude: unknown,
  longitude: unknown,
  origin: unknown = 'gazetteer',
) {
  return {
    id,
    attrs: {
      label,
      lat: latitude,
      lon: longitude,
      origin,
    },
  };
}

afterEach(() => {
  clearLocationSearchCache();
  vi.unstubAllGlobals();
});

describe('location search cache', () => {
  it('reuses normalized exact searches while keeping languages independent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            providerItem(
              'fr-1',
              '<b>Genève</b> <i>ville</i>',
              46.2044,
              6.1432,
            ),
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            providerItem(
              'de-1',
              '<b>Genf</b> <i>Stadt</i>',
              46.2044,
              6.1432,
            ),
          ],
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const frenchResults = await searchLocations(
      'Genève',
      'fr',
      new AbortController().signal,
    );
    const normalizedCacheHit = await searchLocations(
      '  GENE\u0300VE  ',
      'fr',
      new AbortController().signal,
    );
    const germanResults = await searchLocations(
      'Genève',
      'de',
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(frenchResults[0].label).toBe('Genève');
    expect(normalizedCacheHit).toEqual(frenchResults);
    expect(normalizedCacheHit).not.toBe(frenchResults);
    expect(germanResults[0].label).toBe('Genf');
  });

  it('caches empty successful responses but never caches failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            providerItem(
              'retry-1',
              'Lausanne',
              46.5197,
              6.6323,
            ),
          ],
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      searchLocations(
        'no-result-query',
        'en',
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);
    await expect(
      searchLocations(
        'no-result-query',
        'en',
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);

    await expect(
      searchLocations(
        'retry-query',
        'en',
        new AbortController().signal,
      ),
    ).rejects.toThrow('HTTP 503');
    await expect(
      searchLocations(
        'retry-query',
        'en',
        new AbortController().signal,
      ),
    ).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('evicts the least recently used query after 64 exact entries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const searchText = url.searchParams.get('searchText') ?? '';

      return jsonResponse({
        results: [
          providerItem(
            searchText,
            searchText,
            46.5,
            7.5,
          ),
        ],
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    for (let index = 0; index < 65; index += 1) {
      await searchLocations(
        `place-${index}`,
        'fr',
        new AbortController().signal,
      );
    }

    expect(
      getCachedLocationSearch('place-0', 'fr'),
    ).toBeNull();
    expect(
      getCachedLocationSearch('place-64', 'fr'),
    ).toHaveLength(1);

    await searchLocations(
      'place-0',
      'fr',
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(66);
  });
});

describe('location search provider normalization', () => {
  it('rejects empty or coerced coordinates and keeps valid numeric strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          providerItem('empty-lat', 'Empty latitude', '', 7.1),
          providerItem('blank-lon', 'Blank longitude', 46.1, '   '),
          providerItem('null-lat', 'Null latitude', null, 7.1),
          providerItem('boolean-lon', 'Boolean longitude', 46.1, true),
          providerItem('valid', 'Valid place', '46.25', '7.75'),
        ],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const results = await searchLocations(
      'coordinate-validation',
      'en',
      new AbortController().signal,
    );

    expect(results).toEqual([
      {
        id: 'gazetteer:valid',
        label: 'Valid place',
        origin: 'gazetteer',
        latitude: 46.25,
        longitude: 7.75,
      },
    ]);
  });

  it('normalizes safe text and removes strict duplicate places', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          providerItem(
            'first',
            '<b>Genève</b> <i>classification</i> &amp; environs',
            46.2044,
            6.1432,
            'gg25',
          ),
          providerItem(
            'duplicate',
            '  Genève &amp; environs  ',
            46.2044,
            6.1432,
            'gg25',
          ),
          providerItem(
            'different-position',
            'Genève &amp; environs',
            46.21,
            6.15,
            'gg25',
          ),
          providerItem(
            'invalid-origin',
            'Ignored provider item',
            46.2,
            6.1,
            'unknown',
          ),
        ],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const results = await searchLocations(
      'label-normalization',
      'fr',
      new AbortController().signal,
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: 'gg25:first',
      label: 'Genève & environs',
    });
    expect(results[1]).toMatchObject({
      id: 'gg25:different-position',
      label: 'Genève & environs',
    });
  });
});

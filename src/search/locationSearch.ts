/**
 * Business context: adapts the official GeoAdmin SearchServer response to the
 * small location-search contract used by the map interface.
 */
import type { Language } from '../i18n/translations';

const SEARCH_ENDPOINT =
  'https://api3.geo.admin.ch/rest/services/ech/SearchServer';

/** Maximum results displayed by the compact search panel. */
const RESULT_LIMIT = 8;
const SEARCH_ORIGINS = ['zipcode', 'gg25', 'gazetteer'] as const;

/** GeoAdmin origin used to translate the category in the interface layer. */
export type SearchOrigin = (typeof SEARCH_ORIGINS)[number];

interface SearchServerResponse {
  results?: SearchServerItem[];
}

interface SearchServerItem {
  id?: string | number;
  attrs?: {
    label?: unknown;
    lat?: unknown;
    lon?: unknown;
    origin?: unknown;
  };
}

/** Normalized location result returned to the React component. */
export interface LocationSearchResult {
  id: string;
  label: string;
  origin: SearchOrigin;
  latitude: number;
  longitude: number;
}

function isSearchOrigin(value: string): value is SearchOrigin {
  return SEARCH_ORIGINS.includes(value as SearchOrigin);
}

function readFiniteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/*
 * SearchServer labels contain simple emphasis tags. Removing the italic
 * classification keeps useful names and municipality information while
 * avoiding direct HTML injection into React.
 */
function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const document = new DOMParser().parseFromString(value, 'text/html');

  document.querySelectorAll('i').forEach((element) => {
    element.remove();
  });

  return (document.body.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Searches official Swiss place indexes in the selected interface language.
 * @param searchText - User-entered place text.
 * @param language - Language passed to GeoAdmin for returned labels.
 * @param signal - Abort signal owned by the debounced React effect.
 */
export async function searchLocations(
  searchText: string,
  language: Language,
  signal: AbortSignal,
): Promise<LocationSearchResult[]> {
  const parameters = new URLSearchParams({
    searchText,
    type: 'locations',
    origins: SEARCH_ORIGINS.join(','),
    lang: language,
    limit: String(RESULT_LIMIT),
  });

  const response = await fetch(`${SEARCH_ENDPOINT}?${parameters}`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `SearchServer returned HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as SearchServerResponse;
  const uniqueResults = new Map<string, LocationSearchResult>();

  for (const item of payload.results ?? []) {
    const attrs = item.attrs;
    const latitude = readFiniteNumber(attrs?.lat);
    const longitude = readFiniteNumber(attrs?.lon);
    const label = normalizeLabel(attrs?.label);
    const origin =
      typeof attrs?.origin === 'string' ? attrs.origin : '';

    if (
      latitude === null ||
      longitude === null ||
      !label ||
      !isSearchOrigin(origin)
    ) {
      continue;
    }

    const duplicateKey =
      `${label.toLocaleLowerCase(language)}:${latitude}:${longitude}`;

    if (uniqueResults.has(duplicateKey)) {
      continue;
    }

    uniqueResults.set(duplicateKey, {
      id: `${origin}:${String(item.id ?? duplicateKey)}`,
      label,
      origin,
      latitude,
      longitude,
    });
  }

  return Array.from(uniqueResults.values()).slice(0, RESULT_LIMIT);
}

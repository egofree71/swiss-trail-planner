const SEARCH_ENDPOINT =
  'https://api3.geo.admin.ch/rest/services/ech/SearchServer';

const RESULT_LIMIT = 8;
const SEARCH_ORIGINS = ['zipcode', 'gg25', 'gazetteer'] as const;

type SearchOrigin = (typeof SEARCH_ORIGINS)[number];

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

export interface LocationSearchResult {
  id: string;
  label: string;
  category: string;
  latitude: number;
  longitude: number;
}

const ORIGIN_LABELS: Record<SearchOrigin, string> = {
  zipcode: 'Localité ou code postal',
  gg25: 'Commune',
  gazetteer: 'Nom géographique',
};

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

export async function searchLocations(
  searchText: string,
  signal: AbortSignal,
): Promise<LocationSearchResult[]> {
  const parameters = new URLSearchParams({
    searchText,
    type: 'locations',
    origins: SEARCH_ORIGINS.join(','),
    lang: 'fr',
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
      `${label.toLocaleLowerCase('fr-CH')}:${latitude}:${longitude}`;

    if (uniqueResults.has(duplicateKey)) {
      continue;
    }

    uniqueResults.set(duplicateKey, {
      id: `${origin}:${String(item.id ?? duplicateKey)}`,
      label,
      category: ORIGIN_LABELS[origin],
      latitude,
      longitude,
    });
  }

  return Array.from(uniqueResults.values()).slice(0, RESULT_LIMIT);
}

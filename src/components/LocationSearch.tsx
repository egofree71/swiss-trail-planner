import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  searchLocations,
  type LocationSearchResult,
} from '../search/locationSearch';

interface LocationSearchProps {
  onSelect: (result: LocationSearchResult) => void;
}

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

const MINIMUM_QUERY_LENGTH = 2;
const SEARCH_DELAY_MS = 300;

export default function LocationSearch({
  onSelect,
}: LocationSearchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const skipNextSearchRef = useRef(false);
  const listboxId = useId();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }

    const searchText = query.trim();

    setActiveIndex(-1);

    if (searchText.length < MINIMUM_QUERY_LENGTH) {
      setResults([]);
      setStatus('idle');
      setIsOpen(false);
      return;
    }

    const abortController = new AbortController();

    const timeoutId = window.setTimeout(async () => {
      setStatus('loading');
      setIsOpen(true);

      try {
        const nextResults = await searchLocations(
          searchText,
          abortController.signal,
        );

        setResults(nextResults);
        setStatus('ready');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        console.error('Location search failed.', error);
        setResults([]);
        setStatus('error');
      }
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [query]);

  const selectResult = (result: LocationSearchResult) => {
    skipNextSearchRef.current = true;
    setQuery(result.label);
    setResults([]);
    setStatus('idle');
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect(result);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!isOpen || results.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? results.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectResult(results[activeIndex]);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setStatus('idle');
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const showPanel =
    isOpen &&
    query.trim().length >= MINIMUM_QUERY_LENGTH;

  return (
    <div className="location-search" ref={containerRef}>
      <div className="location-search-field">
        <svg
          className="location-search-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>

        <input
          type="search"
          value={query}
          placeholder="Rechercher une localité…"
          aria-label="Rechercher une localité"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0
              ? `${listboxId}-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (
              query.trim().length >= MINIMUM_QUERY_LENGTH &&
              (results.length > 0 || status !== 'idle')
            ) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
        />

        {query && (
          <button
            type="button"
            className="location-search-clear"
            aria-label="Effacer la recherche"
            title="Effacer"
            onClick={clearSearch}
          >
            ×
          </button>
        )}
      </div>

      {showPanel && (
        <div className="location-search-panel">
          {status === 'loading' && (
            <div className="location-search-status" role="status">
              Recherche…
            </div>
          )}

          {status === 'error' && (
            <div
              className="location-search-status location-search-status--error"
              role="alert"
            >
              La recherche est momentanément indisponible.
            </div>
          )}

          {status === 'ready' && results.length === 0 && (
            <div className="location-search-status">
              Aucun lieu trouvé.
            </div>
          )}

          {results.length > 0 && (
            <ul
              id={listboxId}
              className="location-search-results"
              role="listbox"
              aria-label="Résultats de recherche"
            >
              {results.map((result, index) => (
                <li key={result.id} role="presentation">
                  <button
                    id={`${listboxId}-${index}`}
                    type="button"
                    className={[
                      'location-search-result',
                      index === activeIndex
                        ? 'location-search-result--active'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(result)}
                  >
                    <svg
                      className="location-search-result-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" />
                      <circle cx="12" cy="10" r="2.2" />
                    </svg>

                    <span className="location-search-result-text">
                      <strong>{result.label}</strong>
                      <span>{result.category}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

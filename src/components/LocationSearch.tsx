/**
 * Business context: provides a compact, keyboard-accessible search field for
 * official Swiss places while keeping the map visible beneath temporary results.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  searchLocations,
  type LocationSearchResult,
} from '../search/locationSearch';

/** Callbacks supplied by the map shell to the presentation-only search control. */
interface LocationSearchProps {
  /** Closes map information when the search field becomes active. */
  onSearchFocus: () => void;
  /** Moves the map to the selected official search result. */
  onSelect: (result: LocationSearchResult) => void;
}

/** Request lifecycle used to render loading, results, and retryable errors. */
type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Minimum characters required before GeoAdmin is queried. */
const MINIMUM_QUERY_LENGTH = 2;
/** Debounce delay in milliseconds to avoid a request for every keystroke. */
const SEARCH_DELAY_MS = 300;

/**
 * Renders the debounced, keyboard-accessible GeoAdmin location search control.
 * Network cancellation and stale-result protection remain local to the control,
 * while map movement is delegated through the supplied callbacks.
 */
export default function LocationSearch({
  onSearchFocus,
  onSelect,
}: LocationSearchProps) {
  const { language, t } = useI18n();
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
          language,
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
  }, [language, query]);

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
  };

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
    isOpen && query.trim().length >= MINIMUM_QUERY_LENGTH;

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
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
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
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => {
            // Focusing a populated search can immediately reopen cached
            // suggestions, so map-information panels must be cleared first.
            onSearchFocus();

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
            aria-label={t('search.clearLabel')}
            title={t('search.clearTitle')}
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
              {t('search.loading')}
            </div>
          )}

          {status === 'error' && (
            <div
              className="location-search-status location-search-status--error"
              role="alert"
            >
              {t('search.unavailable')}
            </div>
          )}

          {status === 'ready' && results.length === 0 && (
            <div className="location-search-status">
              {t('search.noResults')}
            </div>
          )}

          {results.length > 0 && (
            <ul
              id={listboxId}
              className="location-search-results"
              role="listbox"
              aria-label={t('search.results')}
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
                      <span>
                        {t(`search.category.${result.origin}`)}
                      </span>
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

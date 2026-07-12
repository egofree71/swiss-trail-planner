/**
 * Business context: presents official closure metadata in a temporary,
 * localized map panel. The panel is non-modal so users can continue exploring
 * the map and close it without losing route or overlay state.
 */
import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';

/** Async popup content produced after a map click on the overlay. */
export type TrailClosurePopupStatus =
  | { state: 'loading'; html: null }
  | { state: 'ready'; html: string }
  | { state: 'error'; html: null };

/** Display state and close callback for the temporary information panel. */
interface TrailClosurePopupProps {
  /** Current loading, ready, or error state. */
  status: TrailClosurePopupStatus;
  /** Dismisses the panel and aborts any active metadata request. */
  onClose: () => void;
}

/** Renders sanitized GeoAdmin popup markup with project-owned styling. */
export default function TrailClosurePopup({
  status,
  onClose,
}: TrailClosurePopupProps) {
  const { t } = useI18n();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <aside
      className="trail-closure-popup"
      role="dialog"
      aria-label={t('closures.title')}
    >
      <header className="trail-closure-popup-header">
        <strong>{t('closures.title')}</strong>
        <button
          type="button"
          className="trail-closure-popup-close"
          aria-label={t('closures.close')}
          title={t('closures.close')}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="trail-closure-popup-body">
        {status.state === 'loading' && (
          <p role="status">{t('closures.loading')}</p>
        )}

        {status.state === 'error' && (
          <p className="trail-closure-popup-error" role="alert">
            {t('closures.loadError')}
          </p>
        )}

        {status.state === 'ready' && (
          <div
            className="trail-closure-popup-content"
            dangerouslySetInnerHTML={{ __html: status.html }}
          />
        )}
      </div>
    </aside>
  );
}

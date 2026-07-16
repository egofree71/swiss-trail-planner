/**
 * Business context: presents sanitized metadata from optional GeoAdmin layers
 * in one consistent temporary panel. Layer-specific wrappers provide the
 * translated title and messages without duplicating interaction markup.
 */
import { useEffect } from 'react';

/** Async content shown after identifying one map information feature. */
export type MapInformationPopupStatus =
  | { state: 'loading'; html: null }
  | { state: 'ready'; html: string }
  | { state: 'error'; html: null };

/** Layer-specific labels and state for the shared information panel. */
interface MapInformationPopupProps {
  /** Accessible and visible panel title. */
  title: string;
  /** Accessible label for the close control. */
  closeLabel: string;
  /** Message displayed while official metadata is loading. */
  loadingLabel: string;
  /** Message displayed when metadata cannot be loaded. */
  errorLabel: string;
  /** Current loading, ready, or error state. */
  status: MapInformationPopupStatus;
  /** Dismisses the panel and aborts any active metadata request. */
  onClose: () => void;
}

/** Renders sanitized official markup with project-owned styling. */
export default function MapInformationPopup({
  title,
  closeLabel,
  loadingLabel,
  errorLabel,
  status,
  onClose,
}: MapInformationPopupProps) {
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
      className="map-information-popup"
      role="dialog"
      aria-label={title}
    >
      <header className="map-information-popup-header">
        <strong>{title}</strong>
        <button
          type="button"
          className="map-information-popup-close"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="map-information-popup-body">
        {status.state === 'loading' && (
          <p role="status">{loadingLabel}</p>
        )}

        {status.state === 'error' && (
          <p className="map-information-popup-error" role="alert">
            {errorLabel}
          </p>
        )}

        {status.state === 'ready' && (
          <div
            className="map-information-popup-content"
            dangerouslySetInnerHTML={{ __html: status.html }}
          />
        )}
      </div>
    </aside>
  );
}

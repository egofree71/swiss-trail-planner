/**
 * Business context: presents only the passenger information useful while
 * planning a hike: transport mode in the header and official stop name in the
 * body. Administrative BAV fields stay hidden to keep the panel compact.
 */
import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type {
  PublicTransportMode,
  PublicTransportStop,
} from '../transport/publicTransportStops';

/** Selected passenger stop and close callback for the temporary panel. */
interface PublicTransportStopPopupProps {
  /** Stop feature already loaded and filtered by the vector overlay. */
  stop: PublicTransportStop;
  /** Dismisses the panel. */
  onClose: () => void;
}

/** Translation keys for normalized public-transport categories. */
const MODE_LABEL_KEYS: Record<
  PublicTransportMode,
  | 'transportStops.mode.train'
  | 'transportStops.mode.tram'
  | 'transportStops.mode.bus'
  | 'transportStops.mode.boat'
  | 'transportStops.mode.cableCar'
  | 'transportStops.mode.funicular'
  | 'transportStops.mode.other'
> = {
  train: 'transportStops.mode.train',
  tram: 'transportStops.mode.tram',
  bus: 'transportStops.mode.bus',
  boat: 'transportStops.mode.boat',
  cableCar: 'transportStops.mode.cableCar',
  funicular: 'transportStops.mode.funicular',
  other: 'transportStops.mode.other',
};

/** Renders a compact stop panel with no timetable or administrative metadata. */
export default function PublicTransportStopPopup({
  stop,
  onClose,
}: PublicTransportStopPopupProps) {
  const { t } = useI18n();
  const title = stop.modes
    .map((mode) =>
      mode === 'other'
        ? stop.rawMeansOfTransport
        : t(MODE_LABEL_KEYS[mode]),
    )
    .join(' / ');

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
      className="map-information-popup public-transport-stop-popup"
      role="dialog"
      aria-label={title}
    >
      <header className="map-information-popup-header">
        <strong>{title}</strong>
        <button
          type="button"
          className="map-information-popup-close"
          aria-label={t('transportStops.close')}
          title={t('transportStops.close')}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="map-information-popup-body">
        <p className="public-transport-stop-name">{stop.name}</p>
      </div>
    </aside>
  );
}

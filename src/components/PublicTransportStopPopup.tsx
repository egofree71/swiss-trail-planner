/**
 * Business context: keeps a selected passenger stop tied to practical trip
 * planning. The compact panel identifies the stop and its transport modes, then
 * hands departure/destination planning to the official SBB/CFF/FFS timetable.
 */
import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { Language } from '../i18n/translations';
import type {
  PublicTransportMode,
  PublicTransportStop,
} from '../transport/publicTransportStops';

/** Selected passenger stop and close callback for the temporary panel. */
interface PublicTransportStopPopupProps {
  /** Stop feature already loaded and filtered by the vector overlay. */
  stop: PublicTransportStop;
  /** Dismisses the panel and its map selection halo. */
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

/** Manual SBB deep-link location parameters documented for timetable forms. */
type SbbLocationParameter = 'von' | 'nach';

/** Builds a localized official timetable URL with one prefilled stop field. */
function createSbbTimetableUrl(
  language: Language,
  parameter: SbbLocationParameter,
  stopName: string,
): string {
  const url = new URL(`https://www.sbb.ch/${language}`);
  url.searchParams.set(parameter, stopName);
  return url.toString();
}

/** Renders a compact stop panel with official timetable hand-off links. */
export default function PublicTransportStopPopup({
  stop,
  onClose,
}: PublicTransportStopPopupProps) {
  const { language, t } = useI18n();
  const modeLabels = stop.modes.map((mode) =>
    mode === 'other'
      ? stop.rawMeansOfTransport
      : t(MODE_LABEL_KEYS[mode]),
  );
  const modesText = modeLabels.join(', ');
  const title = `${stop.name} (${modesText})`;
  const departureUrl = createSbbTimetableUrl(
    language,
    'von',
    stop.name,
  );
  const destinationUrl = createSbbTimetableUrl(
    language,
    'nach',
    stop.name,
  );

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
        <div className="public-transport-stop-heading">
          <strong>{stop.name}</strong>
          <span> ({modesText})</span>
        </div>
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
        <div className="public-transport-stop-links">
          <a href={departureUrl} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 19 19 5" />
              <path d="M10 5h9v9" />
            </svg>
            <span>{t('transportStops.sbbDeparture')}</span>
          </a>
          <a href={destinationUrl} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 19 19 5" />
              <path d="M10 5h9v9" />
            </svg>
            <span>{t('transportStops.sbbDestination')}</span>
          </a>
        </div>
      </div>
    </aside>
  );
}

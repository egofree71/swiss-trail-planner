/**
 * Business context: keeps a selected passenger stop tied to practical trip
 * planning. The panel identifies the stop and its transport modes, loads the
 * next departures from transport.opendata.ch, and still offers direct hand-off
 * links to the official SBB/CFF/FFS timetable.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { Language } from '../i18n/translations';
import {
  loadStationBoard,
  type StationBoardDeparture,
} from '../transport/stationBoard';
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

/** Loading state for the independently fetched stationboard. */
type StationBoardStatus = 'loading' | 'ready' | 'error';

/** Translation keys for normalized public-transport categories. */
const MODE_LABEL_KEYS: Record<
  PublicTransportMode,
  | 'transportStops.mode.train'
  | 'transportStops.mode.tram'
  | 'transportStops.mode.bus'
  | 'transportStops.mode.boat'
  | 'transportStops.mode.cableCar'
  | 'transportStops.mode.chairlift'
  | 'transportStops.mode.funicular'
  | 'transportStops.mode.other'
> = {
  train: 'transportStops.mode.train',
  tram: 'transportStops.mode.tram',
  bus: 'transportStops.mode.bus',
  boat: 'transportStops.mode.boat',
  cableCar: 'transportStops.mode.cableCar',
  chairlift: 'transportStops.mode.chairlift',
  funicular: 'transportStops.mode.funicular',
  other: 'transportStops.mode.other',
};

/** Terms that already identify a transport mode inside an official stop name. */
const MODE_NAME_PATTERNS: Partial<Record<PublicTransportMode, RegExp>> = {
  bus: /\bbus\b/,
  cableCar:
    /telepherique|telecabine|kabinenbahn|gondelbahn|pendelbahn|luftseilbahn|seilbahn|gondola|funivia|cabinovia|cable car/,
  chairlift: /telesiege|sesselbahn|sessellift|seggiovia|chairlift|chair lift/,
  funicular: /funiculaire|standseilbahn|funicolare|funicular/,
};

/** Normalizes accents and punctuation before testing multilingual mode names. */
function normalizeStopName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Avoids headings such as `EPFL (bus) (Bus)` or duplicate cable-car labels. */
function stopNameAlreadyContainsMode(
  stopName: string,
  mode: PublicTransportMode,
): boolean {
  const pattern = MODE_NAME_PATTERNS[mode];
  return pattern ? pattern.test(normalizeStopName(stopName)) : false;
}

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

/** Returns the predicted departure when available, otherwise the scheduled one. */
function getDisplayedDepartureTime(
  departure: StationBoardDeparture,
): string {
  return departure.estimatedDeparture ?? departure.plannedDeparture;
}

/** Renders a compact stop panel with departures and official timetable links. */
export default function PublicTransportStopPopup({
  stop,
  onClose,
}: PublicTransportStopPopupProps) {
  const { language, locale, t } = useI18n();
  const [stationBoardStatus, setStationBoardStatus] =
    useState<StationBoardStatus>('loading');
  const [departures, setDepartures] = useState<StationBoardDeparture[]>([]);
  const [confirmedModes, setConfirmedModes] =
    useState<PublicTransportMode[]>([]);
  const displayedModes =
    stationBoardStatus === 'loading'
      ? stop.modes.slice(0, 1)
      : stationBoardStatus === 'ready' && confirmedModes.length > 0
        ? confirmedModes
        : stop.modes;
  const modeLabels = displayedModes.flatMap((mode) => {
    // Official names sometimes already distinguish adjacent platforms with a
    // mode suffix. Repeating it would create headings such as
    // `Château-d'Oex (téléphérique) (Téléphérique)`.
    if (stopNameAlreadyContainsMode(stop.name, mode)) {
      return [];
    }

    return [
      mode === 'other'
        ? stop.rawMeansOfTransport
        : t(MODE_LABEL_KEYS[mode]),
    ];
  });
  const modesText = modeLabels.join(', ');
  const title = modesText ? `${stop.name} (${modesText})` : stop.name;
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
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
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

  useEffect(() => {
    const controller = new AbortController();
    setStationBoardStatus('loading');
    setDepartures([]);
    setConfirmedModes([]);

    void loadStationBoard(stop.stationIds, controller.signal)
      .then((result) => {
        setDepartures(result.departures);
        setConfirmedModes(result.modes);
        setStationBoardStatus('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        console.error('Unable to load public-transport departures.', error);
        setStationBoardStatus('error');
      });

    return () => controller.abort();
  }, [stop.id, stop.stationIds]);

  return (
    <aside
      className="map-information-popup public-transport-stop-popup"
      role="dialog"
      aria-label={title}
    >
      <header className="map-information-popup-header">
        <div className="public-transport-stop-heading">
          <strong>{stop.name}</strong>
          {modesText && <span> ({modesText})</span>}
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
        <section
          className="public-transport-departures"
          aria-labelledby="public-transport-departures-title"
          aria-live="polite"
        >
          <h2 id="public-transport-departures-title">
            {t('transportStops.departures')}
          </h2>

          {stationBoardStatus === 'loading' && (
            <p className="public-transport-departures-status">
              {t('transportStops.departuresLoading')}
            </p>
          )}

          {stationBoardStatus === 'error' && (
            <p className="public-transport-departures-status map-information-popup-error">
              {t('transportStops.departuresError')}
            </p>
          )}

          {stationBoardStatus === 'ready' && departures.length === 0 && (
            <p className="public-transport-departures-status">
              {t('transportStops.noDepartures')}
            </p>
          )}

          {stationBoardStatus === 'ready' && departures.length > 0 && (
            <ol className="public-transport-departure-list">
              {departures.map((departure) => (
                <li key={departure.id}>
                  <span className="public-transport-departure-line">
                    {departure.line}
                  </span>
                  <span className="public-transport-departure-destination">
                    {departure.destination}
                  </span>
                  <time
                    dateTime={getDisplayedDepartureTime(departure)}
                    className="public-transport-departure-time"
                  >
                    {timeFormatter.format(
                      new Date(getDisplayedDepartureTime(departure)),
                    )}
                  </time>
                  {departure.delayMinutes !== null && (
                    <span
                      className="public-transport-departure-delay"
                      title={t('transportStops.delayTitle')}
                    >
                      +{departure.delayMinutes} {t('units.minuteShort')}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

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

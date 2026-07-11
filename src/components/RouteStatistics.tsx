/**
 * Business context: presents the essential planning figures for the currently
 * drawn hike in a compact floating bar. It can reveal the elevation profile
 * above the bar while preserving the map as the main interface.
 */
import { useId, useState } from 'react';
import type { RouteElevationPoint } from '../metrics/routeMetrics';
import RouteElevationProfile from './RouteElevationProfile';

/** Availability state for altitude-dependent route figures. */
export type RouteElevationStatus = 'loading' | 'ready' | 'error';

/** Values displayed by the route statistics bar. */
interface RouteStatisticsProps {
  /** Horizontal route length in metres. */
  distanceMeters: number;
  /** Elevation-profile loading state. */
  elevationStatus: RouteElevationStatus;
  /** Total climb in metres when elevation data is ready. */
  ascentMeters: number | null;
  /** Total descent in metres when elevation data is ready. */
  descentMeters: number | null;
  /** Estimated walking time in minutes when elevation data is ready. */
  durationMinutes: number | null;
  /** Ordered samples used to draw the optional elevation profile. */
  elevationPoints: RouteElevationPoint[];
}

const DISTANCE_FORMAT = new Intl.NumberFormat('fr-CH', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const INTEGER_FORMAT = new Intl.NumberFormat('fr-CH', {
  maximumFractionDigits: 0,
});
/** Duration is rounded to five minutes because it is an indicative estimate. */
const DURATION_ROUNDING_MINUTES = 5;

/** Formats metres as metres for short lines and kilometres for hiking routes. */
function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) {
    return `${INTEGER_FORMAT.format(Math.round(distanceMeters))} m`;
  }

  return `${DISTANCE_FORMAT.format(distanceMeters / 1_000)} km`;
}

/** Formats an altitude difference in whole metres. */
function formatElevation(elevationMeters: number): string {
  return `${INTEGER_FORMAT.format(Math.round(elevationMeters))} m`;
}

/** Formats approximate walking time after rounding to the nearest five minutes. */
function formatDuration(durationMinutes: number): string {
  const roundedMinutes = Math.max(
    DURATION_ROUNDING_MINUTES,
    Math.round(durationMinutes / DURATION_ROUNDING_MINUTES) *
      DURATION_ROUNDING_MINUTES,
  );
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `≈ ${minutes} min`;
  }

  if (minutes === 0) {
    return `≈ ${hours} h`;
  }

  return `≈ ${hours} h ${String(minutes).padStart(2, '0')}`;
}

/** Uses an ellipsis while loading and a dash if altitude lookup failed. */
function pendingValue(status: RouteElevationStatus): string {
  return status === 'loading' ? '…' : '—';
}

/** Compact summary with a toggle for the elevation-profile panel. */
export default function RouteStatistics({
  distanceMeters,
  elevationStatus,
  ascentMeters,
  descentMeters,
  durationMinutes,
  elevationPoints,
}: RouteStatisticsProps) {
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const profileId = useId();
  const hasElevation =
    elevationStatus === 'ready' &&
    ascentMeters !== null &&
    descentMeters !== null &&
    durationMinutes !== null;
  const hasProfile =
    elevationStatus === 'ready' && elevationPoints.length >= 2;
  const unavailableValue = pendingValue(elevationStatus);
  const profileButtonLabel = hasProfile
    ? isProfileVisible
      ? 'Masquer le profil d’altitude'
      : 'Afficher le profil d’altitude'
    : elevationStatus === 'loading'
      ? 'Chargement du profil d’altitude'
      : 'Profil d’altitude indisponible';

  return (
    <div className="route-summary">
      {isProfileVisible && hasProfile && (
        <RouteElevationProfile id={profileId} points={elevationPoints} />
      )}

      <section
        className="route-statistics"
        aria-label="Statistiques de l’itinéraire"
        aria-busy={elevationStatus === 'loading'}
      >
        <div className="route-statistics-item">
          <span>Distance</span>
          <strong>{formatDistance(distanceMeters)}</strong>
        </div>

        <div className="route-statistics-item">
          <span>Montée</span>
          <strong>
            {hasElevation ? formatElevation(ascentMeters) : unavailableValue}
          </strong>
        </div>

        <div className="route-statistics-item">
          <span>Descente</span>
          <strong>
            {hasElevation ? formatElevation(descentMeters) : unavailableValue}
          </strong>
        </div>

        <div
          className="route-statistics-item"
          title="Temps de marche estimé, pauses non comprises"
        >
          <span>Durée</span>
          <strong>
            {hasElevation ? formatDuration(durationMinutes) : unavailableValue}
          </strong>
        </div>

        <button
          type="button"
          className={[
            'route-profile-toggle',
            isProfileVisible && hasProfile
              ? 'route-profile-toggle--active'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={profileButtonLabel}
          aria-expanded={isProfileVisible && hasProfile}
          aria-controls={profileId}
          title={profileButtonLabel}
          disabled={!hasProfile}
          onClick={() => setIsProfileVisible((isVisible) => !isVisible)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3.5 18.5h17" />
            <path d="m4.5 16 4.1-5 3.2 3.2 3.5-7 4.2 8.8" />
          </svg>
        </button>
      </section>
    </div>
  );
}

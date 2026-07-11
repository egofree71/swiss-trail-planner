/**
 * Business context: presents the essential planning figures for the currently
 * drawn hike in a compact floating bar. It remains visible over the map without
 * introducing a permanent full-width application panel.
 */

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

/** Compact, accessible summary of distance, ascent, descent, and walking time. */
export default function RouteStatistics({
  distanceMeters,
  elevationStatus,
  ascentMeters,
  descentMeters,
  durationMinutes,
}: RouteStatisticsProps) {
  const hasElevation =
    elevationStatus === 'ready' &&
    ascentMeters !== null &&
    descentMeters !== null &&
    durationMinutes !== null;
  const unavailableValue = pendingValue(elevationStatus);

  return (
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
    </section>
  );
}

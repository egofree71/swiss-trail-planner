/**
 * Business context: visualizes the terrain shape of the current hike without
 * replacing the map. The chart is intentionally lightweight and uses the same
 * elevation samples already fetched for ascent/descent calculations.
 */
import type { RouteElevationPoint } from '../metrics/routeMetrics';

/** Data and identity required by the collapsible elevation chart. */
interface RouteElevationProfileProps {
  /** DOM id referenced by the profile toggle through aria-controls. */
  id: string;
  /** Ordered elevation samples from the start to the end of the route. */
  points: RouteElevationPoint[];
}

/** Internal SVG dimensions used to normalize route distance and altitude. */
const CHART_WIDTH = 720;
const CHART_HEIGHT = 150;
const CHART_PADDING = {
  top: 14,
  right: 22,
  bottom: 27,
  left: 64,
};
/** Three horizontal guides keep the compact chart readable without visual noise. */
const GRID_LINE_COUNT = 3;

const INTEGER_FORMAT = new Intl.NumberFormat('fr-CH', {
  maximumFractionDigits: 0,
});
const DISTANCE_FORMAT = new Intl.NumberFormat('fr-CH', {
  maximumFractionDigits: 1,
});

/** Formats one chart altitude in whole metres. */
function formatAltitude(elevationMeters: number): string {
  return `${INTEGER_FORMAT.format(Math.round(elevationMeters))} m`;
}

/** Formats cumulative profile distance using metres or kilometres. */
function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) {
    return `${INTEGER_FORMAT.format(Math.round(distanceMeters))} m`;
  }

  return `${DISTANCE_FORMAT.format(distanceMeters / 1_000)} km`;
}

/**
 * Converts elevation samples to SVG coordinates while preserving relative
 * distance along the route and avoiding a flat zero-height chart.
 */
function buildChartPoints(points: RouteElevationPoint[]): {
  linePoints: string;
  areaPath: string;
  minimumElevation: number;
  maximumElevation: number;
  totalDistance: number;
} {
  const elevations = points.map((point) => point.elevationMeters);
  const minimumElevation = Math.min(...elevations);
  const maximumElevation = Math.max(...elevations);
  const elevationRange = Math.max(maximumElevation - minimumElevation, 1);
  const totalDistance = Math.max(points[points.length - 1].distanceMeters, 1);
  const plotWidth =
    CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight =
    CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  const chartCoordinates = points.map((point) => {
    const x =
      CHART_PADDING.left +
      (point.distanceMeters / totalDistance) * plotWidth;
    const y =
      CHART_PADDING.top +
      (1 -
        (point.elevationMeters - minimumElevation) / elevationRange) *
        plotHeight;

    return [x, y] as const;
  });

  const linePoints = chartCoordinates
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const baselineY = CHART_HEIGHT - CHART_PADDING.bottom;
  const firstPoint = chartCoordinates[0];
  const lastPoint = chartCoordinates[chartCoordinates.length - 1];
  const areaPath = [
    `M ${firstPoint[0].toFixed(2)} ${baselineY}`,
    ...chartCoordinates.map(
      ([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`,
    ),
    `L ${lastPoint[0].toFixed(2)} ${baselineY}`,
    'Z',
  ].join(' ');

  return {
    linePoints,
    areaPath,
    minimumElevation,
    maximumElevation,
    totalDistance,
  };
}

/** Compact SVG elevation profile displayed above the route statistics bar. */
export default function RouteElevationProfile({
  id,
  points,
}: RouteElevationProfileProps) {
  const {
    linePoints,
    areaPath,
    minimumElevation,
    maximumElevation,
    totalDistance,
  } = buildChartPoints(points);
  const plotHeight =
    CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  return (
    <section
      id={id}
      className="route-elevation-profile"
      aria-label="Profil d’altitude de l’itinéraire"
    >
      <div className="route-elevation-profile-header">
        <strong>Profil d’altitude</strong>
        <span>
          {formatAltitude(minimumElevation)} –{' '}
          {formatAltitude(maximumElevation)}
        </span>
      </div>

      <svg
        className="route-elevation-profile-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`Profil d’altitude de ${formatAltitude(minimumElevation)} à ${formatAltitude(maximumElevation)}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {Array.from({ length: GRID_LINE_COUNT }, (_, index) => {
          const fraction = index / (GRID_LINE_COUNT - 1);
          const y = CHART_PADDING.top + fraction * plotHeight;
          const elevation =
            maximumElevation -
            fraction * (maximumElevation - minimumElevation);

          return (
            <g key={fraction}>
              <line
                className="route-elevation-profile-grid"
                x1={CHART_PADDING.left}
                x2={CHART_WIDTH - CHART_PADDING.right}
                y1={y}
                y2={y}
              />
              <text
                className="route-elevation-profile-axis-label"
                x={CHART_PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
              >
                {INTEGER_FORMAT.format(Math.round(elevation))}
              </text>
            </g>
          );
        })}

        <path className="route-elevation-profile-area" d={areaPath} />
        <polyline
          className="route-elevation-profile-line"
          points={linePoints}
        />

        <text
          className="route-elevation-profile-distance-label"
          x={CHART_PADDING.left}
          y={CHART_HEIGHT - 7}
          textAnchor="start"
        >
          0
        </text>
        <text
          className="route-elevation-profile-distance-label"
          x={CHART_WIDTH - CHART_PADDING.right}
          y={CHART_HEIGHT - 7}
          textAnchor="end"
        >
          {formatDistance(totalDistance)}
        </text>
      </svg>
    </section>
  );
}

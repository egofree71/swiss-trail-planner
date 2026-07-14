/**
 * Business context: visualizes the terrain shape of the current hike without
 * replacing the map. The chart is intentionally lightweight and uses the same
 * elevation samples already fetched for ascent/descent calculations.
 */
import { useMemo } from 'react';
import { useI18n } from '../i18n/I18nContext';
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
/**
 * Prevents tiny elevation variations from filling the chart height and looking
 * much steeper than they are on the ground.
 */
const MINIMUM_ELEVATION_RANGE_METERS = 40;
/** Whole-ten-metre bounds keep the compact vertical axis easy to scan. */
const ELEVATION_BOUND_ROUNDING_METERS = 10;
/** Larger profiles keep a small visual margin above and below their extrema. */
const ELEVATION_RANGE_PADDING_RATIO = 0.05;

/** Formats one chart altitude in whole metres. */
function formatAltitude(
  elevationMeters: number,
  integerFormat: Intl.NumberFormat,
): string {
  return `${integerFormat.format(Math.round(elevationMeters))} m`;
}

/** Formats cumulative profile distance using metres or kilometres. */
function formatDistance(
  distanceMeters: number,
  integerFormat: Intl.NumberFormat,
  distanceFormat: Intl.NumberFormat,
): string {
  if (distanceMeters < 1_000) {
    return `${integerFormat.format(Math.round(distanceMeters))} m`;
  }

  return `${distanceFormat.format(distanceMeters / 1_000)} km`;
}

interface ElevationBounds {
  chartMinimumElevation: number;
  chartMaximumElevation: number;
}

/**
 * Expands very small profiles to a realistic visual scale and rounds the axis
 * bounds without changing the underlying samples or route statistics.
 */
function calculateElevationBounds(
  minimumElevation: number,
  maximumElevation: number,
): ElevationBounds {
  const actualRange = maximumElevation - minimumElevation;

  if (actualRange <= MINIMUM_ELEVATION_RANGE_METERS) {
    const centreElevation = (minimumElevation + maximumElevation) / 2;
    const halfMinimumRange = MINIMUM_ELEVATION_RANGE_METERS / 2;
    let chartMinimumElevation =
      Math.round(
        (centreElevation - halfMinimumRange) /
          ELEVATION_BOUND_ROUNDING_METERS,
      ) * ELEVATION_BOUND_ROUNDING_METERS;
    let chartMaximumElevation =
      chartMinimumElevation + MINIMUM_ELEVATION_RANGE_METERS;

    if (minimumElevation < chartMinimumElevation) {
      chartMinimumElevation =
        Math.floor(minimumElevation / ELEVATION_BOUND_ROUNDING_METERS) *
        ELEVATION_BOUND_ROUNDING_METERS;
      chartMaximumElevation =
        chartMinimumElevation + MINIMUM_ELEVATION_RANGE_METERS;
    }

    if (maximumElevation > chartMaximumElevation) {
      chartMaximumElevation =
        Math.ceil(maximumElevation / ELEVATION_BOUND_ROUNDING_METERS) *
        ELEVATION_BOUND_ROUNDING_METERS;
      chartMinimumElevation =
        chartMaximumElevation - MINIMUM_ELEVATION_RANGE_METERS;
    }

    // A range close to 40 m can straddle rounded boundaries. Expand only the
    // side still outside the chart rather than clipping a real sample.
    if (minimumElevation < chartMinimumElevation) {
      chartMinimumElevation =
        Math.floor(minimumElevation / ELEVATION_BOUND_ROUNDING_METERS) *
        ELEVATION_BOUND_ROUNDING_METERS;
    }
    if (maximumElevation > chartMaximumElevation) {
      chartMaximumElevation =
        Math.ceil(maximumElevation / ELEVATION_BOUND_ROUNDING_METERS) *
        ELEVATION_BOUND_ROUNDING_METERS;
    }

    return { chartMinimumElevation, chartMaximumElevation };
  }

  const padding = actualRange * ELEVATION_RANGE_PADDING_RATIO;
  return {
    chartMinimumElevation:
      Math.floor(
        (minimumElevation - padding) / ELEVATION_BOUND_ROUNDING_METERS,
      ) * ELEVATION_BOUND_ROUNDING_METERS,
    chartMaximumElevation:
      Math.ceil(
        (maximumElevation + padding) / ELEVATION_BOUND_ROUNDING_METERS,
      ) * ELEVATION_BOUND_ROUNDING_METERS,
  };
}

/**
 * Converts elevation samples to SVG coordinates while preserving relative
 * distance along the route and using realistic vertical display bounds.
 */
function buildChartPoints(points: RouteElevationPoint[]): {
  linePoints: string;
  areaPath: string;
  minimumElevation: number;
  maximumElevation: number;
  chartMinimumElevation: number;
  chartMaximumElevation: number;
  totalDistance: number;
} {
  const elevations = points.map((point) => point.elevationMeters);
  const minimumElevation = Math.min(...elevations);
  const maximumElevation = Math.max(...elevations);
  const { chartMinimumElevation, chartMaximumElevation } =
    calculateElevationBounds(minimumElevation, maximumElevation);
  const elevationRange = chartMaximumElevation - chartMinimumElevation;
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
        (point.elevationMeters - chartMinimumElevation) / elevationRange) *
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
    chartMinimumElevation,
    chartMaximumElevation,
    totalDistance,
  };
}

/** Compact SVG elevation profile displayed above the route statistics bar. */
export default function RouteElevationProfile({
  id,
  points,
}: RouteElevationProfileProps) {
  const { locale, t } = useI18n();
  const integerFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale],
  );
  const distanceFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    [locale],
  );
  const {
    linePoints,
    areaPath,
    minimumElevation,
    maximumElevation,
    chartMinimumElevation,
    chartMaximumElevation,
    totalDistance,
  } = buildChartPoints(points);
  const plotHeight =
    CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const formattedMinimum = formatAltitude(minimumElevation, integerFormat);
  const formattedMaximum = formatAltitude(maximumElevation, integerFormat);

  return (
    <section
      id={id}
      className="route-elevation-profile"
      aria-label={t('profile.aria')}
    >
      <div className="route-elevation-profile-header">
        <strong>{t('profile.title')}</strong>
        <span>
          {formattedMinimum} – {formattedMaximum}
        </span>
      </div>

      <svg
        className="route-elevation-profile-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={t('profile.rangeAria', {
          minimum: formattedMinimum,
          maximum: formattedMaximum,
        })}
        preserveAspectRatio="xMidYMid meet"
      >
        {Array.from({ length: GRID_LINE_COUNT }, (_, index) => {
          const fraction = index / (GRID_LINE_COUNT - 1);
          const y = CHART_PADDING.top + fraction * plotHeight;
          const elevation =
            chartMaximumElevation -
            fraction *
              (chartMaximumElevation - chartMinimumElevation);

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
                {integerFormat.format(Math.round(elevation))}
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
          {formatDistance(totalDistance, integerFormat, distanceFormat)}
        </text>
      </svg>
    </section>
  );
}

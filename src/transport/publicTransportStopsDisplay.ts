/**
 * Business context: renders filtered passenger stops as client-side OpenLayers
 * vectors. The official raster portrayal cannot be filtered after rendering,
 * so this module owns zoom-aware pictograms, deterministic fan-out for nearby
 * facilities, and the selected-stop halo used by the information popup.
 */
import type { Coordinate } from 'ol/coordinate.js';
import Feature, { type FeatureLike } from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Icon from 'ol/style/Icon.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import boatIconUrl from '../assets/public-transport-stops/boat.svg';
import busIconUrl from '../assets/public-transport-stops/bus.svg';
import cableCarIconUrl from '../assets/public-transport-stops/cable-car.svg';
import chairliftIconUrl from '../assets/public-transport-stops/chairlift.svg';
import funicularIconUrl from '../assets/public-transport-stops/funicular.svg';
import trainIconUrl from '../assets/public-transport-stops/train.svg';
import tramIconUrl from '../assets/public-transport-stops/tram.svg';
import { LV95_VIEW_RESOLUTIONS } from '../map/projection';
import {
  getPrimaryPublicTransportMode,
  type PublicTransportMode,
  type PublicTransportStop,
} from './publicTransportStopModel';

/**
 * Stops are useful only at detailed scales. OpenLayers treats this boundary as
 * exclusive, so a value of 18 displays the layer from native level 19.
 */
export const PUBLIC_TRANSPORT_STOPS_MIN_ZOOM = 18;

/** Compact symbol size in CSS pixels at broad urban and regional scales. */
const STOP_ICON_OVERVIEW_SIZE_PIXELS = 20;

/** Intermediate symbol size in CSS pixels before street-level planning. */
const STOP_ICON_MEDIUM_SIZE_PIXELS = 23;

/** Symbol size in CSS pixels once individual streets and paths are prominent. */
const STOP_ICON_DETAILED_SIZE_PIXELS = 29;

/** Symbol size in CSS pixels when building detail becomes dominant. */
const STOP_ICON_VERY_DETAILED_SIZE_PIXELS = 33;

/** Final symbol size in CSS pixels at the closest hiking-planning scales. */
const STOP_ICON_CLOSE_SIZE_PIXELS = 37;

/** First native zoom level receiving the medium symbol size. */
const STOP_ICON_MEDIUM_ZOOM = 21;

/** First native zoom level receiving the detailed symbol size. */
const STOP_ICON_DETAILED_ZOOM = 25;

/** First native zoom level receiving the very-detailed symbol size. */
const STOP_ICON_VERY_DETAILED_ZOOM = 26;

/** First native zoom level receiving the final close-scale symbol size. */
const STOP_ICON_CLOSE_ZOOM = 27;

/** Attribution attached to the vector source built from the official layer. */
const PUBLIC_TRANSPORT_STOPS_ATTRIBUTION =
  '<a href="https://www.bav.admin.ch/" target="_blank" rel="noopener noreferrer">© BAV</a>';

/** Internal feature property containing structured stop metadata. */
const STOP_PROPERTY_NAME = 'publicTransportStop';

/** Internal feature property describing close-stop visual separation. */
const STOP_OVERLAP_LAYOUT_PROPERTY_NAME = 'publicTransportStopOverlapLayout';

/**
 * Distinct stops within 60 metres can overlap at medium zoom levels. They stay
 * separate data objects and are only fanned apart visually until their real
 * positions become distinguishable.
 */
const STOP_OVERLAP_DISTANCE_METERS = 60;

/** Base fan-out radius in CSS pixels before scaling with the current icon size. */
const STOP_OVERLAP_DISPLAY_RADIUS_PIXELS = 17;

/** OpenLayers resources owned by the map runtime for the stop overlay. */
export interface PublicTransportStopsDisplay {
  /** Vector layer placed above hiking and closure information. */
  layer: VectorLayer<VectorSource<Feature<Point>>>;
  /** Mutable source replaced after each completed viewport request. */
  source: VectorSource<Feature<Point>>;
  /** Halo layer that keeps the selected stop identifiable under the popup. */
  selectionLayer: VectorLayer<VectorSource<Feature<Point>>>;
  /** Source containing at most one selected-stop marker. */
  selectionSource: VectorSource<Feature<Point>>;
}

/** Visual layout for one stop that belongs to a close-symbol group. */
interface StopOverlapLayout {
  /** Shared group centre in EPSG:2056 map coordinates. */
  center: Coordinate;
  /** Furthest real stop distance from the group centre in LV95 metres. */
  radiusMapUnits: number;
  /** Desired symbol position relative to the centre in CSS pixels. */
  targetOffsetPixels: Coordinate;
}

/** Returns the discrete stop-symbol size for the current native LV95 scale. */
function getStopIconSize(resolution: number): number {
  if (!Number.isFinite(resolution) || resolution <= 0) {
    return STOP_ICON_OVERVIEW_SIZE_PIXELS;
  }

  if (resolution <= LV95_VIEW_RESOLUTIONS[STOP_ICON_CLOSE_ZOOM]) {
    return STOP_ICON_CLOSE_SIZE_PIXELS;
  }

  if (resolution <= LV95_VIEW_RESOLUTIONS[STOP_ICON_VERY_DETAILED_ZOOM]) {
    return STOP_ICON_VERY_DETAILED_SIZE_PIXELS;
  }

  if (resolution <= LV95_VIEW_RESOLUTIONS[STOP_ICON_DETAILED_ZOOM]) {
    return STOP_ICON_DETAILED_SIZE_PIXELS;
  }

  if (resolution <= LV95_VIEW_RESOLUTIONS[STOP_ICON_MEDIUM_ZOOM]) {
    return STOP_ICON_MEDIUM_SIZE_PIXELS;
  }

  return STOP_ICON_OVERVIEW_SIZE_PIXELS;
}

/** Keeps the fan-out radius tied directly to the rendered symbol radius. */
function getStopOverlapDisplayRadius(iconSize: number): number {
  return iconSize / 2 + 4.5;
}

/** Releases displacement once real positions leave only a small icon overlap. */
function getStopOverlapReleaseRadius(iconSize: number): number {
  return iconSize / 2 + 1.5;
}

/** Returns planar distance in LV95 metres between two map coordinates. */
function mapCoordinateDistance(
  first: Coordinate,
  second: Coordinate,
): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

/**
 * Assigns a deterministic fan layout to distinct stops whose symbols would
 * otherwise overlap. Nearby facilities remain independently selectable and
 * retain their own official identifiers and timetable requests.
 */
function createStopOverlapLayouts(
  stops: PublicTransportStop[],
): Map<string, StopOverlapLayout> {
  const layouts = new Map<string, StopOverlapLayout>();
  const remaining = new Set(stops.map((stop) => stop.id));
  const orderedStops = [...stops].sort((first, second) =>
    first.id.localeCompare(second.id),
  );

  for (const anchor of orderedStops) {
    if (!remaining.has(anchor.id)) {
      continue;
    }

    const closeStops = orderedStops.filter(
      (candidate) =>
        remaining.has(candidate.id) &&
        mapCoordinateDistance(anchor.coordinate, candidate.coordinate) <=
          STOP_OVERLAP_DISTANCE_METERS,
    );

    for (const stop of closeStops) {
      remaining.delete(stop.id);
    }

    if (closeStops.length < 2) {
      continue;
    }

    const center: Coordinate = [
      closeStops.reduce((sum, stop) => sum + stop.coordinate[0], 0) /
        closeStops.length,
      closeStops.reduce((sum, stop) => sum + stop.coordinate[1], 0) /
        closeStops.length,
    ];
    const radiusMapUnits = Math.max(
      ...closeStops.map((stop) =>
        mapCoordinateDistance(stop.coordinate, center),
      ),
    );

    closeStops.forEach((stop, index) => {
      const angle = (2 * Math.PI * index) / closeStops.length;
      layouts.set(stop.id, {
        center,
        radiusMapUnits,
        targetOffsetPixels: [
          Math.cos(angle) * STOP_OVERLAP_DISPLAY_RADIUS_PIXELS,
          Math.sin(angle) * STOP_OVERLAP_DISPLAY_RADIUS_PIXELS,
        ],
      });
    });
  }

  return layouts;
}

/** Reads an internal close-symbol layout from one rendered feature. */
function getStopOverlapLayout(
  feature: FeatureLike,
): StopOverlapLayout | null {
  const value = feature.get(STOP_OVERLAP_LAYOUT_PROPERTY_NAME) as unknown;

  if (!value || typeof value !== 'object') {
    return null;
  }

  const layout = value as Partial<StopOverlapLayout>;
  return Array.isArray(layout.center) &&
    typeof layout.radiusMapUnits === 'number' &&
    Array.isArray(layout.targetOffsetPixels)
    ? (layout as StopOverlapLayout)
    : null;
}

/**
 * Converts a close-stop layout into an OpenLayers pixel displacement.
 * At detailed zoom levels the real coordinates become sufficiently separated,
 * so displacement disappears instead of permanently distorting the map.
 */
function calculateStopDisplacement(
  coordinate: Coordinate,
  layout: StopOverlapLayout | null,
  resolution: number,
  iconSize: number,
): Coordinate {
  if (!layout || !Number.isFinite(resolution) || resolution <= 0) {
    return [0, 0];
  }

  if (
    layout.radiusMapUnits / resolution >=
    getStopOverlapReleaseRadius(iconSize)
  ) {
    return [0, 0];
  }

  const naturalOffsetPixels: Coordinate = [
    (coordinate[0] - layout.center[0]) / resolution,
    (coordinate[1] - layout.center[1]) / resolution,
  ];
  const targetRadiusScale =
    getStopOverlapDisplayRadius(iconSize) /
    STOP_OVERLAP_DISPLAY_RADIUS_PIXELS;

  return [
    layout.targetOffsetPixels[0] * targetRadiusScale - naturalOffsetPixels[0],
    layout.targetOffsetPixels[1] * targetRadiusScale - naturalOffsetPixels[1],
  ];
}

/**
 * Locally bundled vector symbols remain sharp on high-density displays while
 * preserving the familiar Swiss public-transport map language.
 */
const MODE_ICON_URLS: Record<PublicTransportMode, string> = {
  train: trainIconUrl,
  // Metro keeps its own popup label but uses the clear railway map symbol.
  metro: trainIconUrl,
  tram: tramIconUrl,
  bus: busIconUrl,
  boat: boatIconUrl,
  cableCar: cableCarIconUrl,
  chairlift: chairliftIconUrl,
  funicular: funicularIconUrl,
};

/** Cached icon variants keyed by mode, displacement, and CSS-pixel size. */
const MODE_STYLES = new Map<string, Style>();

/** Returns a zoom-aware mode style with one rounded pixel displacement. */
function getModeStyle(
  mode: PublicTransportMode,
  displacement: Coordinate,
  iconSize: number,
): Style {
  const roundedDisplacement: Coordinate = [
    Math.round(displacement[0]),
    Math.round(displacement[1]),
  ];
  const key = `${mode}:${iconSize}:${roundedDisplacement[0]}:${roundedDisplacement[1]}`;
  const cached = MODE_STYLES.get(key);

  if (cached) {
    return cached;
  }

  const style = new Style({
    image: new Icon({
      src: MODE_ICON_URLS[mode],
      width: iconSize,
      height: iconSize,
      displacement: roundedDisplacement,
    }),
  });
  MODE_STYLES.set(key, style);
  return style;
}

/** Cached selection-halo variants aligned with displaced stop symbols. */
const SELECTED_STOP_STYLES = new Map<string, Style>();

/** Returns the selected-stop halo for one displacement and icon size. */
function getSelectedStopStyle(
  displacement: Coordinate,
  iconSize: number,
): Style {
  const roundedDisplacement: Coordinate = [
    Math.round(displacement[0]),
    Math.round(displacement[1]),
  ];
  const key = `${iconSize}:${roundedDisplacement[0]}:${roundedDisplacement[1]}`;
  const cached = SELECTED_STOP_STYLES.get(key);

  if (cached) {
    return cached;
  }

  const style = new Style({
    image: new CircleStyle({
      radius: iconSize / 2 + 4.5,
      displacement: roundedDisplacement,
      fill: new Fill({ color: 'rgba(255, 255, 255, 0.88)' }),
      stroke: new Stroke({ color: '#1769e0', width: 3 }),
    }),
  });
  SELECTED_STOP_STYLES.set(key, style);
  return style;
}

/** Creates the persistent vector layers for filtered and selected stops. */
export function createPublicTransportStopsDisplay(): PublicTransportStopsDisplay {
  const source = new VectorSource<Feature<Point>>({
    attributions: PUBLIC_TRANSPORT_STOPS_ATTRIBUTION,
  });
  const selectionSource = new VectorSource<Feature<Point>>();
  const selectionLayer = new VectorLayer({
    source: selectionSource,
    minZoom: PUBLIC_TRANSPORT_STOPS_MIN_ZOOM,
    zIndex: 14,
    style: (feature, resolution) => {
      const iconSize = getStopIconSize(resolution);
      const geometry = feature.getGeometry();
      const coordinate =
        geometry instanceof Point ? geometry.getCoordinates() : null;
      const displacement = coordinate
        ? calculateStopDisplacement(
            coordinate,
            getStopOverlapLayout(feature),
            resolution,
            iconSize,
          )
        : [0, 0];
      return getSelectedStopStyle(displacement, iconSize);
    },
  });
  const layer = new VectorLayer({
    source,
    minZoom: PUBLIC_TRANSPORT_STOPS_MIN_ZOOM,
    zIndex: 15,
    style: (feature, resolution) => {
      const stop = getPublicTransportStopFromFeature(feature);

      if (!stop) {
        return undefined;
      }

      const iconSize = getStopIconSize(resolution);
      const displacement = calculateStopDisplacement(
        stop.coordinate,
        getStopOverlapLayout(feature),
        resolution,
        iconSize,
      );
      return getModeStyle(
        getPrimaryPublicTransportMode(stop.modes),
        displacement,
        iconSize,
      );
    },
  });

  return { layer, source, selectionLayer, selectionSource };
}

/** Replaces visible features after one completed viewport load. */
export function updatePublicTransportStopsDisplay(
  display: PublicTransportStopsDisplay,
  stops: PublicTransportStop[],
): void {
  const overlapLayouts = createStopOverlapLayouts(stops);
  const features = stops.map((stop) => {
    const feature = new Feature<Point>({
      geometry: new Point(stop.coordinate),
    });
    feature.setId(stop.id);
    feature.set(STOP_PROPERTY_NAME, stop);

    const overlapLayout = overlapLayouts.get(stop.id);

    if (overlapLayout) {
      feature.set(STOP_OVERLAP_LAYOUT_PROPERTY_NAME, overlapLayout);
    }

    return feature;
  });

  display.source.clear();
  display.source.addFeatures(features);
}

/** Updates the selected-stop halo without changing loaded stop features. */
export function updatePublicTransportStopSelection(
  display: PublicTransportStopsDisplay,
  stop: PublicTransportStop | null,
): void {
  display.selectionSource.clear();

  if (!stop) {
    return;
  }

  const selectionFeature = new Feature<Point>({
    geometry: new Point(stop.coordinate),
  });
  const sourceFeature = display.source.getFeatureById(stop.id);
  const overlapLayout = sourceFeature?.get(
    STOP_OVERLAP_LAYOUT_PROPERTY_NAME,
  ) as unknown;

  if (overlapLayout) {
    selectionFeature.set(STOP_OVERLAP_LAYOUT_PROPERTY_NAME, overlapLayout);
  }

  display.selectionSource.addFeature(selectionFeature);
}

/** Reads structured stop metadata from one feature hit by OpenLayers. */
export function getPublicTransportStopFromFeature(
  feature: FeatureLike,
): PublicTransportStop | null {
  const value = feature.get(STOP_PROPERTY_NAME) as unknown;

  if (!value || typeof value !== 'object') {
    return null;
  }

  const stop = value as Partial<PublicTransportStop>;
  return typeof stop.name === 'string' &&
    Array.isArray(stop.modes) &&
    typeof stop.stationId === 'string'
    ? (stop as PublicTransportStop)
    : null;
}

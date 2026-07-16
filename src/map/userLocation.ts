/**
 * Business context: displays the browser's explicitly requested geolocation as
 * a temporary map marker. The dedicated layer keeps this privacy-sensitive
 * position independent from search results and editable route geometry.
 */
import type { Coordinate } from 'ol/coordinate.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import {
  Circle as CircleStyle,
  Fill,
  Stroke,
  Style,
} from 'ol/style.js';

/** OpenLayers objects retained while the user's current position is displayed. */
export interface UserLocationMarker {
  /** Point feature updated only after a successful browser geolocation request. */
  feature: Feature<Point>;
  /** Dedicated layer kept above ordinary route and search-result rendering. */
  layer: VectorLayer<VectorSource<Feature<Point>>>;
}

/**
 * Creates a hidden vector marker that can later receive the user's position.
 * @returns The mutable point feature and its dedicated vector layer.
 */
export function createUserLocationMarker(): UserLocationMarker {
  const feature = new Feature<Point>();
  const source = new VectorSource<Feature<Point>>({
    features: [feature],
  });

  const layer = new VectorLayer({
    source,
    zIndex: 20,
    style: new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({
          color: '#1769e0',
        }),
        stroke: new Stroke({
          color: '#ffffff',
          width: 3,
        }),
      }),
    }),
  });

  return {
    feature,
    layer,
  };
}

/**
 * Moves the user-location marker to a projected map coordinate.
 * @param marker - Marker objects created by `createUserLocationMarker()`.
 * @param coordinate - Browser position transformed into the current map projection.
 */
export function updateUserLocationMarker(
  marker: UserLocationMarker,
  coordinate: Coordinate,
): void {
  marker.feature.setGeometry(new Point(coordinate));
}

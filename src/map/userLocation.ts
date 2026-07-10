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

export interface UserLocationMarker {
  feature: Feature<Point>;
  layer: VectorLayer<VectorSource<Feature<Point>>>;
}

/**
 * Creates a hidden vector marker that can later receive the user's position.
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
 */
export function updateUserLocationMarker(
  marker: UserLocationMarker,
  coordinate: Coordinate,
): void {
  marker.feature.setGeometry(new Point(coordinate));
}

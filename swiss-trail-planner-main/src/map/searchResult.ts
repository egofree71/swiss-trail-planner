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

export interface SearchResultMarker {
  feature: Feature<Point>;
  layer: VectorLayer<VectorSource<Feature<Point>>>;
}

/**
 * Creates the marker used for the currently selected search result.
 */
export function createSearchResultMarker(): SearchResultMarker {
  const feature = new Feature<Point>();
  const source = new VectorSource<Feature<Point>>({
    features: [feature],
  });

  const layer = new VectorLayer({
    source,
    zIndex: 19,
    style: [
      new Style({
        image: new CircleStyle({
          radius: 9,
          fill: new Fill({
            color: '#d53c3c',
          }),
          stroke: new Stroke({
            color: '#ffffff',
            width: 3,
          }),
        }),
      }),
      new Style({
        image: new CircleStyle({
          radius: 2.5,
          fill: new Fill({
            color: '#ffffff',
          }),
        }),
      }),
    ],
  });

  return {
    feature,
    layer,
  };
}

/**
 * Moves the search-result marker to a projected map coordinate.
 */
export function updateSearchResultMarker(
  marker: SearchResultMarker,
  coordinate: Coordinate,
): void {
  marker.feature.setGeometry(new Point(coordinate));
}

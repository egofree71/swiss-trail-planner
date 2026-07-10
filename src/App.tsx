import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { defaults as defaultControls, ScaleLine } from 'ol/control.js';
import TileLayer from 'ol/layer/Tile.js';
import {
  createSwissTopoRasterSource,
  DEFAULT_MAP_CENTER,
  MAP_EXTENT,
  MAP_ZOOM,
} from './map/config';

type LoadStatus = 'loading' | 'ready' | 'error';

export default function App() {
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const target = mapTargetRef.current;

    if (!target) {
      return;
    }

    const rasterSource = createSwissTopoRasterSource();

    /*
     * OpenLayers has its own imperative lifecycle. This effect is the sole
     * owner of the map instance, so it also removes listeners and detaches
     * the DOM target when the React component is unmounted.
     */
    let firstTileLoaded = false;

    const handleTileLoaded = () => {
      if (firstTileLoaded) {
        return;
      }

      firstTileLoaded = true;
      setStatus('ready');
      setErrorMessage('');
    };

    const handleTileError = () => {
      /*
       * A late failure affecting a single tile should not hide a map that is
       * already usable. The error screen only represents an initial failure.
       */
      if (firstTileLoaded) {
        return;
      }

      setStatus('error');
      setErrorMessage(
        'Le navigateur n’a pas réussi à télécharger les tuiles swisstopo.',
      );
    };

    rasterSource.on('tileloadend', handleTileLoaded);
    rasterSource.on('tileloaderror', handleTileError);

    const map = new Map({
      target,
      layers: [
        new TileLayer({
          source: rasterSource,
        }),
      ],
      view: new View({
        center: DEFAULT_MAP_CENTER,
        zoom: MAP_ZOOM.initial,
        minZoom: MAP_ZOOM.minimum,
        maxZoom: MAP_ZOOM.maximum,
        extent: MAP_EXTENT,
        constrainOnlyCenter: false,
        smoothExtentConstraint: false,
      }),
      controls: defaultControls().extend([
        new ScaleLine({
          units: 'metric',
          bar: true,
          text: true,
          minWidth: 120,
        }),
      ]),
    });

    return () => {
      rasterSource.un('tileloadend', handleTileLoaded);
      rasterSource.un('tileloaderror', handleTileError);
      map.setTarget(undefined);
    };
  }, []);

  return (
    <main className="app">
      <div
        ref={mapTargetRef}
        className="map"
        aria-label="Carte nationale suisse interactive"
      />

      {status === 'loading' && (
        <div className="status-card" role="status">
          Chargement de la carte swisstopo…
        </div>
      )}

      {status === 'error' && (
        <div className="status-card status-card--error" role="alert">
          <strong>Impossible de charger la carte.</strong>
          <span>{errorMessage}</span>
          <span>Vérifie la connexion Internet, puis recharge la page.</span>
        </div>
      )}
    </main>
  );
}

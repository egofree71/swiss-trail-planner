/**
 * Business context: bridges React's component lifecycle with the imperative
 * OpenLayers runtime. It creates the single Via Helvetica map after the target
 * element mounts, synchronizes browser fullscreen state, and guarantees that
 * map listeners and the DOM target are released on unmount.
 */
import { useEffect, useRef, type RefObject } from 'react';
import {
  createMapRuntime,
  type MapLoadStatus,
  type MapRuntime,
  type MapRuntimeVisibility,
} from './mapRuntime';

/** React-facing options needed to own the single OpenLayers runtime. */
export interface UseMapRuntimeOptions {
  /** Mounted div that receives the OpenLayers map. */
  mapTargetRef: RefObject<HTMLDivElement | null>;
  /** Application root used to identify this app's fullscreen state. */
  fullscreenElementRef: RefObject<HTMLElement | null>;
  /** Persisted overlay choices captured when the runtime is first created. */
  initialVisibility: MapRuntimeVisibility;
  /** Receives initial base-map loading changes. */
  onLoadStatusChange: (status: MapLoadStatus) => void;
  /** Keeps the React fullscreen button synchronized with browser events. */
  onFullscreenChange: (isFullscreen: boolean) => void;
}

/**
 * Owns the OpenLayers runtime for the lifetime of one mounted application.
 *
 * @param options - DOM refs, initial visibility, and React state callbacks.
 * @returns A stable ref containing the runtime after the map target mounts.
 */
export function useMapRuntime(options: UseMapRuntimeOptions) {
  const runtimeRef = useRef<MapRuntime | null>(null);
  // Later React renders carry updated visibility state, but recreating the map
  // would discard its view and interactions. Only construction options are kept.
  const initialOptionsRef = useRef(options);

  useEffect(() => {
    const initialOptions = initialOptionsRef.current;
    const target = initialOptions.mapTargetRef.current;

    if (!target) {
      return;
    }

    const runtime = createMapRuntime({
      target,
      visibility: initialOptions.initialVisibility,
      onLoadStatusChange: initialOptions.onLoadStatusChange,
    });
    runtimeRef.current = runtime;

    const handleFullscreenChange = () => {
      initialOptions.onFullscreenChange(
        document.fullscreenElement ===
          initialOptions.fullscreenElementRef.current,
      );

      // Fullscreen changes the available viewport; OpenLayers must recalculate
      // its canvas after the browser has applied the new dimensions.
      window.requestAnimationFrame(() => runtime.map.updateSize());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener(
        'fullscreenchange',
        handleFullscreenChange,
      );
      runtime.dispose();

      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, []);

  return runtimeRef;
}

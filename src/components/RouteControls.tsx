/**
 * Business context: renders the compact route-editing toolbar without taking
 * permanent space away from the map. It exposes route-mode state, undo/redo,
 * the straight-versus-network choice, and placeholders for later route actions.
 */
/** Controlled state and actions for the route-editing toolbar. */
interface RouteControlsProps {
  /** Whether map clicks currently create route waypoints. */
  isActive: boolean;
  /** Whether new segments use swissTLM3D routing instead of straight lines. */
  isSnapEnabled: boolean;
  /** Whether a snap or route request is currently in progress. */
  isBusy: boolean;
  /** Whether at least one applied route step can be undone. */
  canUndo: boolean;
  /** Whether at least one previously undone step can be restored. */
  canRedo: boolean;
  /** Enters or leaves route-creation mode. */
  onToggle: () => void;
  /** Removes the latest applied route step. */
  onUndo: () => void;
  /** Restores the latest undone route step. */
  onRedo: () => void;
  /** Switches between network routing and direct segments. */
  onToggleSnap: () => void;
}

/**
 * Displays route controls and reflects active/busy states through accessible
 * button labels as well as visual styling.
 */
export default function RouteControls({
  isActive,
  isSnapEnabled,
  isBusy,
  canUndo,
  canRedo,
  onToggle,
  onUndo,
  onRedo,
  onToggleSnap,
}: RouteControlsProps) {
  const toggleLabel = isActive
    ? 'Quitter le mode création d’itinéraire'
    : 'Créer un itinéraire';

  const snapLabel = isSnapEnabled
    ? 'Suivre les chemins de randonnée'
    : 'Ajouter des segments linéaires';

  return (
    <div
      className="route-controls"
      role="toolbar"
      aria-label="Itinéraire"
      aria-busy={isBusy}
    >
      {isActive && (
        <div className="route-action-controls">
          <button
            type="button"
            className="map-control-button map-control-button--route-action"
            aria-label="Annuler la dernière modification"
            title="Annuler"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 7 4 12l5 5" />
              <path d="M5 12h8a6 6 0 0 1 6 6" />
            </svg>
          </button>

          <button
            type="button"
            className="map-control-button map-control-button--route-action"
            aria-label="Refaire la dernière modification"
            title="Refaire"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m15 7 5 5-5 5" />
              <path d="M19 12h-8a6 6 0 0 0-6 6" />
            </svg>
          </button>

          <button
            type="button"
            className={[
              'map-control-button',
              'map-control-button--route-action',
              isSnapEnabled ? 'map-control-button--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={snapLabel}
            aria-pressed={isSnapEnabled}
            title={snapLabel}
            disabled={isBusy}
            onClick={onToggleSnap}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M6 3.75v4.75" />
              <path d="M14 3.75v4.75" />
              <path d="M6 8.5a4 4 0 1 0 8 0" />
            </svg>
          </button>

          <button
            type="button"
            className="map-control-button map-control-button--route-action"
            aria-label="Inverser le parcours"
            title="Inverser le parcours"
            disabled
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 7h12" />
              <path d="m14 4 4 3-4 3" />
              <path d="M19 17H7" />
              <path d="m10 14-4 3 4 3" />
            </svg>
          </button>

          <button
            type="button"
            className="map-control-button map-control-button--route-action"
            aria-label="Supprimer l’itinéraire"
            title="Supprimer l’itinéraire"
            disabled
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M3 5.5h14" />
              <path d="M7.2 3.75h5.6" />
              <path d="M6 5.5v-1a1.8 1.8 0 0 1 1.8-1.8h4.4A1.8 1.8 0 0 1 14 4.5v1" />
              <path d="M5.1 5.5l0.95 11a1.7 1.7 0 0 0 1.7 1.55h4.5a1.7 1.7 0 0 0 1.7-1.55l0.95-11" />
              <path d="M8 8.5v6.5" />
              <path d="M10 8.5v6.5" />
              <path d="M12 8.5v6.5" />
            </svg>
          </button>

          <button
            type="button"
            className="map-control-button map-control-button--route-action"
            aria-label="Exporter l’itinéraire"
            title="Exporter l’itinéraire"
            disabled
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 3v12" />
              <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
              <path d="M5 18v2h14v-2" />
            </svg>
          </button>
        </div>
      )}

      <button
        type="button"
        className={[
          'map-control-button',
          'map-control-button--route-toggle',
          isActive ? 'map-control-button--route-active' : '',
          isBusy ? 'map-control-button--route-loading' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={toggleLabel}
        aria-pressed={isActive}
        aria-busy={isBusy}
        title={toggleLabel}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="5.8" cy="17.8" r="2.1" />
          <circle cx="18.2" cy="6.2" r="2.1" />
          <path
            className="route-icon-line"
            d="M8.7 16.7h6a2.4 2.4 0 0 0 0-4.8h-4.2a2.4 2.4 0 0 1 0-4.8h4.7"
          />
        </svg>
      </button>
    </div>
  );
}

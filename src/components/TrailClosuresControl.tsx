/**
 * Business context: exposes current hiking closures and detours through one
 * compact overlay toggle so safety information remains discoverable without a
 * permanent toolbar or panel covering the map.
 */
import { useI18n } from '../i18n/I18nContext';

/** Controlled visibility state for the official closure overlay. */
interface TrailClosuresControlProps {
  /** Whether the WMS closure and detour layer is currently visible. */
  isActive: boolean;
  /** Shows or hides the overlay. */
  onToggle: () => void;
}

/** Renders the road-barrier toggle for the official operational overlay. */
export default function TrailClosuresControl({
  isActive,
  onToggle,
}: TrailClosuresControlProps) {
  const { t } = useI18n();
  const label = isActive
    ? t('closures.hide')
    : t('closures.show');

  return (
    <div className="trail-closures-control">
      <button
        type="button"
        className={[
          'map-control-button',
          'map-control-button--trail-closures',
          isActive ? 'map-control-button--overlay-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={label}
        aria-pressed={isActive}
        title={label}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 20v-5M19 20v-5" />
          <path d="M3.5 8h17v7h-17z" />
          <path d="m7 8-3.5 5.5M12 8l-4.5 7M17 8l-4.5 7M20.5 10l-3.2 5" />
        </svg>
      </button>
    </div>
  );
}

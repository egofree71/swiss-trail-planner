/**
 * Business context: lets hikers switch the map background without introducing
 * a permanent toolbar. The temporary menu keeps the map visible while making
 * the aerial-photo background easy to discover.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { BaseMapStyle } from '../map/config';

/** Controlled value and change callback for the base-map picker. */
interface BaseMapSelectorProps {
  /** Background currently displayed by the OpenLayers base layer. */
  value: BaseMapStyle;
  /** Replaces the current background while preserving all overlay layers. */
  onChange: (style: BaseMapStyle) => void;
}

/** One selectable background and its translated label key. */
interface BaseMapOption {
  value: BaseMapStyle;
  labelKey:
    | 'map.baseMap.color'
    | 'map.baseMap.gray'
    | 'map.baseMap.aerial';
}

const BASE_MAP_OPTIONS: BaseMapOption[] = [
  { value: 'color', labelKey: 'map.baseMap.color' },
  { value: 'gray', labelKey: 'map.baseMap.gray' },
  { value: 'aerial', labelKey: 'map.baseMap.aerial' },
];

/** Renders a compact button that opens a temporary three-choice menu. */
export default function BaseMapSelector({
  value,
  onChange,
}: BaseMapSelectorProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const label = t('map.baseMap.select');

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="base-map-selector" ref={rootRef}>
      <button
        type="button"
        className={[
          'map-control-button',
          'map-control-button--base-map',
          isOpen ? 'map-control-button--menu-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={label}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={label}
        onClick={() => setIsOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
          <path d="m4 12 8 4.5 8-4.5" />
          <path d="m4 16.5 8 4.5 8-4.5" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="base-map-menu"
          role="menu"
          aria-label={label}
        >
          {BASE_MAP_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            const optionLabel = t(option.labelKey);

            return (
              <button
                key={option.value}
                type="button"
                className={[
                  'base-map-option',
                  isSelected ? 'base-map-option--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <span
                  className={`base-map-option-preview base-map-option-preview--${option.value}`}
                  aria-hidden="true"
                />
                <span>{optionLabel}</span>
                {isSelected && (
                  <svg
                    className="base-map-option-check"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

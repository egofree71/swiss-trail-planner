/**
 * Business context: asks for the route name before GPX generation so the
 * downloaded filename and the track name imported by external applications
 * remain consistent. The dialog is temporary and keeps the map-focused layout
 * free of permanent form controls.
 */
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/I18nContext';

/** Controlled visibility and callbacks for the route-export dialog. */
interface RouteExportDialogProps {
  /** Whether the modal export dialog should be displayed. */
  isOpen: boolean;
  /** Localized name proposed when the dialog opens. */
  defaultName: string;
  /** Closes the dialog without exporting. */
  onCancel: () => void;
  /** Exports the route with the trimmed name entered by the user. */
  onConfirm: (routeName: string) => void;
}

/** Maximum route-name length accepted by the export form. */
const ROUTE_NAME_MAX_LENGTH = 120;

/** Renders an accessible modal form for naming a GPX route before download. */
export default function RouteExportDialog({
  isOpen,
  defaultName,
  onCancel,
  onConfirm,
}: RouteExportDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const openingNameRef = useRef(defaultName);
  const selectionPendingRef = useRef(false);
  const [routeName, setRouteName] = useState(defaultName);

  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      openingNameRef.current = defaultName;
      selectionPendingRef.current = true;
      setRouteName(defaultName);
    }
  }, [defaultName, isOpen]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (!isOpen) {
      selectionPendingRef.current = false;

      if (dialog.open) {
        dialog.close();
      }

      return;
    }

    // Wait for the controlled input to contain the new proposal. Selecting it
    // before React commits that value would move the caret back to the end.
    if (routeName !== openingNameRef.current) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    if (!selectionPendingRef.current) {
      return;
    }

    const input = inputRef.current;

    if (!input) {
      return;
    }

    input.focus({ preventScroll: true });
    input.setSelectionRange(0, input.value.length);
    selectionPendingRef.current = false;
  }, [isOpen, routeName]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = routeName.trim();

    if (trimmedName) {
      onConfirm(trimmedName);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="route-export-dialog"
      aria-labelledby="route-export-dialog-title"
      aria-describedby="route-export-dialog-hint"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <form className="route-export-dialog-form" onSubmit={submit}>
        <h2 id="route-export-dialog-title">{t('route.export')}</h2>

        <label htmlFor="route-export-name">{t('gpx.nameLabel')}</label>
        <input
          ref={inputRef}
          id="route-export-name"
          type="text"
          value={routeName}
          maxLength={ROUTE_NAME_MAX_LENGTH}
          autoComplete="off"
          required
          onChange={(event) => setRouteName(event.target.value)}
        />
        <p id="route-export-dialog-hint">{t('gpx.nameHint')}</p>

        <div className="route-export-dialog-actions">
          <button
            type="button"
            className="route-export-dialog-button route-export-dialog-button--secondary"
            onClick={onCancel}
          >
            {t('gpx.cancel')}
          </button>
          <button
            type="submit"
            className="route-export-dialog-button route-export-dialog-button--primary"
            disabled={!routeName.trim()}
          >
            {t('route.export')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

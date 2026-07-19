/**
 * Interaction regression tests for the GPX export dialog. They protect the
 * initial whole-name selection so typing replaces the generated proposal.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nContext';
import RouteExportDialog from './RouteExportDialog';

describe('RouteExportDialog initial selection', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let originalShowModal: PropertyDescriptor | undefined;
  let originalClose: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.localStorage.setItem('via-helvetica-language', 'en');

    originalShowModal = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      'showModal',
    );
    originalClose = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      'close',
    );

    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container.remove();

    if (originalShowModal) {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        'showModal',
        originalShowModal,
      );
    } else {
      delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>)
        .showModal;
    }

    if (originalClose) {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        'close',
        originalClose,
      );
    } else {
      delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    }

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('selects the complete generated name after React commits its value', async () => {
    const renderDialog = async (isOpen: boolean, defaultName: string) => {
      await act(async () => {
        root?.render(
          createElement(
            I18nProvider,
            null,
            createElement(RouteExportDialog, {
              isOpen,
              defaultName,
              onCancel: vi.fn(),
              onConfirm: vi.fn(),
            }),
          ),
        );
      });
    };

    await renderDialog(false, 'Previous route');
    const generatedName = 'Via Helvetica route — 2026-07-19 22:00';
    await renderDialog(true, generatedName);

    const input = container.querySelector<HTMLInputElement>(
      '#route-export-name',
    );

    expect(input).not.toBeNull();
    expect(input?.value).toBe(generatedName);
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(generatedName.length);
  });
});

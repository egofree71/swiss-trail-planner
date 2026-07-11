/**
 * Business context: owns the selected interface language, persists the user's
 * choice, and exposes a small typed translation API without adding a runtime
 * internationalization dependency to this map-focused application.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  LANGUAGE_METADATA,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
  type Language,
  type TranslationKey,
} from './translations';

/** Local-storage key used to preserve the explicit language selection. */
const LANGUAGE_STORAGE_KEY = 'swiss-trail-planner-language';

/** Named values substituted into translated strings such as profile ranges. */
type TranslationParameters = Record<string, string | number>;

/** Public language state and translation helpers. */
interface I18nContextValue {
  /** Currently selected interface language. */
  language: Language;
  /** Swiss locale used by Intl number formatting. */
  locale: string;
  /** Changes and persists the interface language. */
  setLanguage: (language: Language) => void;
  /** Returns one translated string with optional named substitutions. */
  t: (key: TranslationKey, parameters?: TranslationParameters) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Tests whether an arbitrary value is one of the supported language codes. */
export function isSupportedLanguage(value: string): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

/**
 * Resolves a browser language tag such as `de-CH` to the application's
 * two-letter language code.
 */
function languageFromTag(tag: string): Language | null {
  const language = tag.toLowerCase().split('-')[0];
  return isSupportedLanguage(language) ? language : null;
}

/** Uses the persisted choice first, then browser preferences, then English. */
function resolveInitialLanguage(): Language {
  try {
    const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);

    if (storedLanguage && isSupportedLanguage(storedLanguage)) {
      return storedLanguage;
    }
  } catch {
    // Storage can be unavailable in strict privacy contexts; detection still works.
  }

  for (const browserLanguage of navigator.languages ?? [navigator.language]) {
    const supportedLanguage = languageFromTag(browserLanguage);

    if (supportedLanguage) {
      return supportedLanguage;
    }
  }

  return 'en';
}

/** Substitutes `{name}` placeholders while leaving unknown placeholders intact. */
function interpolate(
  template: string,
  parameters: TranslationParameters = {},
): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder,
  );
}

/** Provides language state and translated strings to the complete application. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(resolveInitialLanguage);

  const t = useCallback(
    (key: TranslationKey, parameters?: TranslationParameters) =>
      interpolate(TRANSLATIONS[language][key], parameters),
    [language],
  );

  useEffect(() => {
    document.documentElement.lang = language;

    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );

    if (description) {
      description.content = t('app.description');
    }

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Language switching must remain usable even if persistence is blocked.
    }
  }, [language, t]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      locale: LANGUAGE_METADATA[language].locale,
      setLanguage,
      t,
    }),
    [language, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Returns the nearest language provider and fails fast if wiring is missing. */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider.');
  }

  return context;
}

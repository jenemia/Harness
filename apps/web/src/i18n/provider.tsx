import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  messages,
  supportedLocales,
  type MessageKey,
  type SupportedLocale,
} from "./messages";

const localeStorageKey = "harness.interface-locale";

export function resolveSupportedLocale(
  languages: readonly string[],
): SupportedLocale {
  for (const language of languages) {
    const baseLanguage = language.toLowerCase().split("-")[0];
    if (supportedLocales.some((locale) => locale.code === baseLanguage)) {
      return baseLanguage as SupportedLocale;
    }
  }
  return "en";
}

function readInitialLocale(): SupportedLocale {
  try {
    const stored = window.localStorage.getItem(localeStorageKey);
    if (supportedLocales.some((locale) => locale.code === stored)) {
      return stored as SupportedLocale;
    }
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
  return resolveSupportedLocale(
    window.navigator.languages?.length
      ? window.navigator.languages
      : [window.navigator.language],
  );
}

function interpolate(
  message: string,
  values?: Record<string, string | number>,
) {
  if (!values) {
    return message;
  }
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    message,
  );
}

type I18nContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<SupportedLocale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(localeStorageKey, locale);
    } catch {
      // Keep the in-memory selection when persistence is unavailable.
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => interpolate(messages[locale][key], values),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside LanguageProvider.");
  }
  return context;
}

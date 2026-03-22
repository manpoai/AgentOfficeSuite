'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import zh from './locales/zh.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';

export type Locale = 'zh' | 'en' | 'ja' | 'ko';

const LOCALES: Record<Locale, Record<string, any>> = { zh, en, ja, ko };

export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

const STORAGE_KEY = 'asuite-locale';

function getNestedValue(obj: any, path: string): string {
  const keys = path.split('.');
  let val = obj;
  for (const k of keys) {
    if (val == null) return path;
    val = val[k];
  }
  return typeof val === 'string' ? val : path;
}

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'zh',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && saved in LOCALES) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    let str = getNestedValue(LOCALES[locale], key);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v));
      });
    }
    return str;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  return useContext(I18nContext);
}

/**
 * Get a translation function for non-React contexts (ProseMirror plugins).
 * Reads the current locale from localStorage and returns translated strings.
 */
export function getT(): (key: string, params?: Record<string, string | number>) => string {
  let locale: Locale = 'zh';
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && saved in LOCALES) locale = saved;
  } catch {}
  return (key: string, params?: Record<string, string | number>) => {
    let str = getNestedValue(LOCALES[locale], key);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v));
      });
    }
    return str;
  };
}

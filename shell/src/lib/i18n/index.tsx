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

const STORAGE_KEY = 'aose-locale';

function getNestedValue(obj: any, path: string, returnObjects = false): any {
  const keys = path.split('.');
  let val = obj;
  for (const k of keys) {
    if (val == null) return path;
    val = val[k];
  }
  if (returnObjects && (Array.isArray(val) || (typeof val === 'object' && val !== null))) return val;
  if (typeof val !== 'string') {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] Missing key: "${path}"`);
    }
    return path;
  }
  return val;
}

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number | boolean>) => any;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

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

  const t = useCallback((key: string, params?: Record<string, string | number | boolean>): any => {
    const returnObjects = !!(params && 'returnObjects' in params && params.returnObjects);
    const val = getNestedValue(LOCALES[locale], key, returnObjects);
    if (returnObjects && typeof val !== 'string') return val;
    let str = val as string;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (k === 'returnObjects') return;
        str = str.replaceAll(`{${k}}`, String(v));
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
        str = str.replaceAll(`{${k}}`, String(v));
      });
    }
    return str;
  };
}

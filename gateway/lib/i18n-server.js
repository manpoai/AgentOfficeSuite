/**
 * Server-side i18n renderer.
 *
 * Loads locale JSON files from gateway/locales/ (copied at build time from
 * shell/src/lib/i18n/locales/) and renders dot-path keys with {{var}}
 * interpolation. Falls back to English when key/language missing; returns
 * the raw key when no locale provides it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const DEFAULT_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'zh', 'ja', 'ko'];

const dicts = {};

function loadDict(lang) {
  if (dicts[lang] !== undefined) return dicts[lang];
  const file = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    dicts[lang] = JSON.parse(raw);
  } catch {
    dicts[lang] = null;
  }
  return dicts[lang];
}

function resolveKey(dict, key) {
  if (!dict) return undefined;
  const parts = key.split('.');
  let node = dict;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[p];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(tpl, params) {
  if (!params) return tpl;
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
    params[name] != null ? String(params[name]) : `{{${name}}}`
  );
}

/**
 * Render a localized string.
 * @param {string} lang - target language (e.g. 'en', 'zh'); falls back to en on miss
 * @param {string} key - dot-path key (e.g. 'notifications.doc_created.title')
 * @param {object} [params] - interpolation params for {{var}} placeholders
 * @returns {string}
 */
export function tServer(lang, key, params) {
  if (!key) return '';
  const primary = loadDict(SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG);
  let tpl = resolveKey(primary, key);
  if (tpl === undefined && lang !== DEFAULT_LANG) {
    tpl = resolveKey(loadDict(DEFAULT_LANG), key);
  }
  if (tpl === undefined) return key;
  return interpolate(tpl, params);
}

/** Reset cached dicts — for tests only. */
export function _resetI18nCache() {
  for (const k of Object.keys(dicts)) delete dicts[k];
}

export const DEFAULT_LANGUAGE = DEFAULT_LANG;
export { SUPPORTED_LANGS };

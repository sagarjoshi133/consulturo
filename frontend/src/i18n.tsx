import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en';
import hi from './locales/hi';
import gu from './locales/gu';

export type Lang = 'en' | 'hi' | 'gu';

const BUNDLES: Record<Lang, any> = { en, hi, gu };

const KEY = 'app_lang';

type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => Promise<void>;
  t: (key: string, vars?: Record<string, any>) => string;
  /** Return any value (array/object/string) at the given key, falling back to English. */
  tRaw: (key: string) => any;
};

const Ctx = createContext<I18nCtx>({
  lang: 'en',
  setLang: async () => {},
  t: (k) => k,
  tRaw: () => undefined,
});

function resolve(obj: any, path: string): any {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function format(str: string, vars?: Record<string, any>): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(KEY);
        if (v === 'en' || v === 'hi' || v === 'gu') setLangState(v);
      } catch {}
      setReady(true);
    })();
  }, []);

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l);
    try {
      await AsyncStorage.setItem(KEY, l);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, any>): string => {
      const bundle = BUNDLES[lang] || BUNDLES.en;
      let value = resolve(bundle, key);
      if (typeof value !== 'string') {
        value = resolve(BUNDLES.en, key);
      }
      if (typeof value !== 'string') return key;
      return format(value, vars);
    },
    [lang]
  );

  const tRaw = useCallback(
    (key: string): any => {
      const bundle = BUNDLES[lang] || BUNDLES.en;
      const v = resolve(bundle, key);
      if (v !== undefined && v !== null) return v;
      return resolve(BUNDLES.en, key);
    },
    [lang]
  );

  if (!ready) return null;
  return <Ctx.Provider value={{ lang, setLang, t, tRaw }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export const LANGS: { code: Lang; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
];

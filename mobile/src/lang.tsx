import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Lang } from './speakable';

/**
 * The app's language. Malay unless the person chose English on this phone.
 *
 * Both wordings are written side by side, `t('Dana', 'Fund')`, so neither can
 * be added without the other.
 */

const STORE_KEY = 'amanahtrack.lang';

let current: Lang = 'ms';

/** For code outside the screens, such as error messages from the API client. */
export const say = (ms: string, en: string) => (current === 'en' ? en : ms);
export const currentLang = () => current;

interface Ctx {
  lang: Lang;
  setLang(lang: Lang): void;
  t(ms: string, en: string): string;
}

const LangContext = createContext<Ctx>({ lang: 'ms', setLang() {}, t: (ms) => ms });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, set] = useState<Lang | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .catch(() => null)
      .then((v) => {
        current = v === 'en' ? 'en' : 'ms';
        set(current);
      });
  }, []);

  const setLang = useCallback((next: Lang) => {
    current = next;
    set(next);
    AsyncStorage.setItem(STORE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      lang: lang ?? 'ms',
      setLang,
      t: (ms: string, en: string) => (lang === 'en' ? en : ms),
    }),
    [lang, setLang],
  );

  if (lang === null) return null;
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

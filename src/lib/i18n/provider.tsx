'use client';

/**
 * 语言上下文
 *
 * 初始渲染固定用默认语言（中文），挂载后再读取已保存的选择 ——
 * 这样服务端与客户端的首屏 HTML 一致，不会出现 hydration mismatch。
 * 代价是「英文用户首帧看到中文」，几十毫秒，可接受。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  HTML_LANG,
  LOCALE_STORAGE_KEY,
  detectLocale,
  isLocale,
  translate,
  type Locale,
  type Translate,
} from './index';

interface I18nValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // 挂载后再对齐真实语言（localStorage → 浏览器语言）
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // 隐私模式下 localStorage 可能抛错，忽略即可
    }
    setLocaleState(detectLocale(saved, navigator.language));
  }, []);

  // 同步 <html lang>：影响读屏软件发音、浏览器的翻译提示与断词规则
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // 存不下也不影响本次会话
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 读取当前语言与翻译函数；未包 Provider 时回落到默认语言（不抛错） */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key, params) => translate(DEFAULT_LOCALE, key, params),
  };
}

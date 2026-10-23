/**
 * 国际化基础设施（无第三方依赖）
 *
 * 为什么不上 i18next / next-intl：
 *   本项目是本地离线优先的单页工具，语言切换只需「查表 + 占位符替换」。
 *   引一个 30–60 KB 的框架，换来的命名空间、复数规则、加载器全都用不上 ——
 *   与「任何超过 100 KB 的运行时依赖都要说明理由」的约定冲突。
 *
 * 支持范围（诚实说明）：
 *   - 语言：简体中文 / English；
 *   - 能力：查表、`{param}` 占位符、持久化、`<html lang>` 同步；
 *   - 不做：复数变化（英文仅有单复数差异时在词典里写成两句）、
 *     日期本地化（沿用 `toLocaleString`）、服务端渲染期的语言协商。
 */

import { DICTIONARIES, LOCALES, type Locale, type MessageKey } from './messages';

export { LOCALES, type Locale, type MessageKey };

/** localStorage 键名（与其它 zj 状态保持同一前缀风格） */
export const LOCALE_STORAGE_KEY = 'zhijianxia:locale';

/** 默认语言：中文（项目的主要用户群） */
export const DEFAULT_LOCALE: Locale = 'zh';

/** `<html lang>` 取值 */
export const HTML_LANG: Record<Locale, string> = { zh: 'zh-CN', en: 'en' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * 决定初始语言。
 *
 * 顺序：已保存的选择 → 浏览器语言 → 默认。
 * 只看语言前缀（`zh-CN` / `zh-TW` 都算中文），不区分简繁 —— 词典目前只有简体。
 */
export function detectLocale(saved?: string | null, navigatorLanguage?: string | null): Locale {
  if (isLocale(saved)) return saved;
  const nav = (navigatorLanguage ?? '').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav) return 'en';
  return DEFAULT_LOCALE;
}

/** 占位符替换：`{count}` → params.count */
export function formatMessage(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/** 查表并替换占位符；未知 key 返回 key 本身（便于发现漏配） */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  return formatMessage(dict[key] ?? key, params);
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

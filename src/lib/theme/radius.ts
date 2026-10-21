/**
 * 圆角（Radius）—— 全局独立的界面圆角设置。
 *
 * 圆角**不绑定主题包**：切换主题只改变配色、卡片风格、导航栏风格与壁纸，
 * 圆角由用户在「设置 · 个性化」中单独调整，切换主题时保持不变。
 */

import { RADIUS_PRESETS } from './types';

/** 圆角存储 key */
export const RADIUS_KEY = 'zj-radius';

/** 默认圆角（px） */
export const DEFAULT_RADIUS = 16;

/** 可选圆角档位 */
export const RADIUS_OPTIONS: { value: number; label: string; desc: string }[] = [
  { value: 0, label: '直角', desc: '完全直角，界面硬朗' },
  { value: 8, label: '小圆角', desc: '轻微圆角，紧凑利落' },
  { value: 12, label: '常规', desc: '默认圆角，兼顾观感与信息量' },
  { value: 16, label: '大圆角', desc: '圆润柔和，视觉更轻松' },
  { value: 20, label: '更大', desc: '大弧度卡片观感' },
  { value: 28, label: '胶囊', desc: '接近胶囊形，非常圆润' },
];

/** 读取当前圆角（px） */
export function readRadius(): number {
  if (typeof window === 'undefined') return DEFAULT_RADIUS;
  try {
    const raw = Number(window.localStorage.getItem(RADIUS_KEY));
    if (Number.isFinite(raw) && raw >= 0 && raw <= 48) return raw;
  } catch {
    /* 忽略 */
  }
  return DEFAULT_RADIUS;
}

/** 应用圆角到 <html> 的 CSS 变量 */
export function applyRadius(radius: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--zj-radius', `${radius}px`);
}

/** 持久化并应用圆角 */
export function saveRadius(radius: number) {
  if (typeof window === 'undefined') return;
  const value = Math.min(48, Math.max(0, Math.round(radius)));
  try {
    window.localStorage.setItem(RADIUS_KEY, String(value));
  } catch {
    /* 忽略 */
  }
  applyRadius(value);
}

export { RADIUS_PRESETS };

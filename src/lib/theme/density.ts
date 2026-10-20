/**
 * 界面密度（大 / 中 / 小）—— 全局字号与间距缩放。
 * 通过在 <html> 上设置 data-density 属性，CSS 变量随之变化。
 */

export type Density = 'sm' | 'md' | 'lg';

export const DENSITY_KEY = 'zj-density';

export const DENSITY_OPTIONS: { value: Density; label: string; desc: string }[] = [
  { value: 'sm', label: '小', desc: '紧凑显示，一屏容纳更多内容' },
  { value: 'md', label: '中', desc: '默认尺寸，兼顾信息量与可读性' },
  { value: 'lg', label: '大', desc: '放大字号与控件，阅读更轻松' },
];

/**
 * 各密度对应的根字号。
 * 当前界面默认为「小」（0.875rem），中/大依次放大。
 */
export const DENSITY_SCALE: Record<Density, string> = {
  sm: '0.875rem',
  md: '1rem',
  lg: '1.15rem',
};

/** 读取当前密度 */
export function readDensity(): Density {
  if (typeof window === 'undefined') return 'sm';
  try {
    const raw = window.localStorage.getItem(DENSITY_KEY);
    if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw;
  } catch {
    /* 忽略 */
  }
  return 'sm';
}

/** 应用密度到 <html> */
export function applyDensity(density: Density) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-density', density);
  root.style.setProperty('--zj-density-scale', DENSITY_SCALE[density]);
}

/** 持久化并应用密度 */
export function saveDensity(density: Density) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* 忽略 */
  }
  applyDensity(density);
}

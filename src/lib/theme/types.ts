/**
 * 主题包系统 —— 全局主题中心以「主题包」为最小管理单元。
 * 每个主题包含：名称、亮/暗模式、主色、辅助色、卡片背景色、文字色、圆角规则、阴影强度、壁纸资源。
 * 数据分层：LocalStorage（当前主题包 ID + 用户自定义包）与 IndexedDB（壁纸二进制资源）。
 */

/** 主题包定义 */
export interface ThemePack {
  id: string;
  name: string;
  /** 内置预设 or 用户自定义 */
  builtin: boolean;
  /** 亮色模式下的配色 */
  light: ThemeVariant;
  /** 暗色模式下的配色 */
  dark: ThemeVariant;
  /** 壁纸：内置纯色渐变 / 内置图片路径 / 用户自定义（存 IndexedDB，key=wallpaperId） */
  wallpaper?: {
    light?: WallpaperRef;
    dark?: WallpaperRef;
  };
  createdAt?: number;
}

export interface ThemeVariant {
  /** 主色 */
  accent: string;
  /** 辅助色（用于次级强调、标签底色） */
  accentSoft: string;
  /** 卡片背景色 */
  card: string;
  /** 页面背景色 */
  bg: string;
  /** 文字色 */
  fg: string;
  /** 次要文字色 */
  mutedFg: string;
  /** 边框色 */
  border: string;
  /** 圆角（px） */
  radius: number;
  /** 阴影强度 0-3 */
  shadow: 0 | 1 | 2 | 3;
}

export interface WallpaperRef {
  /** kind=gradient 使用 gradient 字段；kind=builtin 使用 url；kind=user 使用 IndexedDB key */
  kind: 'gradient' | 'builtin' | 'user' | 'none';
  gradient?: string;
  url?: string;
  /** 用户自定义壁画的 IndexedDB 主键 */
  storageKey?: string;
  /** 遮罩透明度 0-1 */
  veil?: number;
}

export const WALLPAPER_STORE = 'zj-wallpapers';

/** 圆角规则预设 */
export const RADIUS_PRESETS = [0, 8, 12, 16, 20, 28] as const;

/** 阴影强度预设 */
export const SHADOW_PRESETS: Record<0 | 1 | 2 | 3, { light: string; dark: string }> = {
  0: { light: 'none', dark: 'none' },
  1: {
    light: '0 1px 2px rgb(16 20 30 / 0.04)',
    dark: '0 1px 2px rgb(0 0 0 / 0.28)',
  },
  2: {
    light: '0 1px 2px rgb(16 20 30 / 0.04), 0 6px 18px rgb(16 20 30 / 0.04)',
    dark: '0 1px 2px rgb(0 0 0 / 0.3), 0 6px 18px rgb(0 0 0 / 0.22)',
  },
  3: {
    light: '0 2px 4px rgb(16 20 30 / 0.05), 0 12px 32px rgb(16 20 30 / 0.08)',
    dark: '0 2px 4px rgb(0 0 0 / 0.34), 0 12px 32px rgb(0 0 0 / 0.3)',
  },
};

/** 内置主题包预设 */
export const BUILTIN_THEME_PACKS: ThemePack[] = [
  {
    id: 'ink-default',
    name: '素墨',
    builtin: true,
    light: {
      accent: '#4f6bed',
      accentSoft: '#eef1fe',
      card: '#ffffff',
      bg: '#f6f7f9',
      fg: '#1c1f24',
      mutedFg: '#6b7280',
      border: '#e6e8ec',
      radius: 16,
      shadow: 2,
    },
    dark: {
      accent: '#7d93ff',
      accentSoft: '#1e2333',
      card: '#171a20',
      bg: '#0f1115',
      fg: '#e8eaed',
      mutedFg: '#9aa1ad',
      border: '#262b34',
      radius: 16,
      shadow: 2,
    },
    wallpaper: {
      light: { kind: 'gradient', gradient: 'linear-gradient(135deg,#eef1fe 0%,#f6f7f9 60%)', veil: 0.9 },
      dark: { kind: 'gradient', gradient: 'linear-gradient(135deg,#141824 0%,#0f1115 60%)', veil: 0.9 },
    },
  },
  {
    id: 'moss',
    name: '青苔',
    builtin: true,
    light: {
      accent: '#0f9d76',
      accentSoft: '#e4f6f0',
      card: '#ffffff',
      bg: '#f4f8f6',
      fg: '#16241f',
      mutedFg: '#5f7a71',
      border: '#e0eae6',
      radius: 20,
      shadow: 1,
    },
    dark: {
      accent: '#3ddc9a',
      accentSoft: '#152a24',
      card: '#141c19',
      bg: '#0c1210',
      fg: '#e4f1ec',
      mutedFg: '#8aa79d',
      border: '#22302b',
      radius: 20,
      shadow: 1,
    },
    wallpaper: {
      light: { kind: 'gradient', gradient: 'linear-gradient(160deg,#e4f6f0 0%,#f4f8f6 70%)', veil: 0.88 },
      dark: { kind: 'gradient', gradient: 'linear-gradient(160deg,#0f2019 0%,#0c1210 70%)', veil: 0.9 },
    },
  },
  {
    id: 'amber-dusk',
    name: '暮橙',
    builtin: true,
    light: {
      accent: '#e0761a',
      accentSoft: '#fdf0e3',
      card: '#ffffff',
      bg: '#faf7f3',
      fg: '#2a1f14',
      mutedFg: '#7d6c5b',
      border: '#ece3d8',
      radius: 12,
      shadow: 2,
    },
    dark: {
      accent: '#ffa04d',
      accentSoft: '#2c2115',
      card: '#1c1815',
      bg: '#12100e',
      fg: '#f4e9de',
      mutedFg: '#a08d7b',
      border: '#2e2822',
      radius: 12,
      shadow: 2,
    },
    wallpaper: {
      light: { kind: 'gradient', gradient: 'linear-gradient(140deg,#fdf0e3 0%,#faf7f3 70%)', veil: 0.88 },
      dark: { kind: 'gradient', gradient: 'linear-gradient(140deg,#241a10 0%,#12100e 70%)', veil: 0.92 },
    },
  },
  {
    id: 'violet-night',
    name: '夜堇',
    builtin: true,
    light: {
      accent: '#8b5cf6',
      accentSoft: '#f1ebfe',
      card: '#ffffff',
      bg: '#f8f7fb',
      fg: '#221a33',
      mutedFg: '#6f6785',
      border: '#e8e4f0',
      radius: 24,
      shadow: 1,
    },
    dark: {
      accent: '#b794f6',
      accentSoft: '#241f36',
      card: '#191624',
      bg: '#100e18',
      fg: '#ece7f6',
      mutedFg: '#9a90b5',
      border: '#282238',
      radius: 24,
      shadow: 1,
    },
    wallpaper: {
      light: { kind: 'gradient', gradient: 'linear-gradient(150deg,#f1ebfe 0%,#f8f7fb 70%)', veil: 0.9 },
      dark: { kind: 'gradient', gradient: 'linear-gradient(150deg,#1b1530 0%,#100e18 70%)', veil: 0.9 },
    },
  },
  {
    id: 'mono-flat',
    name: '纯白',
    builtin: true,
    light: {
      accent: '#17191d',
      accentSoft: '#eef0f2',
      card: '#ffffff',
      bg: '#f2f3f5',
      fg: '#17191d',
      mutedFg: '#71767e',
      border: '#e3e5e9',
      radius: 8,
      shadow: 0,
    },
    dark: {
      accent: '#f0f2f5',
      accentSoft: '#23262c',
      card: '#14161a',
      bg: '#0b0c0f',
      fg: '#f0f2f5',
      mutedFg: '#8d939c',
      border: '#22252b',
      radius: 8,
      shadow: 0,
    },
    wallpaper: {
      light: { kind: 'none', veil: 1 },
      dark: { kind: 'none', veil: 1 },
    },
  },
];

/** 主题包存储 key */
export const THEME_STORAGE_KEY = 'zj-theme-packs';
export const ACTIVE_THEME_KEY = 'zj-active-theme';
export const THEME_MODE_KEY = 'zj-theme-mode';

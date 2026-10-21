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
  /** 品牌区：导航栏左侧的应用图标、名称与副标题 */
  brand?: ThemeBrand;
  /** 卡片样式：风格、边框宽度、强调条 */
  card?: ThemeCardStyle;
  /** 导航栏样式：风格与高度 */
  nav?: ThemeNavStyle;
  /** 主题分类：综合 / 配色 / 卡片 / 导航栏 / 壁纸 / 图标 */
  category?: string;
  /** 主题简介（.theme 信封 manifest.description） */
  description?: string;
  /** 作者 */
  author?: string;
  /** 预览标识（emoji） */
  preview?: string;
  /** 标签 */
  tags?: string[];
  /** 语义化版本 */
  version?: string;
  /** 协议版本：1 或 2（仅文件夹制主题包有值） */
  protocol?: number;
  /**
   * 主题包附带的额外 CSS 变量（已映射到 `--zj-*` 命名空间）。
   * 由 theme.css 解析而来，切换主题时随包一起注入 `<html>`。
   */
  cssVars?: Record<string, string>;
  createdAt?: number;
}

/**
 * 品牌信息 —— 决定上下导航栏左侧的图标与标题。
 * icon 支持两种写法：emoji（直接文本渲染）或 http(s) 图片地址（渲染为 img）。
 */
export interface ThemeBrand {
  /** 应用图标：emoji 或图片地址 */
  icon?: string;
  /** 应用名称 */
  name?: string;
  /** 副标题 */
  tagline?: string;
}

/** 卡片样式 */
export interface ThemeCardStyle {
  /** flat 无阴影 / elevated 阴影 / outline 描边 / glass 毛玻璃 */
  style?: 'flat' | 'elevated' | 'outline' | 'glass';
  /** 卡片边框宽度（px），默认 1 */
  borderWidth?: number;
  /** 是否在卡片顶部显示主色强调条 */
  accentBar?: boolean;
}

/** 导航栏样式 */
export interface ThemeNavStyle {
  /** flat 扁平 / glass 毛玻璃 / solid 实色 / minimal 无边框 */
  style?: 'flat' | 'glass' | 'solid' | 'minimal';
  /** 导航栏最小高度（px），默认随内容自适应 */
  height?: number;
  /** 是否显示品牌图标 */
  showIcon?: boolean;
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
  /**
   * 圆角（px）—— **已废弃，不再绑定主题**。
   * 圆角改为「设置 · 个性化」里的全局选项（见 `src/lib/theme/radius.ts`）。
   * 此字段仅作旧包兼容保留，导入时会被忽略。
   */
  radius?: number;
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
    id: 'pure-light',
    category: '综合',
    name: 'Pure Light',
    builtin: true,
    brand: { icon: '🌤️', name: '智简匣', tagline: '本地离线 AI 工具箱' },
    card: { style: 'glass', borderWidth: 1 },
    nav: { style: 'flat', showIcon: true },
    light: {
      accent: '#5b8def',
      accentSoft: '#eaf1fe',
      card: '#ffffff',
      bg: '#f7f8fa',
      fg: '#16181d',
      mutedFg: '#6b7280',
      border: '#e6e8ee',
      shadow: 1,
    },
    dark: {
      accent: '#7ba3f5',
      accentSoft: '#1e2634',
      card: '#1a1d23',
      bg: '#15171b',
      fg: '#e9ebef',
      mutedFg: '#98a0ac',
      border: '#262a31',
      shadow: 2,
    },
    wallpaper: {
      light: {
        kind: 'gradient',
        gradient: 'linear-gradient(160deg,#fafbfd 0%,#f7f8fa 55%,#eef1f6 100%)',
        veil: 0.82,
      },
      dark: { kind: 'gradient', gradient: 'linear-gradient(160deg,#181b21 0%,#15171b 100%)', veil: 0.9 },
    },
  },
];

/** 主题包存储 key */
export const THEME_STORAGE_KEY = 'zj-theme-packs';
export const ACTIVE_THEME_KEY = 'zj-active-theme';
export const THEME_MODE_KEY = 'zj-theme-mode';

/** 主题包缺省的品牌 / 卡片 / 导航栏配置 */
export const DEFAULT_THEME_BRAND: ThemeBrand = {
  icon: '📦',
  name: '智简匣',
  tagline: '本地离线 AI 工具箱',
};

export const DEFAULT_THEME_CARD: Required<ThemeCardStyle> = {
  style: 'elevated',
  borderWidth: 1,
  accentBar: false,
};

export const DEFAULT_THEME_NAV: Required<ThemeNavStyle> = {
  style: 'flat',
  height: 0,
  showIcon: true,
};

/**
 * 归一化主题包：补齐缺失的品牌 / 卡片 / 导航栏配置。
 * 外部制作的 .theme 可能只写了配色，其余字段按默认值补全。
 */
export function normalizeThemePack(pack: ThemePack): ThemePack {
  return {
    ...pack,
    brand: { ...DEFAULT_THEME_BRAND, ...(pack.brand ?? {}) },
    card: { ...DEFAULT_THEME_CARD, ...(pack.card ?? {}) },
    nav: { ...DEFAULT_THEME_NAV, ...(pack.nav ?? {}) },
  };
}

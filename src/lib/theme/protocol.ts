/**
 * 协议主题包适配层 —— 把「文件夹制」主题包（protocol 1/2）转换为内部 ThemePack。
 *
 * ## 为什么需要这一层
 *
 * 主题包在仓库里有两种形态：
 *
 * 1. **文件夹制**（`my-theme/<theme-id>/`）
 *    - `theme.json`：清单，字段为 `colors` 单一色板 + `wallpaper` / `video` / `bgm` / `texts`
 *    - `theme.css`：`:root { --变量: 值; }` 形式的主题变量
 *    - `assets/`：壁纸等二进制资源
 * 2. **单文件信封制**（`<id>-<version>.theme`）
 *    - 信封 + `pack` 载荷，`pack` 直接就是内部 ThemePack 结构
 *
 * 内部 ThemePack 需要的是 **亮/暗两套** 完整配色（`light` / `dark`），
 * 而协议主题只有 **一套** 语义色板（`--bg` / `--fg` / `--accent` / `--card` / `--border`）。
 * 因此这里做三件事：
 *
 * - **色板 → 双模式配色**：以色板作为亮色模式基准，再按亮度派生暗色模式；
 * - **theme.css → 变量映射**：把语义变量映射到宿主的 `--zj-*` 变量空间，
 *   其中 `--bg` / `--fg` / `--accent` / `--card` / `--border` 会覆盖色板取值
 *   （theme.css 是「样式变量与覆盖」，优先级高于 theme.json）；
 * - **资源相对路径 → 可访问 URL**：壁纸等资源由后端以 `/theme-assets/...` 提供，
 *   跨端口访问时需要绝对地址。
 *
 * 协议 2 的 `video` / `bgm` / `texts` 字段在此**只做承接不做渲染**：
 * 保留原始 JSON 便于将来扩展，但当前宿主不播放视频与背景音乐。
 */

import {
  normalizeThemePack,
  type ThemePack,
  type ThemeVariant,
} from './types';

// ---------------------------------------------------------------------------
// 协议主题 JSON
// ---------------------------------------------------------------------------

/** 协议主题的语义色板（键为语义变量名） */
export interface ProtocolThemeColors {
  '--bg'?: string;
  '--fg'?: string;
  '--accent'?: string;
  '--card'?: string;
  '--border'?: string;
  [key: string]: string | undefined;
}

/** 协议主题清单（theme.json） */
export interface ProtocolTheme {
  id: string;
  name: string;
  author?: string;
  version?: string;
  /** 1 或 2；2 支持视频 / 自定义文本 / BGM */
  protocol?: number;
  description?: string;
  /** 语义色板 */
  colors: ProtocolThemeColors;
  /** 壁纸相对路径（相对 theme.json） */
  wallpaper?: string;
  /** protocol 2：背景视频 */
  video?: { src?: string; blur?: boolean };
  /** protocol 2：背景音乐 */
  bgm?: Record<string, string>;
  /** protocol 2：自定义文案 */
  texts?: Record<string, string>;
  [key: string]: unknown;
}

/** 判定一个对象是否为协议主题清单 */
export function isProtocolTheme(value: unknown): value is ProtocolTheme {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) return false;
  if (typeof p.name !== 'string' || !p.name) return false;
  if (!p.colors || typeof p.colors !== 'object') return false;
  // 内部 ThemePack 有 light / dark，与协议主题天然可区分
  if (p.light || p.dark) return false;
  return true;
}

// ---------------------------------------------------------------------------
// theme.css 解析
// ---------------------------------------------------------------------------

/** 语义变量 → 宿主 CSS 变量 的显式映射 */
const SEMANTIC_TO_ZJ: Record<string, string> = {
  '--bg': '--zj-bg',
  '--fg': '--zj-fg',
  '--accent': '--zj-accent',
  '--card': '--zj-card',
  '--border': '--zj-border',
  // 层次色：宿主统一用 muted-fg / muted 命名
  '--fg-muted': '--zj-muted-fg',
  '--muted-fg': '--zj-muted-fg',
  '--muted': '--zj-muted',
  // 字体栈
  '--font-ui': '--zj-font-ui',
  '--font-mono': '--zj-font-mono',
};

/**
 * 解析 theme.css，抽出 `:root { --变量: 值; }` 中的变量声明。
 *
 * 只接受 `:root` 块内的自定义属性，忽略选择器、注释与其它规则 ——
 * 主题包的 CSS 只允许做「变量声明」，不做布局覆盖。
 */
export function parseProtocolCss(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof css !== 'string' || !css) return out;

  // 逐个找出 :root 块
  const rootRe = /:root\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rootRe.exec(css)) !== null) {
    const body = m[1];
    const declRe = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(body)) !== null) {
      const name = d[1].trim();
      const value = d[2].trim();
      if (!name || !value) continue;
      out[name] = value;
    }
  }
  return out;
}

/**
 * 把语义变量映射为宿主 CSS 变量名。
 * 未在显式表中的变量统一加 `--zj-` 前缀。
 *
 * `--radius` / `--card-radius` 被跳过：圆角是全局独立设置
 * （「设置 · 个性化」里单独调整），不绑定主题包。
 */
export function mapCssVarName(name: string): string | null {
  if (name === '--radius' || name === '--card-radius') return null;
  if (SEMANTIC_TO_ZJ[name]) return SEMANTIC_TO_ZJ[name];
  return `--zj-${name.replace(/^--/, '')}`;
}

/**
 * 归一化 CSS 变量值。
 *
 * 目前只处理透明度：主题包习惯写 `--card-alpha: 0.72`（0~1 小数），
 * 而 `color-mix()` 需要百分比（`72%`），这里做一次转换。
 */
function normalizeCssValue(name: string, value: string): string {
  if (/-alpha$/.test(name)) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 1) {
      return `${Math.round(n * 100)}%`;
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

/** 解析 #rgb / #rrggbb / #rrggbbaa 为 [r, g, b]（0-255） */
function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** 两个颜色按比例混合（t=0 取 a，t=1 取 b） */
function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `#${[r, g, bl]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** WCAG 相对亮度 */
function relLuminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/** 依据背景色亮度挑选黑或白作为前景色 */
function pickForeground(hex: string): string {
  return relLuminance(hex) > 0.45 ? '#101216' : '#ffffff';
}

// ---------------------------------------------------------------------------
// 色板 → 双模式配色
// ---------------------------------------------------------------------------

/**
 * 构造一个完整配色块
 */
function makeVariant(
  bg: string,
  fg: string,
  accent: string,
  card: string,
  border: string,
  shadow: 0 | 1 | 2 | 3,
): ThemeVariant {
  return {
    accent,
    accentSoft: mixHex(accent, bg, 0.86),
    card,
    bg,
    fg,
    mutedFg: mixHex(fg, bg, 0.42),
    border,
    shadow,
  };
}

/**
 * 暗色模式下把强调色提亮。
 *
 * 浅色主题的强调色（如柔和蓝 #5b8def）放到深色背景上对比度会明显下降，
 * 这里按背景亮度向白色方向提一点，保持按钮 / 链接的可辨识度。
 */
function liftAccentForDark(accent: string, bg: string): string {
  if (relLuminance(bg) > 0.4) return accent;
  return mixHex(accent, '#ffffff', 0.22);
}

/**
 * 由亮色模式配色派生暗色模式配色。
 *
 * 亮色主题 → 背景压暗、前景提亮、边框压暗；
 * 暗色主题 → 反向派生（背景提亮、前景压暗），保证协议主题在两种模式下都可读。
 */
function deriveDark(v: ThemeVariant): ThemeVariant {
  const isLight = relLuminance(v.bg) > 0.4;
  if (isLight) {
    const bg = mixHex(v.bg, '#0a0d13', 0.86);
    const card = mixHex(v.card, '#141926', 0.88);
    const fg = mixHex(v.fg, '#ffffff', 0.9);
    // 边框要跟着背景一起压暗，否则浅色边框在暗底上会异常显眼
    const border = mixHex(v.border, bg, 0.7);
    return makeVariant(bg, fg, liftAccentForDark(v.accent, bg), card, border, 2);
  }
  const bg = mixHex(v.bg, '#ffffff', 0.88);
  const card = mixHex(v.card, '#ffffff', 0.82);
  const fg = mixHex(v.fg, '#101216', 0.88);
  const border = mixHex(v.border, bg, 0.7);
  return makeVariant(bg, fg, v.accent, card, border, 1);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 协议主题 → 内部 ThemePack 的转换选项 */
export interface ProtocolToPackOptions {
  /** theme.css 原文（可缺省） */
  css?: string;
  /** 壁纸的绝对 URL（可缺省；缺省时按无壁纸处理） */
  wallpaperUrl?: string;
  /** 主题分类 */
  category?: string;
}

/**
 * 把协议主题清单转换为内部 ThemePack。
 *
 * @param theme theme.json 原文
 * @param opts theme.css / 壁纸 URL 等附加信息
 */
export function protocolToThemePack(
  theme: ProtocolTheme,
  opts: ProtocolToPackOptions = {},
): ThemePack {
  const cssVars = parseProtocolCss(opts.css ?? '');
  const colors = theme.colors ?? {};

  // 语义变量覆盖色板（theme.css 优先级更高）
  const pick = (semantic: string, fallback: string): string => {
    const fromCss = cssVars[semantic];
    if (fromCss) return fromCss;
    const fromJson = colors[semantic];
    if (fromJson) return fromJson;
    return fallback;
  };

  const bg = pick('--bg', '#f6f7f9');
  const fg = pick('--fg', '#1c1f24');
  const accent = pick('--accent', '#4f6bed');
  const card = pick('--card', '#ffffff');
  const border = pick('--border', '#e6e8ec');

  const light = makeVariant(bg, fg, accent, card, border, 1);
  const dark = deriveDark(light);

  // 主题包附带的额外 CSS 变量（供 buildCssVars 注入到 DOM）
  // 五色板已通过 light/dark 表达，不重复注入；
  // 层次色（--fg-muted）、毛玻璃参数（--card-alpha/--card-blur）等则单独注入。
  const PALETTE_VARS = new Set(['--bg', '--fg', '--accent', '--card', '--border']);
  const extraVars: Record<string, string> = {};
  for (const [name, value] of Object.entries(cssVars)) {
    if (PALETTE_VARS.has(name)) continue;
    const mapped = mapCssVarName(name);
    if (mapped) extraVars[mapped] = normalizeCssValue(name, value);
  }

  // 壁纸：协议主题只声明一份，亮暗共用
  // veil 越低壁纸越明显 —— 取较低值让低对比度纹理仍能透出来
  const wallpaper =
    opts.wallpaperUrl && theme.wallpaper
      ? {
          light: { kind: 'builtin' as const, url: opts.wallpaperUrl, veil: 0.45 },
          dark: { kind: 'builtin' as const, url: opts.wallpaperUrl, veil: 0.7 },
        }
      : undefined;

  // theme.css 里出现毛玻璃参数 → 卡片走毛玻璃风格
  const glassy =
    extraVars['--zj-card-alpha'] !== undefined ||
    extraVars['--zj-card-blur'] !== undefined;

  return normalizeThemePack({
    id: theme.id,
    name: theme.name,
    builtin: false,
    category: opts.category ?? '综合',
    description: theme.description,
    author: theme.author,
    version: theme.version,
    preview: '🎨',
    tags: [],
    light,
    dark,
    wallpaper,
    card: glassy
      ? { style: 'glass', borderWidth: 1 }
      : { style: 'elevated', borderWidth: 1 },
    nav: { style: 'flat', showIcon: true },
    // 协议 2 的 video / bgm / texts 只承接不渲染，保留原值便于扩展
    protocol: theme.protocol ?? 1,
    cssVars: extraVars,
  });
}

/** 协议主题包（含 css / 资源）→ 内部 ThemePack */
export function protocolPackageToThemePack(
  theme: ProtocolTheme,
  opts: ProtocolToPackOptions = {},
): ThemePack {
  return protocolToThemePack(theme, opts);
}

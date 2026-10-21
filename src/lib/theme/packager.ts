/**
 * 主题包导入导出 —— 与插件包的 .plugin 格式平行。
 *
 * 主题包在**外部制作**（设计工具 / 手工编辑 JSON），
 * 前端只负责导入、导出与本地缓存，不提供制作界面。
 *
 * .theme 文件结构（与 .plugin 同为「信封 + 载荷」两段式）：
 * ```json
 * {
 *   "format": "zhijianxia.theme",
 *   "formatVersion": 1,
 *   "manifest": {
 *     "id": "my-theme",
 *     "name": "我的主题",
 *     "version": "1.0.0",
 *     "description": "一套自制的 UI 主题",
 *     "author": "设计者",
 *     "preview": "🎨",
 *     "tags": ["深色", "高对比"]
 *   },
 *   "pack": {
 *     "light": { "accent": "#4f6bed", "accentSoft": "#eef1fe", "card": "#ffffff",
 *                "bg": "#f6f7f9", "fg": "#1c1f24", "mutedFg": "#6b7280",
 *                "border": "#e6e8ec", "radius": 16, "shadow": 2 },
 *     "dark":  { "...": "同上" },
 *     "wallpaper": { "light": { "kind": "gradient", "gradient": "linear-gradient(...)", "veil": 0.9 },
 *                    "dark":  { "kind": "none", "veil": 1 } },
 *     "brand": { "icon": "🎨", "name": "我的应用", "tagline": "副标题" },
 *     "card":  { "style": "glass", "borderWidth": 1, "accentBar": true },
 *     "nav":   { "style": "glass", "height": 56, "showIcon": true }
 *   }
 * }
 * ```
 *
 * brand / card / nav 三段均为**可选**：缺省时前端按默认值补全，
 * 因此旧版主题包（只写配色）依然可以正常导入。
 *
 * 校验规则与后端 `server/src/routes/registry-validate.js` 保持一致，
 * 保证「外部制作的包」与「后端仓库存的包」能互相识别。
 */

import {
  normalizeThemePack,
  type ThemePack,
  type ThemeVariant,
  type WallpaperRef,
  type ThemeBrand,
  type ThemeCardStyle,
  type ThemeNavStyle,
} from './types';

/** 主题包文件格式标识 */
export const THEME_FORMAT = 'zhijianxia.theme';

/** 主题包格式版本 */
export const THEME_FORMAT_VERSION = 1;

/** 主题包清单（信封的 manifest 段） */
export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  preview?: string;
  tags?: string[];
  /** 主题分类：综合 / 配色 / 卡片 / 导航栏 / 壁纸 / 图标 */
  category?: string;
}

/** 主题包信封 */
export interface ThemePackage {
  format: typeof THEME_FORMAT;
  formatVersion: number;
  manifest: ThemeManifest;
  /** 主题定义（载荷段） */
  pack: ThemePack;
  exportedAt?: string;
}

/** 统一的校验结果 */
export type ThemePackageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** 合法的主题包 id（kebab-case） */
export function isValidThemeId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/** 合法 semver */
export function isValidSemver(version: unknown): version is string {
  return (
    typeof version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  );
}

/** 校验颜色值（#rrggbb / #rrggbbaa） */
export function isValidColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
  );
}

/** 校验一组配色 */
export function isValidVariant(value: unknown): value is ThemeVariant {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    isValidColor(v.accent) &&
    isValidColor(v.accentSoft) &&
    isValidColor(v.card) &&
    isValidColor(v.bg) &&
    isValidColor(v.fg) &&
    isValidColor(v.mutedFg) &&
    isValidColor(v.border) &&
    // radius 已从主题包解绑（改为全局设置），仅在包内出现时才校验
    (v.radius === undefined ||
      (typeof v.radius === 'number' &&
        Number.isFinite(v.radius) &&
        v.radius >= 0 &&
        v.radius <= 48)) &&
    typeof v.shadow === 'number' &&
    v.shadow >= 0 &&
    v.shadow <= 3
  );
}

/** 校验壁纸引用 */
export function isValidWallpaper(value: unknown): value is WallpaperRef {
  if (!value || typeof value !== 'object') return false;
  const w = value as Record<string, unknown>;
  if (!['gradient', 'builtin', 'user', 'none'].includes(String(w.kind))) {
    return false;
  }
  if (w.kind === 'gradient' && typeof w.gradient !== 'string') return false;
  if (w.kind === 'builtin' && typeof w.url !== 'string') return false;
  return true;
}

/** 卡片风格枚举 */
export const CARD_STYLES = ['flat', 'elevated', 'outline', 'glass'] as const;
/** 导航栏风格枚举 */
export const NAV_STYLES = ['flat', 'glass', 'solid', 'minimal'] as const;

/** 校验品牌段（可选） */
export function isValidBrand(value: unknown): value is ThemeBrand {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  if (b.icon !== undefined && typeof b.icon !== 'string') return false;
  if (b.name !== undefined && typeof b.name !== 'string') return false;
  if (b.tagline !== undefined && typeof b.tagline !== 'string') return false;
  return true;
}

/** 校验卡片段（可选） */
export function isValidCard(value: unknown): value is ThemeCardStyle {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  if (c.style !== undefined && !CARD_STYLES.includes(c.style as never)) {
    return false;
  }
  if (c.borderWidth !== undefined) {
    if (
      typeof c.borderWidth !== 'number' ||
      !Number.isFinite(c.borderWidth) ||
      c.borderWidth < 0 ||
      c.borderWidth > 6
    ) {
      return false;
    }
  }
  if (c.accentBar !== undefined && typeof c.accentBar !== 'boolean') {
    return false;
  }
  return true;
}

/** 校验导航栏段（可选） */
export function isValidNav(value: unknown): value is ThemeNavStyle {
  if (!value || typeof value !== 'object') return false;
  const n = value as Record<string, unknown>;
  if (n.style !== undefined && !NAV_STYLES.includes(n.style as never)) {
    return false;
  }
  if (n.height !== undefined) {
    if (
      typeof n.height !== 'number' ||
      !Number.isFinite(n.height) ||
      n.height < 0 ||
      n.height > 200
    ) {
      return false;
    }
  }
  if (n.showIcon !== undefined && typeof n.showIcon !== 'boolean') {
    return false;
  }
  return true;
}

/**
 * 校验主题包信封。
 * 返回中文错误原因，调用方可直接展示给用户。
 */
export function validateThemePackage(
  value: unknown,
): ThemePackageResult<ThemePackage> {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: '主题包内容不是有效的对象' };
  }
  const p = value as Record<string, unknown>;

  if (p.format !== THEME_FORMAT) {
    return {
      ok: false,
      error: `不是智简匣主题包（format = ${String(p.format)}）`,
    };
  }

  const version = Number(p.formatVersion);
  if (!Number.isFinite(version) || version > THEME_FORMAT_VERSION) {
    return {
      ok: false,
      error: `主题包版本不兼容（包版本 ${String(p.formatVersion)}，当前支持 ${THEME_FORMAT_VERSION}）`,
    };
  }

  // ---- manifest 段 ----
  const m = p.manifest as Record<string, unknown> | undefined;
  if (!m || typeof m !== 'object') {
    return { ok: false, error: '主题包缺少 manifest（清单）段' };
  }
  if (!isValidThemeId(m.id)) {
    return {
      ok: false,
      error: '主题包 id 非法，只能使用小写字母、数字与连字符',
    };
  }
  if (typeof m.name !== 'string' || !m.name.trim()) {
    return { ok: false, error: '主题包缺少名称' };
  }
  if (!isValidSemver(m.version)) {
    return {
      ok: false,
      error: `主题包版本号非法："${String(m.version)}"，应为 1.0.0 形式`,
    };
  }

  // ---- pack 段 ----
  const pack = p.pack as Record<string, unknown> | undefined;
  if (!pack || typeof pack !== 'object') {
    return { ok: false, error: '主题包缺少 pack（主题定义）段' };
  }
  if (!isValidVariant(pack.light)) {
    return { ok: false, error: '亮色模式配色不完整或格式不正确' };
  }
  if (!isValidVariant(pack.dark)) {
    return { ok: false, error: '暗色模式配色不完整或格式不正确' };
  }
  if (pack.wallpaper !== undefined) {
    const w = pack.wallpaper as Record<string, unknown>;
    if (w.light !== undefined && !isValidWallpaper(w.light)) {
      return { ok: false, error: '亮色壁纸定义不正确' };
    }
    if (w.dark !== undefined && !isValidWallpaper(w.dark)) {
      return { ok: false, error: '暗色壁纸定义不正确' };
    }
  }

  // ---- 可选定制段：品牌 / 卡片 / 导航栏 ----
  if (pack.brand !== undefined && !isValidBrand(pack.brand)) {
    return { ok: false, error: '主题包 brand（品牌）段格式不正确' };
  }
  if (pack.card !== undefined && !isValidCard(pack.card)) {
    return { ok: false, error: '主题包 card（卡片样式）段格式不正确' };
  }
  if (pack.nav !== undefined && !isValidNav(pack.nav)) {
    return { ok: false, error: '主题包 nav（导航栏样式）段格式不正确' };
  }

  return { ok: true, value: value as ThemePackage };
}

/** 创建主题包信封 */
export function createThemePackage(
  pack: ThemePack,
  manifest?: Partial<ThemeManifest>,
): ThemePackage {
  return {
    format: THEME_FORMAT,
    formatVersion: THEME_FORMAT_VERSION,
    manifest: {
      id: pack.id,
      name: pack.name,
      version: '1.0.0',
      description: '',
      author: '',
      preview: '🎨',
      tags: [],
      category: pack.category ?? '综合',
      ...manifest,
    },
    pack: {
      ...pack,
      builtin: false,
      // 圆角已从主题包解绑 —— 导出时剥离 radius
      light: stripRadius(pack.light),
      dark: stripRadius(pack.dark),
    },
    exportedAt: new Date().toISOString(),
  };
}

/** 去掉配色块中的 radius（已改为全局设置） */
function stripRadius(variant: ThemeVariant): ThemeVariant {
  const { radius: _radius, ...rest } = variant;
  return rest as ThemeVariant;
}

/** 序列化为主题包文件内容 */
export function serializeThemePackage(
  pkg: ThemePackage,
  pretty = true,
): string {
  return JSON.stringify(pkg, null, pretty ? 2 : 0);
}

/**
 * 解析主题包文件内容。
 * 只接受标准信封格式；外部制作时必须包含 format / formatVersion / manifest / pack 四段。
 */
export function parseThemePackage(text: string): ThemePackageResult<ThemePackage> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '主题包文件不是有效的 JSON' };
  }
  return validateThemePackage(raw);
}

/** 主题包文件名 */
export function themePackageFileName(pkg: ThemePackage): string {
  return `${pkg.manifest.id}.theme`;
}

/** 触发浏览器下载主题包文件 */
export function downloadThemePackage(pkg: ThemePackage): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const blob = new Blob([serializeThemePackage(pkg)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = themePackageFileName(pkg);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** 从文件读取并解析主题包 */
export async function readThemePackageFile(
  file: File,
): Promise<ThemePackageResult<ThemePackage>> {
  try {
    const text = await file.text();
    return parseThemePackage(text);
  } catch {
    return { ok: false, error: '主题包文件读取失败' };
  }
}

/** 从信封中取出可应用的主题定义 */
export function themePackOf(pkg: ThemePackage): ThemePack {
  return normalizeThemePack({
    ...pkg.pack,
    id: pkg.manifest.id,
    name: pkg.manifest.name,
    category: pkg.manifest.category ?? pkg.pack.category ?? '综合',
    builtin: false,
    // 圆角由全局设置控制，忽略包内可能存在的旧 radius
    light: stripRadius(pkg.pack.light),
    dark: stripRadius(pkg.pack.dark),
  });
}

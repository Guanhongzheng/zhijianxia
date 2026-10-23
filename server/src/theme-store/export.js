'use strict';

/**
 * theme-store/export.js —— 文件夹制主题 → .theme 信封
 *
 * ## 为什么要这一层
 *
 * 主题仓库里的主题是**文件夹制**（theme.json + theme.css + assets/），
 * 而智简匣「设置 · 个性化 → 导入 .theme」吃的是**单文件信封制**。
 * 用户路径是：广场下载 .theme → 导入 → 应用，所以需要这层转换。
 *
 * 转换逻辑与前端 `src/lib/theme/protocol.ts` 的 `protocolToThemePack`
 * 保持一致：色板 → 亮/暗双变体、theme.css 的额外变量 → cssVars、
 * assets 里的壁纸 → 绝对 URL。
 */

const fs = require('node:fs');
const path = require('node:path');

/** 语义变量 → 宿主 CSS 变量 的显式映射（与前端 protocol.ts 一致） */
const SEMANTIC_TO_ZJ = {
  '--bg': '--zj-bg',
  '--fg': '--zj-fg',
  '--accent': '--zj-accent',
  '--card': '--zj-card',
  '--border': '--zj-border',
  '--fg-muted': '--zj-muted-fg',
  '--muted-fg': '--zj-muted-fg',
  '--muted': '--zj-muted',
  '--font-ui': '--zj-font-ui',
  '--font-mono': '--zj-font-mono',
};

/** 五色板对应的语义变量（这些由 light/dark 表达，不重复注入 cssVars） */
const PALETTE_VARS = new Set(['--bg', '--fg', '--accent', '--card', '--border']);

/**
 * 解析 theme.css，抽出 `:root { --变量: 值; }` 中的变量声明。
 * 只接受 :root 块内的自定义属性 —— 主题包的 CSS 只允许做变量声明。
 */
function parseProtocolCss(css) {
  const out = {};
  if (typeof css !== 'string' || !css) return out;

  const rootRe = /:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = rootRe.exec(css)) !== null) {
    const declRe = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = declRe.exec(m[1])) !== null) {
      const name = d[1].trim();
      const value = d[2].trim();
      if (!name || !value) continue;
      out[name] = value;
    }
  }
  return out;
}

/** 把语义变量映射为宿主 CSS 变量名；圆角类变量被跳过（属于全局设置） */
function mapCssVarName(name) {
  if (name === '--radius' || name === '--card-radius') return null;
  if (SEMANTIC_TO_ZJ[name]) return SEMANTIC_TO_ZJ[name];
  return `--zj-${name.replace(/^--/, '')}`;
}

/**
 * 归一化 CSS 变量值。
 * 主题包习惯写 `--card-alpha: 0.72`（0~1 小数），
 * 而 `color-mix()` 需要百分比（`72%`）。
 */
function normalizeCssValue(name, value) {
  if (/-alpha$/.test(name)) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 1) {
      return `${Math.round(n * 100)}%`;
    }
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* 颜色工具                                                                    */
/* -------------------------------------------------------------------------- */

/** 解析 #rgb / #rrggbb / #rrggbbaa 为 [r,g,b,a] */
function parseHex(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  const full =
    h.length === 3 || h.length === 4
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  ];
}

/** 两个颜色按比例混合 */
function mixHex(a, b, ratio) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const out = [0, 1, 2].map((i) => Math.round(ca[i] + (cb[i] - ca[i]) * ratio));
  const alpha = ca[3] + (cb[3] - ca[3]) * ratio;
  const hex = out.map((v) => v.toString(16).padStart(2, '0')).join('');
  return alpha >= 1 ? `#${hex}` : `#${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

/** sRGB 相对亮度（WCAG 定义） */
function relLuminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  const lin = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** 暗色模式下把强调色提亮，保证在深底上够清晰 */
function liftAccentForDark(accent, bg) {
  if (relLuminance(bg) > 0.4) return accent;
  return mixHex(accent, '#ffffff', 0.22);
}

/** 构造一个配色块 */
function makeVariant(bg, fg, accent, card, border, shadow) {
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

/** 由亮色派生暗色 */
function deriveDark(v) {
  const isLight = relLuminance(v.bg) > 0.4;
  if (isLight) {
    const bg = mixHex(v.bg, '#0a0d13', 0.86);
    const card = mixHex(v.card, '#141926', 0.88);
    const fg = mixHex(v.fg, '#ffffff', 0.9);
    const border = mixHex(v.border, bg, 0.7);
    return makeVariant(bg, fg, liftAccentForDark(v.accent, bg), card, border, 2);
  }
  const bg = mixHex(v.bg, '#ffffff', 0.88);
  const card = mixHex(v.card, '#ffffff', 0.82);
  const fg = mixHex(v.fg, '#101216', 0.88);
  const border = mixHex(v.border, bg, 0.7);
  return makeVariant(bg, fg, v.accent, card, border, 1);
}

/**
 * 判断这是不是「暗色基底」主题。
 *
 * 优先读 theme.json 的 `scheme` 字段（显式声明，最可靠）；
 * 没有声明时按背景色的相对亮度判断（< 0.4 视为暗色基底）。
 */
function detectDarkBase(theme, bg) {
  const scheme = typeof theme.scheme === 'string' ? theme.scheme.toLowerCase() : '';
  if (scheme === 'dark') return true;
  if (scheme === 'light') return false;
  return relLuminance(bg) < 0.4;
}

/* -------------------------------------------------------------------------- */
/* 读取                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 读取一个主题文件夹。
 * @param {string} dir 主题目录绝对路径
 * @returns {Promise<{theme:object, css:string}|null>}
 */
async function readThemeFolder(dir) {
  let raw;
  try {
    raw = await fs.promises.readFile(path.join(dir, 'theme.json'), 'utf8');
  } catch {
    return null;
  }
  let theme;
  try {
    theme = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!theme || typeof theme !== 'object') return null;

  let css = '';
  try {
    css = await fs.promises.readFile(path.join(dir, 'theme.css'), 'utf8');
  } catch {
    /* theme.css 可缺省 */
  }
  return { theme, css };
}

/* -------------------------------------------------------------------------- */
/* 导出                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 文件夹制主题 → .theme 信封
 *
 * @param {object} theme theme.json 原文
 * @param {string} css theme.css 原文
 * @param {object} opts
 * @param {string} [opts.wallpaperUrl] 壁纸的**绝对** URL（跨端口访问时必须是绝对的）
 */
function folderToThemePackage(theme, css, opts = {}) {
  const cssVars = parseProtocolCss(css);
  const colors = theme.colors ?? {};

  // CSS 里的语义变量优先于 theme.json 的色板
  const pick = (semantic, fallback) =>
    cssVars[semantic] ?? colors[semantic] ?? fallback;

  const bg = pick('--bg', '#f6f7f9');
  const fg = pick('--fg', '#1c1f24');
  const accent = pick('--accent', '#4f6bed');
  const card = pick('--card', '#ffffff');
  const border = pick('--border', '#e6e8ec');

  /* ------------------------------------------------------------------ */
  /* 深色基底主题：两套模式都用这套配色                                  */
  /* ------------------------------------------------------------------ */
  //
  // ⚠️ 协议主题只有**一套**色板，而智简匣的协议转换是「以色板作为亮色模式基准，
  // 再按亮度派生暗色模式」。对**暗色**主题来说这会派生出刺眼的浅色 ——
  // 实测：深空主题（bg #080b14）被派生成 bg #e1e2e3 / card #d4d5d8。
  //
  // 沉浸式暗色主题的语义是「两种模式下都应该是暗的」，所以这里：
  // - scheme 字段显式声明 'dark'（推荐）；
  // - 没有声明时按背景亮度自动判断。
  const darkBase = detectDarkBase(theme, bg);

  const light = makeVariant(bg, fg, accent, card, border, darkBase ? 2 : 1);
  const dark = darkBase
    ? // 暗色基底：暗色模式再压深一点，保留层次但仍是暗的
      makeVariant(
        mixHex(bg, '#000000', 0.16),
        fg,
        liftAccentForDark(accent, bg),
        mixHex(card, '#000000', 0.12),
        mixHex(border, bg, 0.55),
        2,
      )
    : deriveDark(light);

  // 额外变量（毛玻璃参数等）—— 五色板已由 light/dark 表达，不重复注入
  const extraVars = {};
  for (const [name, value] of Object.entries(cssVars)) {
    if (PALETTE_VARS.has(name)) continue;
    const mapped = mapCssVarName(name);
    if (mapped) extraVars[mapped] = normalizeCssValue(name, value);
  }

  // 壁纸：指向本服务的资源端点（必须是绝对 URL）
  //
  // veil 是壁纸之上的遮罩不透明度 —— 越大壁纸越不明显。
  // 沉浸式主题要的是「极光透上来」，所以压低；
  // 暗色模式再低一档（更沉浸）。
  const wallpaper = opts.wallpaperUrl
    ? {
        light: { kind: 'builtin', url: opts.wallpaperUrl, veil: 0.5 },
        dark: { kind: 'builtin', url: opts.wallpaperUrl, veil: 0.3 },
      }
    : undefined;

  // 毛玻璃参数存在 → 卡片走 glass 风格
  const glassy =
    extraVars['--zj-card-alpha'] !== undefined ||
    extraVars['--zj-card-blur'] !== undefined;

  const category =
    typeof theme.category === 'string' && theme.category ? theme.category : '综合';

  return {
    format: 'zhijianxia.theme',
    formatVersion: 1,
    manifest: {
      id: theme.id,
      name: theme.name,
      version: theme.version ?? '1.0.0',
      description: theme.description ?? '',
      author: theme.author ?? '',
      preview: '🎨',
      tags: Array.isArray(theme.tags) ? theme.tags : [],
      category,
    },
    pack: {
      id: theme.id,
      name: theme.name,
      builtin: false,
      category,
      description: theme.description ?? '',
      author: theme.author ?? '',
      preview: '🎨',
      tags: Array.isArray(theme.tags) ? theme.tags : [],
      version: theme.version ?? '1.0.0',
      light,
      dark,
      wallpaper,
      card: glassy
        ? { style: 'glass', borderWidth: 1 }
        : { style: 'elevated', borderWidth: 1 },
      nav: { style: 'flat', showIcon: true },
      cssVars: extraVars,
    },
  };
}

module.exports = {
  parseProtocolCss,
  mapCssVarName,
  normalizeCssValue,
  mixHex,
  relLuminance,
  makeVariant,
  deriveDark,
  detectDarkBase,
  readThemeFolder,
  folderToThemePackage,
};

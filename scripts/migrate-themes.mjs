'use strict';

/**
 * scripts/migrate-themes.mjs —— 把单文件信封制主题迁移为文件夹制协议主题
 *
 * ## 为什么需要迁移
 *
 * 主题仓库（server/packages/themes/）的主题是**文件夹制**：
 *   <slug>/theme.json + theme.css + assets/
 * 而 dist-themes/*.theme 是**单文件信封制**（含完整的 light/dark 双变体、
 * 卡片风格、导航风格、渐变壁纸），信息量更大。
 *
 * 智简匣的校验器（validateThemePack）两种都接受，
 * 但文件夹制能额外携带 theme.css 与独立资源文件（壁纸），
 * 且与「放一个文件夹就是一个主题」的仓库约定一致。
 *
 * ## 迁移做了什么
 *
 * - theme.json：把信封的 manifest + pack 合并成协议主题的形状。
 *   智简匣的协议主题只有**一套**色板，亮/暗由前端派生 ——
 *   所以这里取**亮色**色板作为 colors，暗色由 deriveDark 派生。
 *   （深色基底的主题用 scheme:"dark" 声明，两套模式都保持暗色。）
 * - theme.css：把卡片/导航风格写成 CSS 变量，让宿主能还原这些特征。
 * - 渐变壁纸：转成 CSS 渐变字符串，写进 theme.css（kind=gradient）。
 *
 * 用法：node scripts/migrate-themes.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'dist-themes');
const DST_DIR = path.join(ROOT, 'server', 'packages', 'themes');

/** 主题 id → 源文件名 */
const SOURCES = [
  { id: 'ink-dai', file: 'ink-dai.theme' },
  { id: 'lime-kick', file: 'lime-kick.theme' },
  { id: 'crimson-rose', file: 'crimson-rose.theme' },
];

/** 卡片风格 → 毛玻璃/描边等 CSS 变量 */
function cardVars(card) {
  const vars = {};
  if (!card) return vars;
  if (card.style === 'glass') {
    // 毛玻璃：半透明卡片 + 模糊
    vars['--card-alpha'] = '0.72';
    vars['--card-blur'] = '14px';
  }
  if (card.style === 'outline') {
    // 描边卡片：卡片本身近乎透明，靠边框勾勒
    vars['--card-alpha'] = '0.35';
  }
  if (card.borderWidth && card.borderWidth !== 1) {
    vars['--card-border-width'] = `${card.borderWidth}px`;
  }
  return vars;
}

/** 导航栏风格 → CSS 变量 */
function navVars(nav) {
  const vars = {};
  if (!nav) return vars;
  if (nav.style === 'glass') {
    vars['--nav-alpha'] = '0.6';
    vars['--nav-blur'] = '18px';
  }
  if (nav.height) {
    vars['--nav-height'] = `${nav.height}px`;
  }
  return vars;
}

/** 渐变壁纸 → CSS 变量（kind=gradient 时） */
function wallpaperVars(wallpaper) {
  const vars = {};
  if (!wallpaper) return vars;
  const light = wallpaper.light;
  const dark = wallpaper.dark;
  if (light?.kind === 'gradient' && light.gradient) {
    vars['--wallpaper-gradient'] = light.gradient;
    vars['--wallpaper-veil'] = String(light.veil ?? 0.9);
  }
  if (dark?.kind === 'gradient' && dark.gradient) {
    vars['--wallpaper-gradient-dark'] = dark.gradient;
    vars['--wallpaper-veil-dark'] = String(dark.veil ?? 0.9);
  }
  return vars;
}

/** 迁移单个主题 */
function migrate({ id, file }) {
  const src = path.join(SRC_DIR, file);
  if (!existsSync(src)) {
    console.log(`  跳过 ${id}：找不到 ${file}`);
    return false;
  }

  const pkg = JSON.parse(readFileSync(src, 'utf8'));
  const m = pkg.manifest ?? {};
  const p = pkg.pack ?? {};
  const light = p.light ?? {};
  const dark = p.dark ?? {};

  const dst = path.join(DST_DIR, id);
  mkdirSync(dst, { recursive: true });

  // ---- theme.json：协议主题形状 ----
  const themeJson = {
    id,
    name: m.name ?? p.name ?? id,
    author: m.author ?? p.author ?? '智简匣',
    version: m.version ?? '1.0.0',
    protocol: 2,
    description: m.description ?? p.description ?? '',
    tags: m.tags ?? p.tags ?? [],
    category: m.category ?? p.category ?? '综合',
    colors: {
      '--bg': light.bg,
      '--fg': light.fg,
      '--accent': light.accent,
      '--card': light.card,
      '--border': light.border,
    },
    // 暗色基底的主题：亮色模式也保持暗色，避免被派生成刺眼浅色
    ...(isDarkBase(light.bg) ? { scheme: 'dark' } : {}),
  };

  writeFileSync(
    path.join(dst, 'theme.json'),
    `${JSON.stringify(themeJson, null, 2)}\n`,
    'utf8',
  );

  // ---- theme.css：把卡片/导航/壁纸特征写成变量 ----
  const cssVars = {
    '--bg': light.bg,
    '--fg': light.fg,
    '--accent': light.accent,
    '--card': light.card,
    '--border': light.border,
    '--fg-muted': light.mutedFg,
    ...cardVars(p.card),
    ...navVars(p.nav),
    ...wallpaperVars(p.wallpaper),
  };

  const cssLines = [':root {'];
  for (const [k, v] of Object.entries(cssVars)) {
    if (v === undefined || v === null) continue;
    cssLines.push(`  ${k}: ${v};`);
  }
  cssLines.push('}');

  writeFileSync(path.join(dst, 'theme.css'), `${cssLines.join('\n')}\n`, 'utf8');

  console.log(`  ✓ ${id} —— ${themeJson.name}（${m.category ?? '综合'}）`);
  return true;
}

/** 判断背景色是否为暗色基底（相对亮度 < 0.4） */
function isDarkBase(bg) {
  if (typeof bg !== 'string') return false;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(bg.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum < 0.4;
}

console.log('迁移单文件信封制主题 → 文件夹制协议主题：');
let ok = 0;
for (const item of SOURCES) {
  if (migrate(item)) ok += 1;
}
console.log(`\n共迁移 ${ok} 个主题到 ${DST_DIR}`);

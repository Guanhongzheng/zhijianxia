/**
 * 主题包配色校验 —— 量化「好看」这件事。
 *
 * design-to-code-workflows 的 skill 强调无障碍性（WCAG AA），
 * 但它那套工具产出的是组件；主题包是纯配色，约束更严：
 * **每组前景/背景都必须实测对比度**，不能凭感觉调色。
 *
 * 本脚本用于：
 * 1. 校验将要制作的主题包配色是否符合 WCAG AA；
 * 2. 挑出「accent 上放白字还是黑字」（宿主按亮度自动选，阈值 0.45）。
 *
 * 用法：
 *   node scripts/theme-tools/theme-check.mjs                 # 校验 dist-themes 下全部
 *   node scripts/theme-tools/theme-check.mjs path/to/x.theme  # 校验单个
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/* ---------------- WCAG 计算 ---------------- */

function parseHex(hex) {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relLuminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

/** 对比度：1 ~ 21 */
function contrast(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 该背景上应配黑字还是白字 */
function foregroundFor(bg) {
  return relLuminance(bg) > 0.45 ? '#101216' : '#ffffff';
}

/* ---------------- 主流程 ---------------- */

/** 每一项的对比度下限依据（依据 WCAG 2.1 AA） */
const RULES = [
  { key: 'fg on bg', fg: 'fg', bg: 'bg', min: 4.5, why: '正文' },
  { key: 'fg on card', fg: 'fg', bg: 'card', min: 4.5, why: '卡片正文' },
  { key: 'mutedFg on bg', fg: 'mutedFg', bg: 'bg', min: 3.0, why: '次要文字（AA 大字/非关键）' },
  { key: 'mutedFg on card', fg: 'mutedFg', bg: 'card', min: 3.0, why: '卡片次要文字' },
  { key: 'accent on bg', fg: 'accent', bg: 'bg', min: 3.0, why: '强调色元素/链接' },
  { key: 'accent on card', fg: 'accent', bg: 'card', min: 3.0, why: '卡片内强调' },
  { key: 'border on bg', fg: 'border', bg: 'bg', min: 1.2, why: '卡片边界（需可分辨但不抢眼）' },
];

/** 校验一个主题包文件，返回未达标项数 */
function checkOne(file) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n${'='.repeat(60)}`);
  console.log(`主题：${pkg.manifest.name}  (${pkg.manifest.id})`);
  console.log('='.repeat(60));

  let failures = 0;
  for (const mode of ['light', 'dark']) {
    const v = pkg.pack[mode];
    console.log(`--- ${mode} ---`);
    for (const r of RULES) {
      const ratio = contrast(v[r.fg], v[r.bg]);
      const ok = ratio >= r.min;
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? '✓' : '✗'} ${r.key.padEnd(18)} ${ratio.toFixed(2).padStart(6)}:1 ` +
          `(需 ≥ ${r.min})  ${r.why}`,
      );
    }

    // accent 上的按钮文字
    //
    // ⚠️ 必须复刻宿主的 pickForeground（theme-store.ts / protocol.ts 里各有一份）：
    // 它按 accent 亮度**自动选**黑或白，不是固定白字。
    // 真实实现：relLuminance(accent) > 0.45 ? 深墨 : 白
    // 校验时必须走同样的决策，否则会误判深色主题（深底上的强调色常需配黑字）。
    const hostPicks = relLuminance(v.accent) > 0.45 ? '#101216' : '#ffffff';
    const hostRatio = contrast(v.accent, hostPicks);
    const hostOk = hostRatio >= 4.5;
    if (!hostOk) failures += 1;
    console.log(
      `  ${hostOk ? '✓' : '✗'} ${'按钮文字 on accent'.padEnd(18)} ${hostRatio.toFixed(2).padStart(6)}:1 ` +
        `(需 ≥ 4.5)  宿主会自动选 ${hostPicks}`,
    );

    // 反向提示：另一种前景色是否明显更好
    const alt = hostPicks === '#ffffff' ? '#101216' : '#ffffff';
    const altRatio = contrast(v.accent, alt);
    if (altRatio > hostRatio + 1.5) {
      console.log(
        `    ⚠ 另一种前景 ${alt} 可达 ${altRatio.toFixed(2)}:1，明显更好 —— ` +
          `说明主色明度处于中间地带（宿主阈值的盲区），建议再调`,
      );
    }

    const softRatio = contrast(v.fg, v.accentSoft);
    const softOk = softRatio >= 4.5;
    if (!softOk) failures += 1;
    console.log(
      `  ${softOk ? '✓' : '✗'} ${'fg on accentSoft'.padEnd(18)} ${softRatio.toFixed(2).padStart(6)}:1 ` +
        `(需 ≥ 4.5)  标签底色上的文字`,
    );
  }
  return failures;
}

// 单文件模式 / 批量模式
const arg = process.argv[2];
let files;
if (arg) {
  files = [resolve(arg)];
} else {
  const dir = resolve(process.cwd(), 'dist-themes');
  files = readdirSync(dir)
    .filter((f) => f.endsWith('.theme'))
    .map((f) => join(dir, f));
}

if (files.length === 0) {
  console.log('没有找到 .theme 文件');
  process.exit(0);
}

let totalFailures = 0;
for (const f of files) {
  totalFailures += checkOne(f);
}

console.log(`\n${'='.repeat(60)}`);
if (totalFailures) {
  console.log(`FAIL: ${totalFailures} 项未达 WCAG AA（共 ${files.length} 个主题包）`);
  process.exit(1);
}
console.log(`PASS: ${files.length} 个主题包全部达到 WCAG AA`);
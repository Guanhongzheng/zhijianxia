'use strict';

/**
 * scripts/make-theme-covers.mjs —— 为缺少封面的主题生成封面图
 *
 * 封面是**纯色渐变**（主色 → 底色），不含文字 ——
 * 纯 Node 手写 PNG 编码，不引入任何图形库依赖。
 *
 * 用法：node scripts/make-theme-covers.mjs
 */

import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'server', 'packages', 'themes');

/* -------------------------------------------------------------------------- */
/* 最小 PNG 编码器                                                             */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 生成竖向渐变 PNG（顶部 from → 底部 to）。
 * @param {number} width
 * @param {number} height
 * @param {number[]} from RGB
 * @param {number[]} to RGB
 */
function gradientPng(width, height, from, to) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                      */
/* -------------------------------------------------------------------------- */

function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, ratio) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * ratio));
}

const WIDTH = 1280;
const HEIGHT = 720;

let created = 0;
for (const slug of ['ink-dai', 'lime-kick', 'crimson-rose']) {
  const dir = path.join(THEMES_DIR, slug);
  const cover = path.join(dir, 'cover.png');
  if (existsSync(cover)) {
    console.log(`  跳过 ${slug}：已有封面`);
    continue;
  }
  const theme = JSON.parse(readFileSync(path.join(dir, 'theme.json'), 'utf8'));
  const colors = theme.colors ?? {};
  const accent = hexToRgb(colors['--accent']);
  const bg = hexToRgb(colors['--bg']);
  if (!accent || !bg) {
    console.log(`  跳过 ${slug}：色板不完整`);
    continue;
  }
  // 顶部偏主色，底部沉入底色 —— 让人一眼看出主题的色调
  const png = gradientPng(WIDTH, HEIGHT, mix(accent, bg, 0.25), mix(bg, accent, 0.12));
  writeFileSync(cover, png);
  created += 1;
  console.log(`  ✓ ${slug}/cover.png（${WIDTH}×${HEIGHT}）`);
}

console.log(`\n共生成 ${created} 张封面`);

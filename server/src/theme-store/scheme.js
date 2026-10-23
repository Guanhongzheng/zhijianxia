'use strict';

/**
 * scheme.js —— 判断主题的亮/暗基调。
 *
 * 单独成文件（而不是塞在 scanner.js 里）的原因：
 * 它是**可单测的纯函数**，而 scanner 需要真的读磁盘。
 * `scripts/theme-search-test.mjs` 会直接调它来给测试语料补 scheme。
 *
 * 阈值与前端 `src/lib/theme/protocol.ts` 的 `relLuminance(bg) > 0.4` 保持一致 ——
 * 两套口径不一致会出现「前端按亮色派生暗色、列表却标成暗色」这种诡异现象。
 */

/**
 * @param {object} json theme.json 原文
 * @returns {'dark'|'light'}
 */
function detectScheme(json) {
  const declared = typeof json?.scheme === 'string' ? json.scheme.trim().toLowerCase() : '';
  if (declared === 'dark' || declared === 'light') return declared;

  // 无声明 → 按 --bg 亮度推断
  const bg = json?.colors?.['--bg'];
  if (typeof bg === 'string') {
    const hex = bg.trim().replace(/^#/, '');
    const full =
      hex.length === 3
        ? hex.split('').map((c) => c + c).join('')
        : hex.length === 8
          ? hex.slice(0, 6)
          : hex;
    if (/^[0-9a-fA-F]{6}$/.test(full)) {
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const lum =
        0.2126 * channel(parseInt(full.slice(0, 2), 16)) +
        0.7152 * channel(parseInt(full.slice(2, 4), 16)) +
        0.0722 * channel(parseInt(full.slice(4, 6), 16));
      return lum > 0.4 ? 'light' : 'dark';
    }
  }

  // 连背景色都没有：按亮色处理（协议转换的默认基准就是亮色）
  return 'light';
}

module.exports = { detectScheme };

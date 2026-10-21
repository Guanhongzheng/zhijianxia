/**
 * 复制 ONNX Runtime 的 wasm 二进制到 public/ort/。
 *
 * 为什么需要这一步：
 * Transformers.js 默认从 `cdn.jsdelivr.net` 拉取 onnxruntime-web 的 wasm 文件
 * （约 21MB）。该域名在国内网络下经常 TLS 握手失败，
 * 导致推理引擎初始化报 `Failed to fetch` / `no available backend found`。
 *
 * 把 wasm 放到本地 public 目录后，浏览器从同源加载，
 * 既绕开 CDN 不可达问题，也让首屏更快。
 *
 * 由 `postinstall` 自动执行，产物不纳入版本库。
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const outDir = join(root, 'public', 'ort');

/** 需要复制的文件 —— 与 onnxruntime-web 实际请求的文件名保持一致 */
const FILES = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];

if (!existsSync(srcDir)) {
  console.warn('[zj] 未找到 onnxruntime-web，跳过 wasm 复制（请先 npm install）');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const name of FILES) {
  const from = join(srcDir, name);
  if (!existsSync(from)) {
    console.warn(`[zj] 跳过不存在的文件：${name}`);
    continue;
  }
  cpSync(from, join(outDir, name));
  copied += 1;
}

console.log(`[zj] 已复制 ${copied} 个 wasm 文件到 public/ort/`);

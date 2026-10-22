/**
 * 模型下载 —— 只把权重拉到本地缓存，**不**创建推理 session。
 *
 * ## 为什么需要单独的下载步骤
 *
 * 原本「下载」与「加载」是同一个动作（pipeline() 一把梭），带来两个问题：
 * 1. 用户无法预先知道权重在不在本地 —— 点了才知道，可能白下载几百 MB；
 * 2. 下载完才发现这个模型在自己的机器上跑不起来（见 WebGPU 大模型问题），
 *    钱（流量）与时间全白花。
 *
 * 拆开后：先「下载」（可中断、可预判体积），再「加载」（纯本地读缓存，很快）。
 *
 * ## 与 Transformers.js 的缓存兼容
 *
 * 两者用的是**同一个**分片缓存实现（model-cache.ts）：
 * - 键是完整的远端 URL，规则照抄 Transformers.js 的 `pathJoin`：
 *   `remoteHost + remotePathTemplate.replace({model},{revision}) + filename`
 * - 写入走 `modelCache.put(url, response)`，与 Transformers 内部调用的是同一个方法。
 *
 * 因此下载完点「加载」时，Transformers.js 能直接命中缓存，不会重复下载。
 *
 * ⚠️ 为什么必须用分片缓存：Chrome 的 Cache API 单条目上限约 256MB
 * （实测 200MB 通过、256MB 失败），而权重最小 417MB、最大 1.78GB。
 * 详见 model-cache.ts。
 */

import { findModelSource, type LocalModelOption } from './local-models';
import { invalidateDownloadState } from './model-download';
import { modelCache } from './model-cache';

/** Transformers.js 的浏览器缓存名（须与库内部一致） */
const CACHE_NAME = 'transformers-cache';

/**
 * 下载所需的文件。
 *
 * ⚠️ 顺序有意义：**小文件在前**。
 * 权重动辄几百 MB～1.7GB，把它排在最后，一旦中途失败，
 * 前面的小文件已经落进缓存，重试时不必重下；
 * 排在最前则失败后什么都没留下。
 *
 * onnx 权重只取 `model_q4.onnx` —— 应用固定用 q4 精度（见 runtime.ts），
 * 其它精度的权重文件不需要下载。
 */
const REQUIRED_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_q4.onnx',
];

/** 下载进度 */
export interface DownloadProgress {
  /** 当前正在下载的文件 */
  file: string;
  /** 已完成字节 */
  loaded: number;
  /** 总字节 */
  total: number;
  /** 总体进度 0-1 */
  ratio: number;
  /** 速度（字节/秒），下载刚开始时可能为 0 */
  speed?: number;
}

/** 下载结果 */
export interface DownloadResult {
  modelId: string;
  /** 实际下载的文件清单 */
  files: string[];
  /** 总耗时（毫秒） */
  ms: number;
}

/**
 * 拼出某个文件的远端 URL。
 * 规则与 Transformers.js 的 pathJoin 一致（去掉多余的斜杠）。
 */
function buildUrl(
  modelId: string,
  filename: string,
  sourceId: 'modelscope' | 'hf-official',
): string {
  const src = findModelSource(sourceId);
  const base = src.pathTemplate
    .replaceAll('{model}', modelId)
    .replaceAll('{revision}', encodeURIComponent(src.revision));
  const host = src.host.endsWith('/') ? src.host.slice(0, -1) : src.host;
  const dir = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${host}/${dir}/${filename}`;
}

/**
 * 下载一个模型的所有必要文件到浏览器缓存。
 *
 * 已在缓存里的文件会跳过（所以重复点「下载」不会重新拉流量）。
 *
 * @param model 模型项
 * @param sourceId 下载源
 * @param onProgress 进度回调
 * @param signal 中止信号
 */
export async function downloadModel(
  model: LocalModelOption,
  sourceId: 'modelscope' | 'hf-official' = 'modelscope',
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    throw new Error('当前环境不支持浏览器缓存，无法下载模型');
  }

  const t0 = Date.now();

  // 先探明各文件大小，用于算总体进度
  const plan: { filename: string; url: string; size: number }[] = [];
  for (const filename of REQUIRED_FILES) {
    const url = buildUrl(model.id, filename, sourceId);
    let size = 0;
    try {
      const head = await fetch(url, { method: 'HEAD', signal });
      if (head.ok) {
        const len = head.headers.get('content-length');
        if (len) size = Number(len);
      }
    } catch {
      // HEAD 失败不影响后续 GET
    }
    plan.push({ filename, url, size });
  }

  const totalBytes = plan.reduce((s, p) => s + (p.size || 0), 0);
  let doneBytes = 0;

  const downloaded: string[] = [];

  for (const item of plan) {
    if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError');

    // 已缓存则跳过
    const hit = await modelCache.match(item.url);
    if (hit) {
      doneBytes += item.size || (await hit.blob()).size;
      onProgress?.({
        file: item.filename,
        loaded: doneBytes,
        total: totalBytes,
        ratio: totalBytes ? doneBytes / totalBytes : 0,
      });
      downloaded.push(item.filename);
      continue;
    }

    const res = await fetch(item.url, { signal });
    if (!res.ok) {
      throw new Error(`下载失败（HTTP ${res.status}）：${item.filename}`);
    }

    // 边读边累计进度，最后整体写入缓存。
    //
    // ⚠️ 内存占用控制：1.7GB 的权重如果「先攒 chunks 再 merge」，
    // 峰值会到 3.4GB（chunks + 合并后的整块），浏览器容易直接崩。
    // 这里在拿到 content-length 时**直接预分配**一块目标缓冲并原地写入，
    // 峰值就是 1 份；只有服务端没给 content-length 时才退回 chunks 方案。
    const contentLength = Number(res.headers.get('content-length')) || 0;
    const reader = res.body?.getReader();
    let buffer: Uint8Array;

    if (reader && contentLength > 0) {
      let target = new Uint8Array(contentLength);
      let offset = 0;
      const startedAt = Date.now();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          // 少数情况下服务端给的 content-length 偏小，兜底扩容
          if (offset + value.length > target.length) {
            const grown = new Uint8Array(offset + value.length);
            grown.set(target.subarray(0, offset));
            target = grown;
          }
          target.set(value, offset);
          offset += value.length;
          const elapsed = (Date.now() - startedAt) / 1000;
          onProgress?.({
            file: item.filename,
            loaded: doneBytes + offset,
            total: totalBytes,
            ratio: totalBytes ? (doneBytes + offset) / totalBytes : 0,
            speed: elapsed > 0.5 ? Math.round(offset / elapsed) : 0,
          });
        }
      }
      buffer = offset === target.length ? target : target.subarray(0, offset);
    } else if (reader) {
      const chunks: Uint8Array[] = [];
      let received = 0;
      const startedAt = Date.now();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          const elapsed = (Date.now() - startedAt) / 1000;
          onProgress?.({
            file: item.filename,
            loaded: doneBytes + received,
            total: totalBytes,
            ratio: totalBytes ? (doneBytes + received) / totalBytes : 0,
            speed: elapsed > 0.5 ? Math.round(received / elapsed) : 0,
          });
        }
      }
      const merged = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      buffer = merged;
    } else {
      buffer = new Uint8Array(await res.arrayBuffer());
    }

    // 写入缓存 —— 走分片缓存（modelCache.put），
    // 与 Transformers.js 内部用的是同一个实现，
    // 所以点「加载」时它能直接命中缓存，不会重新下载。
    try {
      // 用 ArrayBuffer 而非 Uint8Array —— TS 的 BodyInit 类型不接受
      // 泛型化的 Uint8Array<ArrayBufferLike>。
      const body = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
      await modelCache.put(item.url, new Response(body, { headers: res.headers }));
    } catch (err) {
      // 配额不足等不该让整个下载失败 —— 至少文件已在内存里，
      // 只是下次加载时需要重新下载。给出明确提示。
      console.warn('[zj-ai] 写入浏览器缓存失败：', err);
      throw new Error(
        `浏览器缓存写入失败（可能是存储空间不足）：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    doneBytes += buffer.byteLength;
    downloaded.push(item.filename);
    onProgress?.({
      file: item.filename,
      loaded: doneBytes,
      total: totalBytes,
      ratio: totalBytes ? doneBytes / totalBytes : 1,
    });
  }

  // 缓存内容变了，下载状态需要重算
  invalidateDownloadState();

  return { modelId: model.id, files: downloaded, ms: Date.now() - t0 };
}

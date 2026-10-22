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
import { getCachedFileSize, modelCache } from './model-cache';

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
 * 计算进度比例，夹在 [0, 1]。
 *
 * 夹取不是为了好看：探测到的文件大小若与实际下载量有出入
 * （比如上游文件刚更新过），不夹就会出现 1400% 这种离谱数字。
 */
function clampRatio(loaded: number, total: number, fallback = 0): number {
  if (!total || total <= 0) return fallback;
  return Math.min(1, Math.max(0, loaded / total));
}

/**
 * 探测某个文件的字节数。
 *
 * ## 踩过的坑
 *
 * 1. **不能用 HEAD** —— 魔搭的 HEAD 响应**根本不带 content-length**
 *    （实测 `HEAD → 200` 但无该头），于是总量算成 0，
 *    进度百分比永远是 0%（而速度正常，因为速度是独立算的）。
 * 2. **也不能用 `Range: bytes=0-0` 去读 `Content-Range`** ——
 *    `Content-Range` **不在 CORS 安全响应头白名单里**，跨域读出来是 null；
 *    于是回退到 `content-length`，而 Range 响应的 content-length 是
 *    **本次请求的长度（1 字节）**，不是文件总长 →
 *    5 个文件各 1 字节，分母算成 5 字节，百分比飙到上千万%。
 *
 * ## 正确做法
 *
 * 普通 `GET` —— 响应头一到就能读到 `content-length`
 * （`Content-Length` **在** CORS 安全响应头白名单里，跨域可读），
 * 随即 `cancel()` 掉正文，只取元信息不下载内容。
 */
async function probeFileSize(url: string, signal?: AbortSignal): Promise<number> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      void res.body?.cancel?.().catch(() => {});
      return 0;
    }
    const len = Number(res.headers.get('content-length'));
    // 立刻取消正文 —— 只为拿长度，不真下载
    void res.body?.cancel?.().catch(() => {});
    return Number.isFinite(len) && len > 0 ? len : 0;
  } catch {
    return 0;
  }
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

  // 先探明各文件大小，用于算总体进度。
  // 并发探测 —— 每个只是 1 字节的 Range 请求，很快。
  const plan: { filename: string; url: string; size: number }[] = await Promise.all(
    REQUIRED_FILES.map(async (filename) => {
      const url = buildUrl(model.id, filename, sourceId);
      return { filename, url, size: await probeFileSize(url, signal) };
    }),
  );

  // 兜底：万一探测失败（服务端不支持 Range 且不给 content-length），
  // 至少用模型清单里记录的 q4 权重实际大小估算，
  // 否则进度分母为 0，百分比会一直显示 0%。
  const onnxItem = plan.find((p) => p.filename.startsWith('onnx/'));
  if (onnxItem && onnxItem.size === 0 && model.q4Bytes) {
    onnxItem.size = model.q4Bytes;
  }

  const totalBytes = plan.reduce((s, p) => s + p.size, 0);
  let doneBytes = 0;

  const downloaded: string[] = [];

  for (const item of plan) {
    if (signal?.aborted) throw new DOMException('下载已取消', 'AbortError');

    // 已缓存则跳过。
    // ⚠️ 取大小要读**元信息**，绝不能用 `match().blob().size` ——
    // 那会把整个文件（最大 1.8GB）读进内存，只为拿个数字。
    const hit = await modelCache.match(item.url);
    if (hit) {
      const cachedSize = (await getCachedFileSize(item.url)) || item.size;
      doneBytes += cachedSize;
      onProgress?.({
        file: item.filename,
        loaded: doneBytes,
        total: totalBytes,
        ratio: clampRatio(doneBytes, totalBytes),
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
            ratio: clampRatio(doneBytes + offset, totalBytes),
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
            ratio: clampRatio(doneBytes + received, totalBytes),
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
      ratio: clampRatio(doneBytes, totalBytes, 1),
    });
  }

  // 缓存内容变了，下载状态需要重算
  invalidateDownloadState();

  return { modelId: model.id, files: downloaded, ms: Date.now() - t0 };
}

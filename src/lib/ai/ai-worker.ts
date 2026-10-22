/**
 * AI 推理 Worker —— 把「加载模型」与「生成文本」全部放到独立线程。
 *
 * ## 为什么需要
 *
 * 1.5B 模型在 WASM 后端下单次 forward 会**同步阻塞主线程 10 秒以上**
 * （实测：首次 prefill 阻塞 10767ms，后续每个 token 约 700ms）。
 * 浏览器连续阻塞超过 5 秒就会弹「页面未响应」——
 * 用户看到的正是「网页显示未响应但没有报错」：生成其实还在继续。
 *
 * ## 设计要点
 *
 * **模型 buffer 全程只存在于 Worker 里。**
 * ONNX Runtime 自带的 proxy 模式（`env.wasm.proxy = true`）会把模型
 * postMessage 给 Worker，而 postMessage 是**拷贝**不是转移 ——
 * 1.58 GB 的模型意味着主线程 + Worker + wasm 堆共约 4.7 GB 峰值。
 *
 * 本方案让 Worker **自己**从浏览器 Cache API 读权重
 * （分片缓存，主线程与 Worker 读的是同一份），
 * 主线程从头到尾不碰大 buffer，峰值只有一份。
 *
 * ## 环境差异
 *
 * Worker 里**没有 window**：
 * - `localStorage` 不可用 → 模型源等偏好由主线程通过消息传进来；
 * - 但 `caches`（Cache API）、`fetch`、`SharedArrayBuffer` 都可用 ✓
 */

import type { TextGenerationPipeline } from '@huggingface/transformers';
import { applyOrtEnv } from './ort-setup';
import { modelCache, deleteModelFiles } from './model-cache';
import { isCacheRelatedError } from './cache-errors';

/** 一次运行尝试（设备 + 精度） */
export interface RuntimeAttempt {
  device: 'webgpu' | 'wasm';
  dtype: string;
}

/** 主线程 → Worker 的消息 */
export type WorkerRequest =
  | {
      type: 'load';
      id: string;
      modelId: string;
      /** 运行时阶梯 —— 依次尝试，失败自动降级 */
      runtimes: RuntimeAttempt[];
      sourceId: 'modelscope' | 'hf-official';
      revision: string;
    }
  | {
      type: 'generate';
      id: string;
      modelId: string;
      runtimes: RuntimeAttempt[];
      sourceId: 'modelscope' | 'hf-official';
      revision: string;
      prompt: string;
      maxTokens: number;
      temperature: number;
      doSample: boolean;
    }
  | { type: 'unload'; id: string }
  | { type: 'abort'; id: string };

/** Worker → 主线程的消息 */
export type WorkerResponse =
  | { type: 'progress'; id: string; progress: number; file?: string }
  | { type: 'loaded'; id: string; ok: true }
  | { type: 'error'; id: string; message: string }
  | { type: 'token'; id: string; text: string }
  | { type: 'done'; id: string };

/** 已加载的模型与它的 pipeline */
let pipeline: TextGenerationPipeline | null = null;
let pipelineKey = '';
/** 正在进行的生成任务（用于中断） */
let activeTask: { id: string; cancelled: boolean } | null = null;
/** 正在进行的加载任务 —— 用于互斥，避免并发建 session */
let loadingPromise: Promise<TextGenerationPipeline> | null = null;
/** 本地 tokenizer（懒加载，供 TextStreamer 使用） */
let localTokenizer: unknown = null;
let tokenizerKey = '';

/** 拼接聊天模板（与主线程的 applyChatTemplate 保持一致） */
function buildPrompt(messages: { role: string; content: string }[], family: string): string {
  const chatml =
    family === 'qwen' || family === 'chatml'
      ? '<|im_start|>'
      : '<|start|>';
  const end = family === 'qwen' || family === 'chatml' ? '<|im_end|>' : '<|endoftext|>';
  let out = '';
  for (const m of messages) {
    out += `${chatml}${m.role}\n${m.content}${end}\n`;
  }
  out += `${chatml}assistant\n`;
  return out;
}

/** 推断模型族（与主线程 resolveFamily 逻辑一致） */
function resolveFamily(modelId: string): 'qwen' | 'smol' | 'chatml' {
  const lower = modelId.toLowerCase();
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('smol')) return 'smol';
  return 'chatml';
}

/** 应用模型源与缓存配置 */
async function configureEnv(
  sourceId: 'modelscope' | 'hf-official',
  revision: string,
  device: 'webgpu' | 'wasm',
): Promise<void> {
  const { env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  // 模型源由主线程传进来（Worker 里没有 localStorage）
  const source =
    sourceId === 'hf-official'
      ? {
          host: 'https://huggingface.co/',
          pathTemplate: '{model}/resolve/{revision}/',
        }
      : {
          host: 'https://www.modelscope.cn/',
          pathTemplate: 'models/{model}/resolve/{revision}/',
        };
  env.remoteHost = source.host;
  env.remotePathTemplate = source.pathTemplate;
  // 与主线程共用同一份分片缓存 —— Worker 独立从 Cache API 读权重
  env.useCustomCache = true;
  env.customCache = modelCache;
  await applyOrtEnv(env as never, device);
}

/**
 * 加载（或复用）pipeline。
 *
 * **降级阶梯在 Worker 里执行**：主线程算好阶梯（WebGPU → WASM 等）传进来，
 * 这里依次尝试，某一档成功就用它。
 * 阶梯之所以不在主线程执行，是因为模型**只能存在于 Worker 一份** ——
 * 主线程再建一份 session 就是内存翻倍（1.58 GB × 2）。
 */
async function ensurePipeline(
  modelId: string,
  runtimes: RuntimeAttempt[],
  sourceId: 'modelscope' | 'hf-official',
  revision: string,
  onProgress?: (p: number, file?: string) => void,
): Promise<TextGenerationPipeline> {
  const key = `${modelId}|${runtimes.map((r) => `${r.device}:${r.dtype}`).join(',')}|${sourceId}`;
  if (pipeline && pipelineKey === key) return pipeline;

  // ⚠️ 必须互斥 —— 没有它会出大事：
  // 「加载模型」还没跑完时，AI 对话又发一次 generate，两次 ensurePipeline
  // 会**并发**建 session。而 ORT 的 wasm 运行时不支持并发建 session
  //（后一次把前一次顶掉），表现为两边都卡住、谁也不返回。
  if (loadingPromise) {
    try {
      return await loadingPromise;
    } catch {
      // 上一次失败了 —— 落到下面重新加载
    }
  }

  const { pipeline: createPipeline } = await import('@huggingface/transformers');
  let lastError: unknown;

  let cacheRetried = false;
  const doLoad = async (): Promise<TextGenerationPipeline> => {
  // 用 index 循环而非 for..of —— 需要在清缓存后**重跑同一档**
  for (let idx = 0; idx < runtimes.length; idx += 1) {
    const rt = runtimes[idx];
    try {
      await configureEnv(sourceId, revision, rt.device);
      const created = await createPipeline('text-generation', modelId, {
        dtype: rt.dtype as 'q4',
        device: rt.device === 'webgpu' ? 'webgpu' : 'wasm',
        revision,
        progress_callback: (p: unknown) => {
          const info = p as { status?: string; progress?: number; file?: string };
          if (info.status === 'progress' && typeof info.progress === 'number') {
            onProgress?.(info.progress / 100, info.file);
          } else if (info.status === 'ready' || info.status === 'done') {
            onProgress?.(1, info.file);
          }
        },
      });
      pipeline = created as TextGenerationPipeline;
      pipelineKey = key;
      return pipeline;
    } catch (err) {
      lastError = err;
      console.warn(
        `[zj-ai] 运行时 ${rt.device}/${rt.dtype} 加载失败，尝试下一档：`,
        err instanceof Error ? err.message : err,
      );

      // ⚠️ 只在错误确实与缓存/网络相关时才清缓存重试。
      // 权重动辄几百 MB～1.6 GB，无条件清会让用户每次都重新下载一遍。
      // （这条逻辑原先在主线程，重构搬到 Worker 时必须一并带过来。）
      if (!cacheRetried && isCacheRelatedError(err)) {
        cacheRetried = true;
        console.warn('[zj-ai] 错误指向缓存/网络，清掉模型缓存后重试一次');
        try {
          await deleteModelFiles(modelId);
        } catch {
          /* 清缓存失败不影响重试 */
        }
        // 重跑这一档（idx 回退一格）
        idx -= 1;
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  loadingPromise = doLoad();
  try {
    const created = await loadingPromise;
    return created;
  } finally {
    loadingPromise = null;
  }
}

/** 释放 pipeline 及其底层 session */
async function releasePipeline(): Promise<void> {
  const inst = pipeline;
  pipeline = null;
  pipelineKey = '';
  localTokenizer = null;
  tokenizerKey = '';
  if (!inst) return;
  for (const target of [inst, (inst as { model?: unknown }).model]) {
    if (!target || typeof target !== 'object') continue;
    const bag = target as Record<string, unknown>;
    for (const key of ['dispose', 'release', 'free']) {
      const fn = bag[key];
      if (typeof fn === 'function') {
        try {
          await (fn as () => unknown).call(target);
        } catch {
          /* 释放失败不阻断 */
        }
      }
    }
  }
}

/** 加载（或复用）tokenizer */
async function ensureTokenizer(modelId: string): Promise<unknown> {
  if (localTokenizer && tokenizerKey === modelId) return localTokenizer;
  const { AutoTokenizer } = await import('@huggingface/transformers');
  localTokenizer = await AutoTokenizer.from_pretrained(modelId, {});
  tokenizerKey = modelId;
  return localTokenizer;
}

/** 处理一条消息 */
async function handle(req: WorkerRequest): Promise<void> {
  const post = (msg: WorkerResponse) =>
    (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(msg);

  if (req.type === 'unload') {
    await releasePipeline();
    // ⚠️ 必须回 req.id —— 之前硬编码成 'unload'，与主线程 pending map 的 key
    // 对不上，导致 unloadInWorker() 永远 pending：
    // 设置面板的「加载模型」onClick 先 await unloadLocalModel()，
    // 于是卡在第一步，loadLocalModel 根本没被调用（界面一直「未就绪」）。
    post({ type: 'done', id: req.id });
    return;
  }

  if (req.type === 'abort') {
    if (activeTask && activeTask.id === req.id) activeTask.cancelled = true;
    return;
  }

  if (req.type === 'load') {
    try {
      await ensurePipeline(
        req.modelId,
        req.runtimes,
        req.sourceId,
        req.revision,
        (progress, file) => post({ type: 'progress', id: req.id, progress, file }),
      );
      post({ type: 'loaded', id: req.id, ok: true });
    } catch (err) {
      post({
        type: 'error',
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (req.type === 'generate') {
    const task = { id: req.id, cancelled: false };
    activeTask = task;
    try {
      const pipe = await ensurePipeline(
        req.modelId,
        req.runtimes,
        req.sourceId,
        req.revision,
        (progress, file) => post({ type: 'progress', id: req.id, progress, file }),
      );
      const { TextStreamer } = await import('@huggingface/transformers');
      const tokenizer = await ensureTokenizer(req.modelId);

      const streamer = new TextStreamer(tokenizer as never, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          if (!text) return;
          post({ type: 'token', id: req.id, text });
        },
      });

      await pipe(req.prompt, {
        max_new_tokens: req.maxTokens,
        temperature: req.temperature,
        do_sample: req.doSample,
        return_full_text: false,
        streamer,
      } as never);

      post({ type: 'done', id: req.id });
    } catch (err) {
      post({
        type: 'error',
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (activeTask === task) activeTask = null;
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  const req = e.data as WorkerRequest;
  void handle(req);
};

/** 供主线程侧引用，避免 tree-shaking 掉未使用的导出 */
export { buildPrompt, resolveFamily };

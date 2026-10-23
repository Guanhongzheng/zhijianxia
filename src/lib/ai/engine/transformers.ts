/**
 * engine/transformers.ts —— 当前的默认引擎：Transformers.js + ONNX Runtime Web。
 *
 * 本文件的内容几乎是从 `ai-worker.ts` 原样搬来的（含实测注释），
 * 只把「模块级单例」收进了 `createTransformersEngine()` 的闭包里，
 * 并对外暴露 `load / generate / unload` 三个动作。
 *
 * ## 迁移时**绝不能丢**的三件事
 *
 * 1. **模型 buffer 只存在于 Worker 里**：所以本文件只在 Worker 中被加载，
 *    主线程永远拿不到权重（见 ai-worker.ts 顶部的实测说明）。
 * 2. **降级阶梯在引擎内部执行**：主线程算好 `runtimes` 阶梯传进来，
 *    某一档失败就试下一档。阶梯不在主线程跑是因为模型只能有一份。
 * 3. **只有在错误确实与缓存/网络相关时才清缓存**：权重动辄几百 MB ~ 1.6 GB，
 *    无条件清会让用户每次重新下载。
 */

import type { TextGenerationPipeline } from '@huggingface/transformers';
import { applyOrtEnv } from '../ort-setup';
import { modelCache, deleteModelFiles } from '../model-cache';
import { isCacheRelatedError } from '../cache-errors';
import type {
  EngineGenerateParams,
  EngineLoadParams,
  EngineProgress,
  EngineRuntimeAttempt,
  InferenceEngine,
} from './types';

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
 * 创建 Transformers.js 引擎实例。
 *
 * 单例语义交给调用方（registry 只创建一次）；这里的状态都是**闭包内**的，
 * 避免模块级可变状态带来的「卸载后残留」类问题。
 */
export function createTransformersEngine(): InferenceEngine {
  /** 已加载的模型与它的 pipeline */
  let pipeline: TextGenerationPipeline | null = null;
  let pipelineKey = '';
  /** 正在进行的加载任务 —— 用于互斥，避免并发建 session */
  let loadingPromise: Promise<TextGenerationPipeline> | null = null;
  /** 本地 tokenizer（懒加载，供 TextStreamer 使用） */
  let localTokenizer: unknown = null;
  let tokenizerKey = '';

  /**
   * 加载（或复用）pipeline。
   *
   * **降级阶梯在引擎里执行**：主线程算好阶梯（WebGPU → WASM 等）传进来，
   * 这里依次尝试，某一档成功就用它。
   */
  async function ensurePipeline(
    modelId: string,
    runtimes: EngineRuntimeAttempt[],
    sourceId: 'modelscope' | 'hf-official',
    revision: string,
    onProgress?: EngineProgress,
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

  return {
    id: 'transformers',
    name: 'Transformers.js（ONNX Runtime Web）',
    weightFormat: 'onnx',

    async load(params: EngineLoadParams, onProgress?: EngineProgress): Promise<void> {
      await ensurePipeline(
        params.modelId,
        params.runtimes,
        params.sourceId,
        params.revision,
        onProgress,
      );
    },

    async generate(
      params: EngineGenerateParams,
      onToken: (text: string) => void,
      onProgress?: EngineProgress,
    ): Promise<void> {
      const pipe = await ensurePipeline(
        params.modelId,
        params.runtimes,
        params.sourceId,
        params.revision,
        onProgress,
      );
      const { TextStreamer } = await import('@huggingface/transformers');
      const tokenizer = await ensureTokenizer(params.modelId);

      const streamer = new TextStreamer(tokenizer as never, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          if (!text) return;
          onToken(text);
        },
      });

      await pipe(params.prompt, {
        max_new_tokens: params.maxTokens,
        temperature: params.temperature,
        do_sample: params.doSample,
        return_full_text: false,
        streamer,
      } as never);
    },

    async unload(): Promise<void> {
      await releasePipeline();
    },
  };
}

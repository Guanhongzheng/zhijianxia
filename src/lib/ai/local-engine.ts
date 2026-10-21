/**
 * 本地离线 AI 引擎 —— 基于 Transformers.js 在浏览器内加载量化大语言模型。
 * 所有推理在用户设备本地完成，提示词不上传，隐私优先。
 */

import type { TextGenerationPipeline } from '@huggingface/transformers';
import {
  DEFAULT_LOCAL_MODEL,
  findModelOption,
  findModelSource,
  inferFamily,
  type ModelFamily,
  type ModelSourceId,
} from './local-models';

export {
  DEFAULT_LOCAL_MODEL,
  LOCAL_MODEL_OPTIONS,
  MODEL_SOURCES,
  findModelOption,
  findModelSource,
} from './local-models';
export type { ModelFamily, ModelSourceId } from './local-models';

export type LocalAiStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LocalAiState {
  status: LocalAiStatus;
  /** 模型加载进度 0-1 */
  progress: number;
  /** 模型 id */
  modelId: string;
  /** 当前使用的模型源（国内镜像 / 官方） */
  sourceId: ModelSourceId;
  error?: string;
}

/** 模型源在 localStorage 中的键 */
const SOURCE_KEY = 'zj-model-source';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 引擎单例 —— 保证同一页面只加载一次模型 */
let pipelinePromise: Promise<TextGenerationPipeline> | null = null;
let loadedModelId = '';
let state: LocalAiState = {
  status: 'idle',
  progress: 0,
  modelId: DEFAULT_LOCAL_MODEL,
  sourceId: 'hf-mirror',
};

const listeners = new Set<(s: LocalAiState) => void>();

function emit(next: Partial<LocalAiState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* 单个订阅者异常不影响其它 */
    }
  });
}

export function subscribeLocalAi(fn: (s: LocalAiState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getLocalAiState(): LocalAiState {
  return state;
}

/** 读取已保存的模型源 */
export function readModelSource(): ModelSourceId {
  if (typeof window === 'undefined') return 'hf-mirror';
  try {
    const raw = window.localStorage.getItem(SOURCE_KEY);
    if (raw === 'hf-mirror' || raw === 'hf-official') return raw;
  } catch {
    /* 忽略 */
  }
  return 'hf-mirror';
}

/** 持久化并应用模型源（切换后需重新加载模型才会生效） */
export function saveModelSource(sourceId: ModelSourceId) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SOURCE_KEY, sourceId);
  } catch {
    /* 忽略 */
  }
  emit({ sourceId });
}

export function isLocalAiReady(): boolean {
  return state.status === 'ready';
}

/**
 * 加载本地模型。重复调用会复用同一个 Promise。
 * 加载期间会持续推送进度，用于渲染骨架屏。
 */
export async function loadLocalModel(
  modelId: string = DEFAULT_LOCAL_MODEL,
  onProgress?: (ratio: number) => void,
): Promise<TextGenerationPipeline> {
  if (pipelinePromise && loadedModelId === modelId) return pipelinePromise;

  loadedModelId = modelId;
  emit({
    status: 'loading',
    progress: 0,
    modelId,
    sourceId: readModelSource(),
    error: undefined,
  });

  pipelinePromise = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');

      // 允许跨域加载模型资源
      env.allowLocalModels = false;

      // 指向国内镜像源（hf-mirror.com），显著提升下载速度。
      // remotePathTemplate 保持默认的 {model}/resolve/{revision}/ 形式。
      const source = findModelSource(readModelSource());
      env.remoteHost = source.host;

      const instance = await pipeline('text-generation', modelId, {
        dtype: 'q4',
        progress_callback: (p: unknown) => {
          const info = p as {
            status?: string;
            progress?: number;
            file?: string;
            loaded?: number;
            total?: number;
          };
          if (info.status === 'progress' && typeof info.progress === 'number') {
            const ratio = Math.min(1, Math.max(0, info.progress / 100));
            emit({ progress: ratio });
            onProgress?.(ratio);
          } else if (info.status === 'ready' || info.status === 'done') {
            emit({ progress: 1 });
            onProgress?.(1);
          }
        },
      });

      emit({ status: 'ready', progress: 1 });
      return instance as TextGenerationPipeline;
    } catch (err) {
      emit({
        status: 'error',
        error: err instanceof Error ? err.message : '本地模型加载失败',
      });
      pipelinePromise = null;
      throw err;
    }
  })();

  return pipelinePromise;
}

/** 卸载模型（释放显存/内存） */
export async function unloadLocalModel() {
  pipelinePromise = null;
  loadedModelId = '';
  emit({
    status: 'idle',
    progress: 0,
    modelId: DEFAULT_LOCAL_MODEL,
    sourceId: readModelSource(),
  });
}

/**
 * 将 ChatMessage 数组转成对应模型族的聊天模板。
 *
 * 不同模型族的模板标记并不相同，若一律用 Qwen 的 ChatML，
 * 换用其它模型后模型会看不懂提示词，输出质量急剧下降。
 */
function applyChatTemplate(
  messages: ChatMessage[],
  family: ModelFamily,
): string {
  // Qwen / ChatML 系
  if (family === 'qwen' || family === 'chatml') {
    return (
      messages
        .map((m) => {
          const role =
            m.role === 'assistant'
              ? 'assistant'
              : m.role === 'system'
                ? 'system'
                : 'user';
          return `<|im_start|>${role}\n${m.content}<|im_end|>`;
        })
        .join('\n') + '<|im_start|>assistant\n'
    );
  }

  // SmolLM2 系：<|im_start|>role\ncontent<|im_end|>，与 ChatML 同构，
  // 但结尾不带 assistant 起始标记
  if (family === 'smol') {
    return (
      messages
        .map((m) => {
          const role =
            m.role === 'assistant'
              ? 'assistant'
              : m.role === 'system'
                ? 'system'
                : 'user';
          return `<|im_start|>${role}\n${m.content}<|im_end|>`;
        })
        .join('\n') + '<|im_start|>assistant\n'
    );
  }

  return '';
}

/** 解析模型所属模板族 */
function resolveFamily(modelId: string): ModelFamily {
  return findModelOption(modelId)?.family ?? inferFamily(modelId);
}

/**
 * 本地生成。返回纯文本。
 */
export async function localChat(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const pipe = await loadLocalModel();
  const { maxTokens = 512, temperature = 0.7 } = opts;

  const prompt = applyChatTemplate(messages, resolveFamily(loadedModelId));
  const output = (await pipe(prompt, {
    max_new_tokens: maxTokens,
    temperature,
    do_sample: temperature > 0,
    return_full_text: false,
  })) as unknown as Array<{ generated_text: string }>;

  const raw = output?.[0]?.generated_text ?? '';
  // 去掉可能残留的模板标记
  return raw
    .replace(/<\|im_start\|>assistant\s*/g, '')
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|endoftext\|>/g, '')
    .trim();
}

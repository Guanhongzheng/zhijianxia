/**
 * 本地离线 AI 引擎 —— 基于 Transformers.js 在浏览器内加载量化大语言模型。
 * 所有推理在用户设备本地完成，提示词不上传，隐私优先。
 */

import type { TextGenerationPipeline } from '@huggingface/transformers';

export type LocalAiStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LocalAiState {
  status: LocalAiStatus;
  /** 模型加载进度 0-1 */
  progress: number;
  /** 模型 id */
  modelId: string;
  error?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 默认模型：Xenova/Qwen1.5-0.5B-Chat（量化版，体积小，纯前端可跑） */
export const DEFAULT_LOCAL_MODEL = 'Xenova/Qwen1.5-0.5B-Chat';

/** 引擎单例 —— 保证同一页面只加载一次模型 */
let pipelinePromise: Promise<TextGenerationPipeline> | null = null;
let loadedModelId = '';
let state: LocalAiState = {
  status: 'idle',
  progress: 0,
  modelId: DEFAULT_LOCAL_MODEL,
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
  emit({ status: 'loading', progress: 0, modelId, error: undefined });

  pipelinePromise = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');

      // 允许跨域加载 Hugging Face 模型资源
      env.allowLocalModels = false;

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
  emit({ status: 'idle', progress: 0, modelId: DEFAULT_LOCAL_MODEL });
}

/** 将 ChatMessage 数组转成 Qwen ChatML 格式 */
function toChatML(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
      return `<|im_start|>${role}\n${m.content}<|im_end|>`;
    })
    .join('\n') + '<|im_start|>assistant\n';
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

  const output = (await pipe(toChatML(messages), {
    max_new_tokens: maxTokens,
    temperature,
    do_sample: temperature > 0,
    return_full_text: false,
  })) as unknown as Array<{ generated_text: string }>;

  const raw = output?.[0]?.generated_text ?? '';
  // 去掉可能残留的 ChatML 标记
  return raw
    .replace(/<\|im_start\|>assistant\s*/g, '')
    .replace(/<\|im_end\|>/g, '')
    .trim();
}

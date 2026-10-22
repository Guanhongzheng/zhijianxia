/**
 * AI Worker 的主线程客户端。
 *
 * 职责：
 * - 懒创建 / 复用 Worker（整个应用共用一个）；
 * - 把「加载模型」「生成文本」转成消息发给 Worker；
 * - 把 Worker 回传的增量文本转成异步迭代器；
 * - 处理中断。
 *
 * ## 为什么不直接用 ORT 自带的 proxy
 *
 * ORT 的 `env.wasm.proxy = true` 会把模型 buffer **postMessage** 给 Worker，
 * 而 postMessage 是拷贝不是转移 —— 1.58 GB 的模型意味着
 * 主线程 + Worker 消息副本 + Worker wasm 堆 ≈ 4.7 GB 峰值。
 *
 * 本方案让 Worker 自己从 Cache API 读权重（与主线程共用同一份分片缓存），
 * 主线程从头到尾不碰大 buffer。
 */

import type { WorkerRequest, WorkerResponse, RuntimeAttempt } from './ai-worker';

let worker: Worker | null = null;
let seq = 0;
let nextId = () => `t${++seq}`;

/** 等待中的请求 */
interface Pending {
  resolve: (v: void) => void;
  reject: (e: Error) => void;
  onProgress?: (p: number, file?: string) => void;
  onToken?: (text: string) => void;
  /** 生成类请求的中断句柄 */
  abort?: () => void;
}

const pending = new Map<string, Pending>();

/** 创建（或复用）Worker */
function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ai-worker.ts', import.meta.url));
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as WorkerResponse;
    const p = pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case 'progress':
        p.onProgress?.(msg.progress, msg.file);
        break;
      case 'loaded':
        pending.delete(msg.id);
        p.resolve();
        break;
      case 'token':
        p.onToken?.(msg.text);
        break;
      case 'done':
        pending.delete(msg.id);
        p.resolve();
        break;
      case 'error':
        pending.delete(msg.id);
        p.reject(new Error(msg.message));
        break;
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'AI Worker 运行失败');
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };
  return worker;
}

/** 发送一条消息并等待完成 */
function send(
  req: Omit<WorkerRequest, 'id'> & { id?: string },
  handlers: {
    onProgress?: (p: number, file?: string) => void;
    onToken?: (text: string) => void;
  } = {},
): { promise: Promise<void>; abort: () => void } {
  const w = ensureWorker();
  const id = nextId();
  const full = { ...req, id } as WorkerRequest;
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pending.set(id, { resolve, reject, ...handlers });
  w.postMessage(full);
  return {
    promise,
    abort: () => {
      w.postMessage({ type: 'abort', id } as WorkerRequest);
    },
  };
}

/** 加载模型所需的参数 */
export interface LoadParams {
  modelId: string;
  /** 运行时阶梯 —— Worker 依次尝试，失败自动降级 */
  runtimes: RuntimeAttempt[];
  sourceId: 'modelscope' | 'hf-official';
  revision: string;
}

/**
 * 在 Worker 里加载模型（主线程不阻塞）。
 */
export function loadInWorker(
  params: LoadParams,
  onProgress?: (p: number, file?: string) => void,
): Promise<void> {
  const { promise } = send({ type: 'load', ...params }, { onProgress });
  return promise;
}

/**
 * 在 Worker 里生成文本，逐段回调增量。
 */
export function generateInWorker(
  params: LoadParams & {
    prompt: string;
    maxTokens: number;
    temperature: number;
    doSample: boolean;
  },
  onToken: (text: string) => void,
  onProgress?: (p: number, file?: string) => void,
): { promise: Promise<void>; abort: () => void } {
  return send({ type: 'generate', ...params }, { onToken, onProgress });
}

/** 卸载 Worker 里的模型 */
export function unloadInWorker(): Promise<void> {
  const { promise } = send({ type: 'unload' });
  return promise;
}

/** 彻底终止 Worker（页面卸载时用） */
export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(new Error('AI Worker 已终止'));
  pending.clear();
}

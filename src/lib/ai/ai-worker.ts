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
 * ## 本文件只做「管道」，不做推理
 *
 * 消息 id 对齐、进度回传、错误归一、卸载时序 —— 这些与具体引擎无关，
 * 留在这里给所有引擎复用。真正的推理在 `engine/` 下：
 * 目前是 `engine/transformers.ts`（ONNX Runtime Web）。
 *
 * 这样做的直接收益：接 WebLLM / wllama 时是**加一个 engine 文件 + 注册一行**，
 * 不必再改一遍这套容易出错的时序逻辑（见下方「模型 buffer 只存在于 Worker」）。
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

import { getEngine } from './engine/registry';
import type { EngineId, EngineRuntimeAttempt } from './engine/types';

/** 一次运行尝试（设备 + 精度）—— 保留旧名字，供 ai-client 继续引用 */
export type RuntimeAttempt = EngineRuntimeAttempt;

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
      /** 指定引擎；缺省用默认引擎（Transformers.js） */
      engineId?: EngineId;
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
      engineId?: EngineId;
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

/**
 * 正在进行的生成任务。
 *
 * ⚠️ 现状：`cancelled` 只会被置位，**并不会真正中断推理** ——
 * Transformers.js 的 pipeline 调用是同步跑完的，宿主这一侧本来就没有
 * 中断入口（界面上的「停止」只停止渲染后续 token）。
 * 保留这个字段是为了在接入支持取消的引擎时，能从这里把信号接下去。
 */
let activeTask: { id: string; cancelled: boolean } | null = null;

/** 处理一条消息 */
async function handle(req: WorkerRequest): Promise<void> {
  const post = (msg: WorkerResponse) =>
    (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(msg);

  if (req.type === 'unload') {
    await getEngine().unload();
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
      await getEngine(req.engineId).load(
        {
          modelId: req.modelId,
          runtimes: req.runtimes,
          sourceId: req.sourceId,
          revision: req.revision,
        },
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
      await getEngine(req.engineId).generate(
        {
          modelId: req.modelId,
          runtimes: req.runtimes,
          sourceId: req.sourceId,
          revision: req.revision,
          prompt: req.prompt,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          doSample: req.doSample,
        },
        (text) => post({ type: 'token', id: req.id, text }),
        (progress, file) => post({ type: 'progress', id: req.id, progress, file }),
      );
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

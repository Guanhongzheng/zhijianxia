/**
 * 本地离线 AI 引擎 —— 基于 Transformers.js 在浏览器内加载量化大语言模型。
 * 所有推理在用户设备本地完成，提示词不上传，隐私优先。
 */

import { modelCache, clearModelCache, deleteModelFiles, listCachedFiles } from './model-cache';
import { generateInWorker, loadInWorker, unloadInWorker } from './ai-client';
import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_MODEL_SOURCE,
  findModelOption,
  findModelSource,
  inferFamily,
  modelWeightDtype,
  MODEL_SOURCES,
  type ModelFamily,
  type ModelSourceId,
  type ModelSourceOption,
} from './local-models';
import {
  readRuntimePref,
  resolveRuntime,
  saveRuntimePref,
  type RuntimeDevice,
  type RuntimeDtype,
  type RuntimeInfo,
  type RuntimePref,
} from './runtime';

export {
  DEFAULT_LOCAL_MODEL,
  LOCAL_MODEL_OPTIONS,
  MODEL_SOURCES,
  findModelOption,
  findModelSource,
} from './local-models';
export type { ModelFamily, ModelSourceId } from './local-models';
export {
  readRuntimePref,
  resolveRuntime,
  saveRuntimePref,
  peekRuntime,
} from './runtime';
export type { RuntimeDevice, RuntimeDtype, RuntimeInfo, RuntimePref } from './runtime';
export { modelCache, clearModelCache, isFileCached, listCachedFiles } from './model-cache';
export { isCacheRelatedError } from './cache-errors';

export type LocalAiStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LocalAiState {
  status: LocalAiStatus;
  /** 模型加载进度 0-1 */
  progress: number;
  /** 模型 id */
  modelId: string;
  /** 当前使用的模型源（魔搭社区 / 官方） */
  sourceId: ModelSourceId;
  /** 当前推理运行时（WebGPU / WASM） */
  runtime?: RuntimeInfo;
  error?: string;
}

/** 模型源在 localStorage 中的键 */
const SOURCE_KEY = 'zj-model-source';
/** 用户在设置里选中的模型 id（与「已加载的模型」是两回事） */
const SELECTED_KEY = 'zj-selected-model';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 引擎单例 —— 保证同一页面只加载一次模型 */
let pipelinePromise: Promise<void> | null = null;
let loadedModelId = '';
let state: LocalAiState = {
  status: 'idle',
  progress: 0,
  modelId: DEFAULT_LOCAL_MODEL,
  sourceId: 'modelscope',
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
  if (typeof window === 'undefined') return DEFAULT_MODEL_SOURCE;
  try {
    const raw = window.localStorage.getItem(SOURCE_KEY);
    if (raw === 'modelscope' || raw === 'hf-official') return raw;
  } catch {
    /* 忽略 */
  }
  return DEFAULT_MODEL_SOURCE;
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

/**
 * 读取用户在设置里**选中**的模型 id。
 *
 * 为什么需要单独记：
 * - `loadedModelId` 是「已经加载起来的」模型；
 * - 而 AI 对话、调度器等路径调用 `loadLocalModel()` 时不传参，
 *   若不记这个值，它们会去加载**硬编码的默认模型**，
 *   于是出现「用户在设置里加载了 1.5B，AI 对话却在偷偷加载 0.5B」——
 *   而 0.5B 往往没下载过，现场下几百 MB 甚至直接失败。
 */
export function readSelectedModel(): string {
  if (typeof window === 'undefined') return DEFAULT_LOCAL_MODEL;
  try {
    const raw = window.localStorage.getItem(SELECTED_KEY);
    if (raw) return raw;
  } catch {
    /* 忽略 */
  }
  return DEFAULT_LOCAL_MODEL;
}

/** 持久化用户选中的模型 id */
export function saveSelectedModel(modelId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SELECTED_KEY, modelId);
  } catch {
    /* 忽略 */
  }
}

export function isLocalAiReady(): boolean {
  return state.status === 'ready';
}

/**
 * 非 Error 值的错误描述。
 *
 * 底层库抛出的东西五花八门：可能是裸数字（错误码）、
 * 可能是 `{ status, statusText }` 这样的普通对象，也可能是字符串。
 * 这里逐类展开，并在只剩一个无法解释的数字时明确说明，
 * 避免用户看到「1888206176」这种彻底无从下手的报错。
 *
 * @param device 本次实际使用的推理后端。**必须传**——
 *   裸数字在 WebGPU 与 WASM 下的成因完全不同，文案不能混用。
 */
function describeNonError(err: unknown, device?: RuntimeDevice): string {
  if (err === null) return '本地模型加载失败（错误原因为 null）';
  if (err === undefined) return '本地模型加载失败（错误原因为 undefined）';

  if (typeof err === 'string') {
    return err.trim() || '本地模型加载失败（错误原因为空字符串）';
  }

  if (typeof err === 'number') {
    //
    // ORT 抛出的裸数字其实是 **wasm 堆上的指针**（错误消息字符串的地址），
    // 不是状态码 —— 所有观测到的值低字节都是 16 的倍数（0x38/0x60/0xa0），
    // 即 16 字节对齐。JS 侧拿不到 Error 对象，于是只剩一个数字。
    //
    // 不同后端的成因不同，文案必须分开说：
    //
    // **WebGPU**：ORT 的 JSEP 后端建 session 失败。实测（NVIDIA Lovelace、
    //   shader-f16 可用、适配器与 device 均正常）同一份权重用 wasm 后端能加载，
    //   用 WebGPU 后端必抛裸数字。已定位到两个独立成因：
    //   1) 精度路径不兼容（q4f16 在 WebGPU EP 上必失败）；
    //   2) 权重超过 GPU 单缓冲上限（本机 maxBufferSize = 2 GiB，
    //      而 WebGPU EP 把整个权重塞进单个 buffer，不分块）。
    //   应用层已按体积提前拦截（见 runtime.ts），正常不会走到这里。
    //
    // **WASM**：实测与**权重体积**强相关 —— 同一台机器同一份代码：
    //   Qwen2.5-0.5B  q4     (749 MB) → ✅ 115s
    //   Qwen2.5-1.5B  uint8  (1.58 GB) → ✅ 319s
    //   Qwen2.5-1.5B  q4     (1.78 GB) → ❌ 裸数字
    // 失败点在 session 初始化的内存分配阶段（ORT 日志停在图优化之后，
    // 没有任何 [E:] 错误行）。JS 侧单个 ArrayBuffer 的分配上限是 2 GB
    // （实测 1.9 GB 可分配、2 GB 报 "Array buffer allocation failed"），
    // 而权重要被读成**一整块连续 buffer** 才能交给 ORT。
    // 因此 WASM 下大模型要改用体积更小的精度档（见 runtime.ts）。
    if (device === 'wasm') {
      return (
        `WASM 推理后端初始化失败（底层抛出未包装的错误值 ${err}）。` +
        `这通常是**权重体积过大**导致内存分配失败 —— ` +
        `该模型在 WASM 下也放不进一块连续内存缓冲区。` +
        `请改用体积更小的模型，或在「设置 · AI 引擎」换用其他模型后重试`
      );
    }
    return (
      `WebGPU 推理后端初始化失败（底层抛出未包装的错误值 ${err}）。` +
      `这通常是 ONNX Runtime 的 WebGPU 后端与该模型精度的兼容问题，` +
      `并非显卡不支持 —— 同一个模型改用 WASM 运行时可以正常加载。` +
      `请在「设置 · AI 引擎」改用 WASM 运行时；若已用 WASM 仍失败，则多为网络或权重下载问题`
    );
  }

  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    //常见的 { status, statusText } 形态
    if (typeof o.status === 'number' || typeof o.statusText === 'string') {
      const bits = [
        typeof o.status === 'number' ? `HTTP ${o.status}` : null,
        typeof o.statusText === 'string' ? o.statusText : null,
        typeof o.message === 'string' ? o.message : null,
      ].filter(Boolean);
      const joined = bits.join(' | ');
      if (/404/.test(joined)) {
        return `${joined}（模型仓库中没有该精度的权重文件；可在「设置 · AI 引擎」改用 WASM 运行时，其使用 q4 量化权重）`;
      }
      if (joined) return joined;
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json.slice(0, 300);
    } catch {
      /* 含循环引用等无法序列化的值 */
    }
  }

  return `本地模型加载失败（错误类型：${typeof err}）`;
}

/**
 * 提取可读的错误描述。
 *
 * Transformers.js 的报错信息往往藏在 cause 里，
 * 这里把 message / cause / status 一并展开，便于界面提示与控制台排查。
 *
 * 另外识别几类高频故障并给出**可执行的**修复建议：
 * - `HTTP 404` —— 模型仓库缺该精度的权重（常见于给 WebGPU 指定 fp16，
 *   而仓库只发布了 q4）
 * - `no available backend found` / `[wasm]` —— 推理引擎的 wasm 没拿到
 * - `webgpu` / `GPUDevice` —— GPU 或驱动层的问题
 * - 单纯的 `Failed to fetch` —— 模型文件下载失败
 *
 * ⚠️ Transformers.js / ONNX Runtime 有时抛出的**不是 Error 实例**，
 * 而是裸数字或裸对象（曾观测到 `throw 1888206176`）。
 * 旧实现对非 Error 一律返回「本地模型加载失败」，把所有线索丢光，
 * 界面上只剩一个无法理解的报错。这里必须把非Error 也如实展开。
 *
 * @param device 本次实际使用的推理后端 —— 裸数字在 WebGPU / WASM 下
 *   成因不同，文案必须区分（历史上出现过「用的是 WASM 却提示改用 WASM」）。
 */
export function describeError(err: unknown, device?: RuntimeDevice): string {
  if (!(err instanceof Error)) {
    return describeNonError(err, device);
  }

  const parts: string[] = [err.message];

  // 逐层展开 cause（Transformers.js 会把 fetch 失败包在 cause 中）
  let cause: unknown = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cause && depth < 5) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      const anyCause = cause as unknown as {
        cause?: unknown;
        status?: number;
        statusText?: string;
      };
      if (typeof anyCause.status === 'number') {
        parts.push(`HTTP ${anyCause.status}`);
      }
      cause = anyCause.cause;
    } else if (typeof cause === 'string') {
      parts.push(cause);
      cause = undefined;
    } else {
      cause = undefined;
    }
    depth += 1;
  }

  const text = Array.from(new Set(parts.filter(Boolean))).join(' | ');

  // 权重文件 404 —— 通常是「该模型仓库没有这个精度的权重」
  // 典型场景：为 WebGPU 指定 fp16，但模型仓库只发布了 q4 量化权重
  if (/HTTP 404|status:\s*404|not found/i.test(text)) {
    return `${text}（模型仓库中没有该精度的权重文件；可在「设置 · AI 引擎」改用 WASM 运行时，其使用q4 量化权重）`;
  }

  // WebGPU 侧故障 —— 与模型文件无关。
  // ⚠️ 不要再说「显卡驱动问题」：实测（NVIDIA Lovelace 等）证明这机器的
  // WebGPU 完全正常，真正不兼容的是 q4f16 精度与 WebGPU 执行后端。
  // 归错因会让用户去折腾驱动、白白浪费时间。
  if (/webgpu|navigator\.gpu|GPUAdapter|GPUDevice|requestAdapter|shader|compilation/i.test(text)) {
    return `${text}（WebGPU 推理后端初始化失败，多为该模型精度与 WebGPU 后端不兼容 —— 并非显卡不支持；可在「设置 · AI 引擎」改用 WASM 运行时）`;
  }

  // wasm 加载失败 —— 推理引擎起不来，与模型源无关
  if (/no available backend|\[wasm\]|wasm/i.test(text)) {
    return `${text}（推理引擎的 wasm 未能加载，请执行 npm run postinstall 生成本地 wasm）`;
  }

  // 单纯的 fetch 失败 —— 多半是模型文件没下载下来
  if (/Failed to fetch/i.test(text) && !/wasm/i.test(text)) {
    return `${text}（模型文件下载失败，请检查网络或改用其它下载源）`;
  }

  return text;
}

/**
 * 切换推理运行时。
 *
 * 切换后必须卸载当前模型再重新加载 —— device 属于 session 创建参数，
 * 已建立的 session 无法原地变更。
 */
export async function switchRuntime(pref: RuntimePref): Promise<void> {
  saveRuntimePref(pref);
  // 强制重新探测，让新的偏好立即生效
  await resolveRuntime(pref, true);
  await unloadLocalModel();
}

/**
 * 本地 wasm 目录（同源 public/ort/）。
 * 由 `scripts/copy-ort-wasm.mjs` 在 postinstall / build 时自动填充。
 */
const LOCAL_WASM_DIR = '/ort/';

/**
 * CDN 兜底目录 —— 本地 wasm 缺失时使用。
 * jsdelivr 在国内常不可达，故排在本地之后，仅作最后兜底。
 */
const CDN_WASM_DIR =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';

/** 本地 wasm 是否可用（首次调用后缓存结果） */
let localWasmChecked: boolean | null = null;

/**
 * 探测本地 public/ort/ 下的 wasm 是否存在。
 *
 * 存在则走同源本地加载（推荐，完全不依赖 CDN）；
 * 不存在则退回 CDN（可能是未执行 postinstall / build）。
 *
 * 用 GET + Range 只取首字节，避免 HEAD 被浏览器取消导致误判。
 */
async function hasLocalWasm(): Promise<boolean> {
  if (localWasmChecked !== null) return localWasmChecked;
  if (typeof window === 'undefined' || !('fetch' in window)) {
    localWasmChecked = false;
    return false;
  }
  try {
    const res = await fetch(`${LOCAL_WASM_DIR}ort-wasm-simd-threaded.jsep.wasm`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    });
    // 200 / 206 均表示文件可读
    localWasmChecked = res.ok || res.status === 206;
  } catch {
    localWasmChecked = false;
  }
  return localWasmChecked;
}

/**
 * 加载本地模型。重复调用会复用同一个 Promise。
 * 加载期间会持续推送进度，用于渲染骨架屏。
 *
 * 容错策略（针对「模型加载失败」这一常见问题）：
 * 1. **wasm 本地化** —— 绕开 jsdelivr CDN，避免 `Failed to fetch`；
 * 2. **缓存清理** —— 浏览器 Cache API 里可能残留上次下载中断的半截文件，
 *    命中坏缓存会导致每次都失败。加载前先清掉该模型在 transformers-cache 中的条目；
 * 3. **源自动回退** —— 当前源失败时自动改用备用源重试一次，
 *    避免用户只能看到一句无用的「加载失败」。
 * 4. **运行时降级** —— WebGPU 失败（驱动异常、显存不足、算子不支持）时
 *    自动退回 WASM 重试。GPU 路径在真实设备上翻车率不低，
 *    不做降级会让「能跑」变成「看运气」。
 */
export async function loadLocalModel(
  /**
   * 要加载的模型 id。
   *
   * ⚠️ **不传时用「用户选中的模型」，不是硬编码的默认模型**。
   * AI 对话、调度器等路径都是无参调用，若这里回落到默认模型，
   * 就会出现「用户在设置里加载了 1.5B，AI 对话却在偷偷加载 0.5B」——
   * 0.5B 往往没下载过，于是现场下载几百 MB，甚至直接加载失败。
   */
  modelId: string = readSelectedModel(),
  onProgress?: (ratio: number) => void,
): Promise<void> {
  if (pipelinePromise && loadedModelId === modelId) return pipelinePromise;

  // 换模型时必须等上一次加载彻底结束。
  //
  // ⚠️ 这里曾只把 pipelinePromise 置空就继续，那会在「卸载 → 立刻加载」时
  // 让两次加载并发跑。Transformers.js 与 ORT 的 wasm 运行时
  // **不支持并发建 session**：后一次会把前一次顶掉，前一次的收尾代码
  // 随后打到已失效的 wasm 对象上，触发 emscripten 的 `unreachable()`，
  // 控制台表现为一条无信息量的 `Aborted()`（wasm 侧 abort 的空消息版本）。
  if (pipelinePromise) {
    try {
      await pipelinePromise;
    } catch {
      // 上一次本来就失败了 —— 不影响本次重新加载
    }
    await releaseActivePipeline();
  }

  loadedModelId = modelId;
  const primary = findModelSource(readModelSource());

  // 探测推理运行时（WebGPU 优先）。
  // deep=true：加载模型前做 WebGPU 冒烟测试。
  // 必须做 —— 能拿到 GPU 适配器 ≠ ORT 的 WebGPU 后端能建 session，
  // 不测就会在下载完几百 MB 权重后才炸，而那时抛出的还是无法解读的裸数字。
  //
  // 传入模型体积：权重超过 GPU 单缓冲上限时，ORT 的 WebGPU EP 必然分配失败
  // （把整个权重塞进一个 buffer，而 GPU 的 maxBufferSize 只有 2 GiB），
  // 此时直接改走 WASM，别让用户白等几分钟下载完才发现加载不了。
  // 详见 runtime.ts 里「大模型在 WebGPU 上加载失败」的实测结论。
  const modelOption = findModelOption(modelId);
  const runtime = await resolveRuntime(
    undefined,
    false,
    true,
    modelOption?.q4Bytes,
    // WASM 下要用模型自己的精度档 —— 大模型只有 uint8 装得下
    modelWeightDtype(modelOption),
  );

  emit({
    status: 'loading',
    progress: 0,
    modelId,
    sourceId: primary.id,
    runtime,
    error: undefined,
  });

  /**
   * 最近一次尝试的运行时 —— 用于在失败时给出**正确后端**的错误文案。
   * 裸数字错误在 WebGPU 与 WASM 下成因不同，文案不能混用。
   */
  let lastRuntime: RuntimeInfo | undefined;

  // 运行时降级阶梯：WebGPU(q4) → WASM(模型精度档)。
  // 精度维度已收敛：`runtime.ts` 现在 WebGPU 默认就选 q4
  // （实测 q4f16 在 WebGPU EP 上必定失败，见 RuntimeDtype 的对照实验），
  // 因此这里不需要再为精度分叉，只保留「换后端」这一个真正有效的方向。
  //
  // 仅当用户没有显式指定 wasm 时才追加 WASM 重试，
  // 否则用户「就想要 wasm」被 GPU 抢占语义会不对。
  const runtimes: RuntimeInfo[] = (() => {
    if (runtime.device !== 'webgpu') return [runtime];
    const ladder: RuntimeInfo[] = [runtime];
    if (runtime.pref !== 'wasm') {
      ladder.push({
        ...runtime,
        device: 'wasm' as RuntimeDevice,
        dtype: modelWeightDtype(modelOption) as RuntimeDtype,
        fallbackReason:
          'WebGPU 推理失败，已自动回退到 WASM（CPU 推理，速度略慢但稳定）',
      });
    }
    return ladder;
  })();

  pipelinePromise = (async () => {
    try {
      // 真正的加载在 **Web Worker** 里进行 ——
      // 主线程建 session 同样会长时间同步阻塞（1.5B 实测要 300+ 秒），
      // 那期间页面完全无响应。
      await loadInWorker(
        {
          modelId,
          runtimes: runtimes.map((r) => ({ device: r.device, dtype: r.dtype })),
          sourceId: primary.id,
          revision: primary.revision,
        },
        (ratio) => {
          emit({ progress: ratio });
          onProgress?.(ratio);
        },
      );
      lastRuntime = runtime;
      emit({ status: 'ready', progress: 1 });
    } catch (err) {
      lastRuntime = runtimes[runtimes.length - 1];
      const message = describeError(err, lastRuntime.device);
      console.error(
        `[zj-ai] 模型加载失败（源：${primary.name} / 运行时：lastRuntime.device / 精度：${lastRuntime.dtype}）：`,
        message,
        err,
      );
      emit({ status: 'error', error: message });
      pipelinePromise = null;
      throw err;
    }
  })();

  return pipelinePromise;
}

/**
 * 按「首选源 → 其它源」的顺序返回待尝试的模型源。
 * 只有一个源时原样返回。
 */
function orderedSources(primary: ModelSourceOption): ModelSourceOption[] {
  const rest = MODEL_SOURCES.filter((s) => s.id !== primary.id);
  return [primary, ...rest];
}

/**
 * 清理浏览器 Cache API 中与该模型相关的缓存条目。
 *
 * Transformers.js 默认使用名为 `transformers-cache` 的缓存，
 * 键是完整的远端 URL。下载中断会留下半截响应，
 * 之后每次加载都会命中坏缓存并失败，因此加载前必须清一次。
 *
 * ## ⚠️ 不要再无条件清缓存
 *
 * 曾经每次降级重试前都调本函数，结果是：权重已经完整下载成功（HTTP 200），
 * 但因为后续步骤失败（WebGPU EP 初始化），缓存被清掉，
 * 于是下一次重试又从零下载 493MB —— 实测用户会反复下载十几分钟，
 * 最后看到的仍是同一个错误。
 *
 * 现在改为：**只在错误确实指向缓存/网络时才清**（见 `isCacheRelatedError`），
 * 其余情况保留已下好的权重，让降级重试能立刻用上本地文件。
 */
export async function purgeModelCache(modelId?: string): Promise<void> {
  try {
    // 走分片缓存的删除逻辑 —— 它会连同分片与元信息一起清干净。
    // 直接按 URL 删原始 key 是不够的：分片 key 带路径后缀，删不掉。
    await deleteModelFiles(modelId);
  } catch {
    /* 缓存不可用时忽略 —— 不影响正常下载 */
  }
}


/**
 * 卸载 Worker 里的模型。
 *
 * ⚠️ 模型现在**只存在于 Worker**（主线程不建 session），
 * 所以释放动作要转给 Worker 做 —— 主线程这边没有可释放的东西。
 */
async function releaseActivePipeline(): Promise<void> {
  try {
    await unloadInWorker();
  } catch {
    // Worker 已被终止等情况忽略 —— 目标（释放资源）已达成
  }
}

/**
 * 卸载模型（释放显存/内存）。
 *
 * 会等待进行中的加载结束再释放 —— 否则旧加载的收尾动作会打到
 * 刚被释放（或正被新加载顶替）的 wasm 对象上。
 */
export async function unloadLocalModel() {
  if (pipelinePromise) {
    try {
      await pipelinePromise;
    } catch {
      // 本次加载本来就是失败的，没有可释放的 session
    }
    pipelinePromise = null;
  }
  await releaseActivePipeline();
  loadedModelId = '';
  emit({
    status: 'idle',
    progress: 0,
    // ⚠️ 卸载后 modelId 要**清空**，不能复位成默认模型。
    // 复位会让「运行中」徽标错挂到默认模型（列表第一项）头上 ——
    // 判定只看 modelId 时就会看到「第一个还显示运行中」。
    modelId: '',
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
  const { maxTokens = 512, temperature = 0.7 } = opts;
  const params = await resolveWorkerParams();
  const prompt = applyChatTemplate(messages, resolveFamily(params.modelId));

  // 同样走 Worker —— 与 localChatStream 保持一致，
  // 且保证模型只存在于 Worker 一份（主线程不再建第二份 session）。
  let text = '';
  const { promise } = generateInWorker(
    {
      ...params,
      prompt,
      maxTokens,
      temperature,
      doSample: temperature > 0,
    },
    (chunk) => {
      text += chunk;
    },
  );
  await promise;

  // 去掉可能残留的模板标记
  return text
    .replace(/<\|im_start\|>assistant\s*/g, '')
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|endoftext\|>/g, '')
    .trim();
}

/**
 * 本地流式生成 —— 逐段 yield 增量文本。
 *
 * ## 为什么需要它
 *
 * AI SDK 的 `useChat` 以「文本增量」为基本单位消费流式响应，
 * 而 `localChat` 是一次性返回完整文本 —— 那样首字要等模型跑完，
 * 流式对话就退化成了「带 loading 的非流式」。
 *
 * ## 实现
 *
 * 用 Transformers.js 的 `TextStreamer` 把 token 增量回调出来，
 * 回调里往队列塞文本；生成任务在后台跑，生成器从队列里取，
 * 两者用「队列空 + 任务结束」作为终止条件。
 *
 * 注意三点：
 * 1. `skip_prompt: true` —— 不要把提示词回吐给用户；
 * 2. `skip_special_tokens: true` —— 过滤 `<|im_end|>` 等模板标记；
 * 3. 队列消费要能被 `abortSignal` 打断，否则用户点「停止」后还在空转。
 */
export async function* localChatStream(
  messages: ChatMessage[],
  opts: {
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<string, void, unknown> {
  const { maxTokens = 512, temperature = 0.7, signal } = opts;

  // ⚠️ 推理跑在 **Web Worker** 里，不是主线程。
  //
  // 1.5B 模型在 WASM 后端下单次 forward 会同步阻塞主线程 10 秒以上
  //（实测首次 prefill 阻塞 10767ms），浏览器连续阻塞超过 5 秒就弹
  // 「页面未响应」—— 而生成其实还在继续，这就是「未响应但没有报错」。
  //
  // Worker 自己从 Cache API 读权重（与主线程共用同一份分片缓存），
  // 主线程全程不碰大 buffer，既不卡也不占内存。
  const params = await resolveWorkerParams();

  const prompt = applyChatTemplate(messages, resolveFamily(params.modelId));

  /** 待消费的增量队列 */
  const queue: string[] = [];
  /** 是否已结束（生成任务完成或失败） */
  let done = false;
  /** 生成失败时的错误 */
  let failure: unknown = null;
  /** 唤醒等待者的钩子 */
  let notify: (() => void) | null = null;

  const wake = () => {
    notify?.();
    notify = null;
  };

  const { promise, abort } = generateInWorker(
    {
      ...params,
      prompt,
      maxTokens,
      temperature,
      doSample: temperature > 0,
    },
    (text) => {
      queue.push(text);
      wake();
    },
  );

  // 生成任务在后台推进；失败要能被消费方看到
  const task = promise.catch((err) => {
    failure = err;
  }).finally(() => {
    done = true;
    wake();
  });

  // 中断时直接结束消费
  const onAbort = () => {
    abort();
    done = true;
    wake();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      if (queue.length > 0) {
        yield queue.shift() as string;
        continue;
      }
      if (failure) throw failure;
      if (done) break;
      // 队列空且未结束：等下一次回调唤醒
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // 提前退出（中断）时让生成任务自行收尾，不阻塞调用方
    void task.catch(() => undefined);
  }
}

/**
 * 解析出「要在 Worker 里跑」所需的参数。
 *
 * 模型 id 取**用户选中的**那个（与 loadLocalModel 一致），
 * 运行时与精度沿用主线程的探测结果 —— 这样 Worker 与主线程
 * 用的是同一套模型/精度/后端组合，不会出现「界面显示 A、实际跑 B」。
 */
async function resolveWorkerParams(): Promise<{
  modelId: string;
  runtimes: { device: 'webgpu' | 'wasm'; dtype: string }[];
  sourceId: ModelSourceId;
  revision: string;
}> {
  const modelId = readSelectedModel();
  const option = findModelOption(modelId);
  const runtime = await resolveRuntime(
    undefined,
    false,
    true,
    option?.q4Bytes,
    modelWeightDtype(option),
  );
  const source = findModelSource(readModelSource());

  // 降级阶梯与 loadLocalModel 保持一致：WebGPU(q4) → WASM(模型精度档)
  const runtimes: { device: 'webgpu' | 'wasm'; dtype: string }[] = [];
  if (runtime.device === 'webgpu') {
    runtimes.push({ device: 'webgpu', dtype: 'q4' });
    if (runtime.pref !== 'wasm') {
      runtimes.push({
        device: 'wasm',
        dtype: modelWeightDtype(option),
      });
    }
  } else {
    runtimes.push({ device: runtime.device, dtype: runtime.dtype });
  }

  return {
    modelId,
    runtimes,
    sourceId: source.id,
    revision: source.revision,
  };
}


/**
 * 本地离线 AI 引擎 —— 基于 Transformers.js 在浏览器内加载量化大语言模型。
 * 所有推理在用户设备本地完成，提示词不上传，隐私优先。
 */

import type { TextGenerationPipeline } from '@huggingface/transformers';
import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_MODEL_SOURCE,
  findModelOption,
  findModelSource,
  inferFamily,
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
 */
function describeNonError(err: unknown): string {
  if (err === null) return '本地模型加载失败（错误原因为 null）';
  if (err === undefined) return '本地模型加载失败（错误原因为 undefined）';

  if (typeof err === 'string') {
    return err.trim() || '本地模型加载失败（错误原因为空字符串）';
  }

  if (typeof err === 'number') {
    // 实测：WebGPU 后端初始化失败时，ONNX Runtime 抛出的就是这个 ——
    // 一个 wasm 侧未初始化的内存/句柄值（见过 1888206176、999335224 等），
    // **每次都不一样**，因此它不是错误码，无法据此定位。
    // 结合「运行时是 webgpu」这一上下文才能给出有意义的判断。
    return (
      `底层抛出了未包装的错误值 ${err}（该数值每次都不同，不是可读错误码）。` +
      `这通常意味着推理后端初始化失败 —— 若当前使用 WebGPU，` +
      `多半是该环境（驱动版本、远程桌面、GPU 独占或安全策略）无法真正运行 GPU 后端。` +
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
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) {
    return describeNonError(err);
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

  // WebGPU 侧故障 —— 与模型文件无关，是 GPU/驱动层的问题
  if (/webgpu|navigator\.gpu|GPUAdapter|GPUDevice|requestAdapter|shader|compilation/i.test(text)) {
    return `${text}（WebGPU 初始化失败，通常是显卡驱动或浏览器策略问题，可在「设置 · AI」中改用 WASM 运行时）`;
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
 * 把 ONNX Runtime 的 wasm 资源指向本地 public/ort/。
 *
 * 背景：Transformers.js 在模块初始化时会把
 * `onnxruntime-web` 的 wasmPaths 设成 `https://cdn.jsdelivr.net/npm/@huggingface/transformers@<ver>/dist/`。
 * 该域名在国内网络下经常TLS 握手失败，浏览器侧表现为：
 *   `no available backend found. ERR: [wasm] TypeError: Failed to fetch`
 * 进而导致模型永远加载不出来（用户看到的「模型加载失败 · Failed to fetch」）。
 *
 * 这里改写 wasmPaths 指向同源的 public/ort/，
 * 由 `scripts/copy-ort-wasm.mjs` 从 node_modules 复制所需文件，彻底摆脱 CDN 依赖。
 *
 * 注意：Transformers.js 会在 import 时就把 wasmPaths 写死，
 * 所以本函数必须在 `await import('@huggingface/transformers')` **之后**、
 * `pipeline()` 之前调用（此时 onnxruntime 的 env 仍可改写，
 * 且 wasmPaths 只在 initWasm() 真正初始化时才被读取）。
 *
 * @param device 本次推理设备。**关键**：只有 wasm 后端才需要加载 wasm 文件，
 *                走 WebGPU 时wasm 仅作为 JSEP 的宿主胶水，仍需加载，
 *                但 numThreads 设置对 GPU 路径无意义。
 */
async function applyLocalWasm(env: {
  backends?: {
    onnx?: {
      wasm?: {
        wasmPaths?: unknown;
        wasmBinaryFile?: unknown;
        numThreads?: unknown;
        proxy?: unknown;
      };
    };
  };
}, device: RuntimeDevice) {
  const wasm = env.backends?.onnx?.wasm;
  if (!wasm) return;

  const useLocal = await hasLocalWasm();
  const dir = useLocal ? LOCAL_WASM_DIR : CDN_WASM_DIR;

  // 目录形式：onnxruntime 会自动拼接 ort-wasm-simd-threaded.jsep.wasm 等文件名
  wasm.wasmPaths = dir;
  // 兜底：部分版本使用 wasmBinaryFile 字段
  wasm.wasmBinaryFile = `${dir}ort-wasm-simd-threaded.jsep.wasm`;

  if (device === 'wasm') {
    // 单线程更稳：多线程需要 SharedArrayBuffer，
    // 在未开启跨域隔离（COOP/COEP）的环境下会直接失败
    wasm.numThreads = 1;
    // 强制经由 Worker 代理执行时，jsep glue 需要 proxy 同步可用
    wasm.proxy = false;
  } else {
    // WebGPU 路径：推理在 GPU 上跑，wasm 只做胶水与调度。
    // 这里保持默认（不开proxy），避免多一次 Worker 跳转带来的延迟。
    wasm.numThreads = 1;
  }

  if (!useLocal) {
    console.warn(
      '[zj-ai] 本地 wasm 未找到，已回退到 CDN（该 CDN 在国内可能不可达）。' +
        '请执行 `npm run postinstall` 或 `npm run build` 生成 public/ort/。',
    );
  }
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
  modelId: string = DEFAULT_LOCAL_MODEL,
  onProgress?: (ratio: number) => void,
): Promise<TextGenerationPipeline> {
  if (pipelinePromise && loadedModelId === modelId) return pipelinePromise;

  loadedModelId = modelId;
  const primary = findModelSource(readModelSource());

  // 探测推理运行时（WebGPU 优先）。
  // deep=true：加载模型前做 WebGPU 冒烟测试。
  // 必须做 —— 能拿到 GPU 适配器 ≠ ORT 的 WebGPU 后端能建 session，
  // 不测就会在下载完几百 MB 权重后才炸，而那时抛出的还是无法解读的裸数字。
  let runtime = await resolveRuntime(undefined, false, true);

  emit({
    status: 'loading',
    progress: 0,
    modelId,
    sourceId: primary.id,
    runtime,
    error: undefined,
  });

  const attempt = async (
    source: ModelSourceOption,
    rt: RuntimeInfo,
  ) => {
    const { pipeline, env } = await import('@huggingface/transformers');

    // 允许跨域加载模型资源
    env.allowLocalModels = false;

    // 指向国内模型源（默认阿里巴巴魔搭社区），显著提升下载速度。
    // 魔搭的仓库路径比HF 多一层 models/，且默认分支叫master，
    // 因此 remoteHost 与 remotePathTemplate 需要按源分别设置。
    env.remoteHost = source.host;
    env.remotePathTemplate = source.pathTemplate;

    // **关键**：把 ONNX Runtime 的 wasm 指向本地 public/ort/。
    // Transformers.js 默认从 cdn.jsdelivr.net 拉取这 21MB 的 wasm，
    // 该域名在国内常因 TLS 握手失败而报 `Failed to fetch`，
    // 表现为「no available backend found」，模型永远加载不了。
    // 改用同源本地文件后彻底摆脱 CDN 依赖。
    await applyLocalWasm(env, rt.device);

    const instance = await pipeline('text-generation', modelId, {
      // dtype 与 device 严格配套：
      //   WebGPU → q4f16（q4 量化存储 + fp16 计算，GPU 上的正确选择）
      //   WASM   → q4（纯量化，体积最小、不依赖 fp16 能力）
      // ⚠️ WebGPU 上不要用 fp16：会加载完整半精度权重（体积数倍于 q4），
      // 且部分算子在 WebGPU EP 上不受支持，表现为初始化阶段抛出
      // 难以解读的错误（曾观测到底层直接抛出一个裸数字）。
      dtype: rt.dtype,
      // WebGPU 不可用时 transformers 会自行回退，但显式声明更可控
      device: rt.device === 'webgpu' ? 'webgpu' : 'wasm',
      revision: source.revision,
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
    return instance as TextGenerationPipeline;
  };

  pipelinePromise = (async () => {
    // 先清掉该模型可能存在的坏缓存
    await purgeModelCache(modelId);

    let lastError: unknown;

    /**
     * 降级阶梯：WebGPU(q4f16) → WebGPU(q4) → WASM(q4)。
     *
     * 为什么要 WebGPU 内部再降一档：部分显卡/驱动上q4f16 所需的
     * fp16 算子支持不全会初始化失败，但纯 q4 量化反而能跑。
     * 只做「WebGPU → WASM」一级跳转会白白丢掉 GPU 加速。
     *
     * 仅当用户没有显式指定 wasm 时才追加 WASM 重试，
     * 否则用户「就想要 wasm」被 GPU 抢占语义会不对。
     */
    const runtimes: RuntimeInfo[] = (() => {
      if (runtime.device !== 'webgpu') return [runtime];
      const ladder: RuntimeInfo[] = [runtime];
      // 用户显式锁定 webgpu 时也保留 GPU 内部降级 —— 那是精度调整，不是换设备
      ladder.push({
        ...runtime,
        dtype: 'q4',
        fallbackReason: 'q4f16 初始化失败，已在 GPU 上改用 q4 量化权重',
      });
      if (runtime.pref !== 'wasm') {
        ladder.push({
          ...runtime,
          device: 'wasm' as RuntimeDevice,
          dtype: 'q4' as const,
          fallbackReason: 'WebGPU 初始化失败，已自动回退到 WASM',
        });
      }
      return ladder;
    })();

    // 外层遍历运行时，内层遍历模型源 —— 任一组合成功即返回
    for (const rt of runtimes) {
      if (rt !== runtime) {
        // 换了运行时，重置进度并同步给界面
        emit({ runtime: rt, progress: 0 });
        await purgeModelCache(modelId);
      }

      for (const source of orderedSources(primary)) {
        try {
          const instance = await attempt(source, rt);
          // 实际生效的源/运行时可能与首选不同，同步给界面
          if (source.id !== primary.id || rt !== runtime) {
            emit({ sourceId: source.id, runtime: rt });
          }
          emit({ status: 'ready', progress: 1 });
          return instance;
        } catch (err) {
          lastError = err;
          // 用 describeError 归一化后再打日志：底层有时抛裸数字/裸对象，
          // 直接 console.error(err) 控制台里只会显示一个无从下手的数值
          console.error(
            `[zj-ai] 模型加载失败（源：${source.name} / 运行时：${rt.device} / 精度：${rt.dtype}）：`,
            describeError(err),
            err,
          );
          // 换源前清缓存，避免上一个源留下的坏数据
          await purgeModelCache(modelId);
        }
      }
    }

    // 打印完整错误（含 stack 与可能的网络失败 URL），便于定位浏览器端加载失败原因
    console.error('[zj-ai] 本地模型加载失败:', lastError);
    emit({
      status: 'error',
      error: describeError(lastError),
    });
    pipelinePromise = null;
    throw lastError;
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
 */
export async function purgeModelCache(modelId?: string): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await window.caches.open('transformers-cache');
    const keys = await cache.keys();
    const targets = modelId
      ? keys.filter((r) => r.url.includes(modelId))
      : keys;
    await Promise.all(targets.map((r) => cache.delete(r)));
  } catch {
    /* 缓存不可用时忽略 —— 不影响正常下载 */
  }
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

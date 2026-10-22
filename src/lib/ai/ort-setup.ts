/**
 * ONNX Runtime 的环境配置 —— 主线程与 Web Worker 共用。
 *
 * 抽出来的原因：推理要搬到 Worker（否则 1.5B 模型单次 forward 会阻塞主线程
 * 十几秒，浏览器直接弹「页面未响应」），而 Worker 里**没有 window**，
 * 不能依赖任何 DOM API —— 这段逻辑必须与运行环境无关。
 */

import { modelCache } from './model-cache';

/** 本地 wasm 目录（同源 public/ort/） */
export const LOCAL_WASM_DIR = '/ort/';

/**
 * CDN 兜底目录 —— 本地 wasm 缺失时使用。
 * jsdelivr 在国内常不可达，故排在本地之后，仅作最后兜底。
 */
export const CDN_WASM_DIR =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';

/**
 * 计算可用的 wasm 线程数。
 *
 * 多线程 wasm 依赖 SharedArrayBuffer，而 SharedArrayBuffer 只有在
 * **跨域隔离**（COOP: same-origin + COEP: require-corp）下才可用 ——
 * 本应用在 next.config.ts 的 headers 里配了这两条，因此正常都是 true。
 *
 * 但不能假设：某些浏览器扩展、iframe、隐私模式会破坏隔离状态，
 * 那种情况下多线程会直接抛错。检测一下再用。
 */
export function resolveWasmThreads(): number {
  if (typeof self === 'undefined' || typeof navigator === 'undefined') return 1;
  // 跨域隔离 + SharedArrayBuffer 可分配，两个条件缺一不可
  const isolated = (self as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  if (!isolated || typeof SharedArrayBuffer === 'undefined') return 1;
  try {
    // 真正分配一次，确认可用（某些环境声明了但分配会失败）
    new SharedArrayBuffer(8);
  } catch {
    return 1;
  }
  const cores = navigator.hardwareConcurrency || 2;
  // 留 2 核给主线程/UI：推理线程越多，UI 越容易卡
  return Math.max(2, Math.min(4, cores - 2));
}

/** 探测本地 wasm 是否存在（用 Range 只取首字节，避免 HEAD 被取消导致误判） */
export async function hasLocalWasm(): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const res = await fetch(`${LOCAL_WASM_DIR}ort-wasm-simd-threaded.jsep.wasm`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * ORT 在建 session 时会固定抛出两条 C++ 侧日志：
 *   `... [W:onnxruntime:, session_state.cc:1280 VerifyEachNodeIsAssignedToAnEp]
 *    Some nodes were not assigned to the preferred execution providers...`
 *   `... [W:onnxruntime:, session_state.cc:1282 VerifyEachNodeIsAssignedToAnEp] Rerun...`
 *
 * 这是**正常行为** —— ORT 有意把 shape 类算子留在 CPU 以优化性能。
 *
 * ⚠️ 为什么不能用 `env.backends.onnx.logLevel = 'error'` 消掉：
 * ORT 有两套日志通道：
 *   1. JS 侧 logger（`[W,<ISO 时间>]` 格式）—— 受 `logLevel` 控制；
 *   2. C++/wasm 侧原生 logger（`<时间戳> [W:onnxruntime:, file:line函数]` 格式）
 *      —— 经 emscripten 的 `console.error` 直出，**完全绕过 `logLevel`**。
 * 上面这条属于第 2 类，所以调 logLevel 无效（已实测确认）。
 *
 * 因此只能在 console 出口做过滤。过滤条件写得极窄：
 * 只认 `VerifyEachNodeIsAssignedToAnEp` 这一个 ORT 内部函数名，
 * 且必须是 console.error —— 真正的失败（含同为 error 级的其它 ORT 报错）
 * 都不含这个标识，不会被吞掉。
 */
const ORT_BENIGN_LOG = /VerifyEachNodeIsAssignedToAnEp/;

let ortLogFilterInstalled = false;

/**
 * 过滤 ORT 的良性警告。
 *
 * ⚠️ **主线程与 Worker 都要各装一次** —— 推理跑在 Worker 里，
 * Worker 的 console.error 不会经过主线程的包装。
 */
export function installOrtLogFilter(): void {
  if (ortLogFilterInstalled) return;
  const scope = globalThis as unknown as { console?: Console };
  if (!scope.console) return;
  const original = scope.console.error.bind(scope.console);
  scope.console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && ORT_BENIGN_LOG.test(first)) return;
    original(...args);
  };
  ortLogFilterInstalled = true;
}

/** ORT env 的最小结构（只需用到的字段） */
export interface OrtEnvLike {
  backends?: { onnx?: Record<string, unknown> };
  logLevel?: unknown;
}

/**
 * 把 ONNX Runtime 的 wasm 指向本地 public/ort/，并配好线程模型。
 *
 * 背景：Transformers.js 在模块初始化时会把 wasmPaths 设成
 * `https://cdn.jsdelivr.net/npm/@huggingface/transformers@<ver>/dist/`。
 * 该域名在国内网络下经常 TLS 握手失败，浏览器侧表现为：
 *   `no available backend found. ERR: [wasm] TypeError: Failed to fetch`
 * 进而导致模型永远加载不出来。改用同源本地文件后彻底摆脱 CDN 依赖。
 *
 * 注意：Transformers.js 会在 import 时就把 wasmPaths 写死，
 * 所以本函数必须在 `await import('@huggingface/transformers')` **之后**调用。
 *
 * @param env transformers 的 env
 * @param device 本次推理设备（WebGPU 时 wasm 只作 JSEP 胶水）
 * @returns 是否成功用上了本地 wasm（false 表示已回退 CDN）
 */
export async function applyOrtEnv(
  env: OrtEnvLike,
  device: 'webgpu' | 'wasm',
): Promise<boolean> {
  const ortEnv = env.backends?.onnx;
  if (!ortEnv) {
    console.warn('[zj-ai] 未取到 ONNX Runtime 的 env（env.backends.onnx 为空），wasm 本地化未生效');
    return false;
  }
  const wasm = ortEnv.wasm as
    | { wasmPaths?: unknown; numThreads?: unknown; proxy?: unknown }
    | undefined;
  if (!wasm) {
    console.warn('[zj-ai] 未取到 ORT 的 wasm 配置对象（env.backends.onnx.wasm 为空），wasm 本地化未生效');
    return false;
  }

  // 压低 JS 侧日志级别（ORT 自有 logger 的格式是 `[W,<ISO时间>]`）。
  // 注意：这**管不到** C++ 侧的 VerifyEachNodeIsAssignedToAnEp 警告，
  // 那一类要靠 installOrtLogFilter。
  ortEnv.logLevel = 'error';
  installOrtLogFilter();

  const useLocal = await hasLocalWasm();
  const dir = useLocal ? LOCAL_WASM_DIR : CDN_WASM_DIR;

  // 用官方支持的对象形式分别指定 .wasm 与 .mjs。
  // 只给字符串前缀也能工作，但对象形式不依赖「文件名拼接规则」，
  // 在 ORT 升级改名时更稳（实测默认会走 CDN，必须显式覆盖两个文件）。
  wasm.wasmPaths = {
    wasm: `${dir}ort-wasm-simd-threaded.jsep.wasm`,
    mjs: `${dir}ort-wasm-simd-threaded.jsep.mjs`,
  };

  // ---------------------------------------------------------------------
  // 线程模型
  // ---------------------------------------------------------------------
  //
  // ⚠️ 之前这里写死 `numThreads = 1; proxy = false`，理由是「多线程需要
  // SharedArrayBuffer，未开启跨域隔离会直接失败」—— 那时确实没验证过。
  // 实测本机 `crossOriginIsolated === true`，SharedArrayBuffer 可分配，
  // **多线程完全可用**。
  //
  // 单线程的代价：1.5B 模型在 WASM 下每个 token 都要阻塞数百毫秒到数秒，
  // 连续阻塞超过 5 秒浏览器就会弹「页面未响应」，而生成过程本身还在继续
  // （所以用户看到的是「未响应但没有报错」）。
  wasm.numThreads = resolveWasmThreads();

  // proxy（ORT 自带的 Worker 代理）能彻底不阻塞主线程，但代价是
  // **模型 buffer 要 postMessage 拷贝一份**到 worker，worker 里还要再
  // malloc 一份 —— 对 1.5B（1.58 GB）意味着峰值 4.7 GB，风险太高。
  // 因此这里保持 false，改由我们自己的 Worker 承担推理（见 ai-worker.ts），
  // 那条路径不经过 postMessage，模型 buffer 从头到尾只存在于 Worker 里。
  wasm.proxy = false;

  if (!useLocal) {
    console.warn(
      '[zj-ai] 本地 wasm 未找到，已回退到 CDN（该 CDN 在国内可能不可达）。' +
        '请执行 `npm run postinstall` 或 `npm run build` 生成 public/ort/。',
    );
  }
  return useLocal;
}

/**
 * 推理运行时探测 —— 决定本次用 WebGPU 还是 WASM 跑模型。
 *
 * 背景：ONNX Runtime Web 的 wasm 产物有两类文件名：
 *   - `ort-wasm-simd-threaded.wasm`          纯 CPU/WASM
 *   - `ort-wasm-simd-threaded.jsep.wasm`    JSEP = JavaScript Execution Provider，
 *                                            **内含 WebGPU / WebNN 执行后端**
 * `@huggingface/transformers` 默认引用的正是 .jsep 这份，也就是说
 * WebGPU 能力其实已经躺在我们的本地 wasm 里了，缺的只是「告诉它用 webgpu」。
 *
 * 因此本模块负责三件事：
 * 1. 探测浏览器是否具备 WebGPU（navigator.gpu + requestAdapter 成功）
 * 2. 按用户偏好与实际能力，选出 device / dtype
 * 3. 把结果回传给界面，让「当前用什么跑」可见
 *
 * 注意：WebGPU 与 WASM 的 dtype 约束不同。
 * WebGPU 对 fp16 支持良好，q4 量化在部分实现上会退化，
 * 故 WebGPU 走 fp16，WASM 走 q4（体积小、无精度依赖）。
 */

/** 用户可选择的运行时偏好 */
export type RuntimePref = 'auto' | 'webgpu' | 'wasm';

/** 实际生效的推理设备 */
export type RuntimeDevice = 'webgpu' | 'wasm';

/** 运行时探测结果 */
export interface RuntimeInfo {
  /** 浏览器是否暴露了 WebGPU 接口 */
  hasWebGpuApi: boolean;
  /** 是否成功拿到 GPU 适配器（真正能用） */
  hasWebGpuAdapter: boolean;
  /** 适配器信息摘要 */
  adapterInfo?: string;
  /** 本次实际选中的设备 */
  device: RuntimeDevice;
  /** 本次实际选中的权重精度 */
  dtype: 'fp16' | 'q4';
  /** 用户偏好 */
  pref: RuntimePref;
  /** 若偏好无法满足，说明原因（如「已指定 WebGPU 但浏览器不支持」） */
  fallbackReason?: string;
}

const PREF_KEY = 'zj-runtime-pref';

/** 读取已保存的运行时偏好 */
export function readRuntimePref(): RuntimePref {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw === 'auto' || raw === 'webgpu' || raw === 'wasm') return raw;
  } catch {
    /* 忽略 */
  }
  return 'auto';
}

/** 持久化运行时偏好（下次加载模型时生效） */
export function saveRuntimePref(pref: RuntimePref) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREF_KEY, pref);
  } catch {
    /* 忽略 */
  }
}

/** 探测结果缓存 —— WebGPU 能力在页面生命周期内不会变，无需反复问 GPU */
let cached: RuntimeInfo | null = null;

/** 探测 WebGPU 能力（不含偏好决策） */
async function probeWebGpu(): Promise<{
  hasWebGpuApi: boolean;
  hasWebGpuAdapter: boolean;
  adapterInfo?: string;
}> {
  // SSR / 老浏览器：直接判定不支持
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { hasWebGpuApi: false, hasWebGpuAdapter: false };
  }

  const gpu = (navigator as Navigator & {
    gpu: {
      requestAdapter: () => Promise<{
        info?: { vendor?: string; architecture?: string; description?: string };
        requestDevice: () => Promise<unknown>;
      } | null>;
    };
  }).gpu;

  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return { hasWebGpuApi: false, hasWebGpuAdapter: false };
  }

  let adapter: Awaited<ReturnType<typeof gpu.requestAdapter>> = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    // 某些环境下 requestAdapter 会抛错（如驱动被禁用）
    return { hasWebGpuApi: true, hasWebGpuAdapter: false };
  }

  if (!adapter) {
    // 有 API 但拿不到适配器：常见于无独显 / 驱动不支持 / 浏览器策略禁用
    return { hasWebGpuApi: true, hasWebGpuAdapter: false };
  }

  let adapterInfo: string | undefined;
  const info = adapter.info;
  if (info) {
    const parts = [info.vendor, info.architecture, info.description].filter(
      (s): s is string => Boolean(s),
    );
    if (parts.length) adapterInfo = parts.join(' · ');
  }

  // 必须能真正创建 device 才算可用 —— requestAdapter 成功但建 device 失败的情况存在
  try {
    await adapter.requestDevice();
  } catch {
    return { hasWebGpuApi: true, hasWebGpuAdapter: false, adapterInfo };
  }

  return { hasWebGpuApi: true, hasWebGpuAdapter: true, adapterInfo };
}

/**
 * 解析出本次推理使用的运行时。
 *
 * @param pref 用户偏好；不传则读localStorage
 * @param force 若为 true 则忽略缓存，强制重新探测（用户手动切换时用）
 */
export async function resolveRuntime(
  pref?: RuntimePref,
  force = false,
): Promise<RuntimeInfo> {
  if (cached && !force && pref === undefined) return cached;

  const effectivePref = pref ?? readRuntimePref();
  const probe = await probeWebGpu();
  const webgpuUsable = probe.hasWebGpuApi && probe.hasWebGpuAdapter;

  let device: RuntimeDevice;
  let dtype: 'fp16' | 'q4';
  let fallbackReason: string | undefined;

  if (effectivePref === 'webgpu') {
    if (webgpuUsable) {
      device = 'webgpu';
      // WebGPU 走 fp16：GPU 对半精度支持好，且比 q4 更快
      dtype = 'fp16';
    } else {
      device = 'wasm';
      dtype = 'q4';
      fallbackReason = probe.hasWebGpuApi
        ? '浏览器暴露了 WebGPU 接口，但未能获取到可用的 GPU 适配器'
        : '当前浏览器不支持 WebGPU';
    }
  } else if (effectivePref === 'wasm') {
    device = 'wasm';
    dtype = 'q4';
  } else {
    // auto：能用就用，WebGPU 通常比 WASM 快一个数量级
    device = webgpuUsable ? 'webgpu' : 'wasm';
    dtype = webgpuUsable ? 'fp16' : 'q4';
  }

  const info: RuntimeInfo = {
    ...probe,
    device,
    dtype,
    pref: effectivePref,
    ...(fallbackReason ? { fallbackReason } : {}),
  };

  // 带显式 pref 的调用不写缓存，避免污染全局状态
  if (pref === undefined) cached = info;
  return info;
}

/** 仅返回当前已缓存的运行时信息（未探测过则为 undefined） */
export function peekRuntime(): RuntimeInfo | undefined {
  return cached ?? undefined;
}

/** 清除缓存（测试用） */
export function __resetRuntimeCache() {
  cached = null;
}
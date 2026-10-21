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

/**
 * 权重精度。
 *
 * - `q4f16` —— q4 量化存储 + fp16 计算，**WebGPU 的正确选择**。
 *   体积与 q4 相当，但计算走 fp16，GPU 上快得多，且算子支持度最好。
 * - `q4` —— 纯 q4 量化，WASM 后端用它（体积最小，不依赖 fp16 能力）。
 *
 * ⚠️ 不要在 WebGPU 上用 `fp16`：那会加载完整半精度权重（体积数倍于 q4），
 * 且部分算子在 WebGPU EP 上不受支持，表现为初始化阶段抛出难以解读的错误。
 */
export type RuntimeDtype = 'q4f16' | 'q4';

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
  dtype: RuntimeDtype;
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
 * WebGPU 冒烟测试：在适配器上真正跑一次 GPU 计算负载。
 *
 * ## 为什么必须做这一步
 *
 * `requestAdapter()` + `requestDevice()` 成功**不代表** ONNX Runtime 的
 * WebGPU 执行后端（WebGpuBackend）能真正建起 session。实测中遇到过：
 * 探测全部通过，但加载模型时WebGPU 初始化失败，且 ONNX Runtime
 * 抛出的**不是 Error 实例而是一个裸数字**（如 999335224 / 1888206176），
 * 每次还不一样 —— 那是 wasm 侧未初始化的内存/句柄值，不是可读错误码。
 *
 * 典型触发条件：驱动版本与浏览器 WebGPU 实现不匹配、
 * 沙箱/远程桌面环境、GPU 被其他进程独占、安全策略限制等。
 *
 * 这里用一次最小计算（buffer 写入 + 回读）验证 GPU 队列真能工作，
 * 比等到下载完几百MB 权重才发现不能用要划算得多。
 */
async function smokeTestWebGpu(): Promise<{ ok: boolean; reason?: string }> {
  type GpuBuffer = {
    getMappedRange: () => ArrayBuffer;
    unmap: () => void;
    mapAsync: (mode: number) => Promise<void>;
    destroy: () => void;
  };
  type GpuDevice = {
    createBuffer: (d: { size: number; usage: number }) => GpuBuffer;
    queue: { writeBuffer: (b: unknown, o: number, d: ArrayBufferView) => void };
    addEventListener?: (type: string, cb: (e: unknown) => void) => void;
    destroy: () => void;
  };

  try {
    const adapter = await (
      navigator as Navigator & {
        gpu: { requestAdapter: () => Promise<{ requestDevice: () => Promise<GpuDevice> } | null> };
      }
    ).gpu.requestAdapter();

    if (!adapter) return { ok: false, reason: '无法获取 GPU 适配器' };

    const device = await adapter.requestDevice();
    // 允许驱动把校验错误异步抛到 uncapturederror，而不是让探测直接失败
    let asyncError: string | undefined;
    device.addEventListener?.('uncapturederror', (e: unknown) => {
      const msg =
        (e as { error?: { message?: string } })?.error?.message ??
        '未知 WebGPU 错误';
      asyncError ??= String(msg);
    });

    // 最小往返：4 字节写入再映射回读，验证队列与缓冲都正常
    const buffer = device.createBuffer({
      size: 4,
      usage: 0x0008 | 0x0001, // COPY_DST | MAP_READ
    });
    device.queue.writeBuffer(buffer, 0, new Uint32Array([1]));
    await buffer.mapAsync(1); // MAP_READ
    const value = new Uint32Array(buffer.getMappedRange())[0];
    buffer.unmap();
    buffer.destroy();
    device.destroy();

    if (asyncError) return { ok: false, reason: asyncError };
    if (value !== 1) {
      return { ok: false, reason: 'GPU 计算结果不正确' };
    }
    return { ok: true };
  } catch (err) {
    // 注意：这里的错误同样可能是裸数字
    return {
      ok: false,
      reason: `WebGPU 冒烟测试失败（${describeRaw(err)}）`,
    };
  }
}

/** 把任意（含裸数字的）错误值转成可读文本 */
function describeRaw(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'number') {
    return `底层抛出未包装的错误码 ${err}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err)?.slice(0, 120) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * 解析出本次推理使用的运行时。
 *
 * @param pref 用户偏好；不传则读localStorage
 * @param force 若为 true 则忽略缓存，强制重新探测（用户手动切换时用）
 * @param deep 是否执行 WebGPU 冒烟测试。加载模型前应传 true，
 *             仅在设置面板展示概览时可传 false 以免拖慢渲染。
 */
export async function resolveRuntime(
  pref?: RuntimePref,
  force = false,
  deep = false,
): Promise<RuntimeInfo> {
  if (cached && !force && pref === undefined) return cached;

  const effectivePref = pref ?? readRuntimePref();
  const probe = await probeWebGpu();
  let webgpuUsable = probe.hasWebGpuApi && probe.hasWebGpuAdapter;
  let smokeReason: string | undefined;

  // 只有真正要加载模型时才做冒烟测试：
  // 能建device ≠ 能建 ORT session，不测就会在下载完权重后才炸
  if (webgpuUsable && deep) {
    const smoke = await smokeTestWebGpu();
    if (!smoke.ok) {
      webgpuUsable = false;
      smokeReason = smoke.reason;
    }
  }

  let device: RuntimeDevice;
  let dtype: RuntimeDtype;
  let fallbackReason: string | undefined;

  if (effectivePref === 'webgpu') {
    if (webgpuUsable) {
      device = 'webgpu';
      // WebGPU 走 q4f16：q4 量化存储 + fp16 计算，
      // 体积与 q4 相当但计算走 fp16，且算子支持度最好
      dtype = 'q4f16';
    } else {
      device = 'wasm';
      dtype = 'q4';
      fallbackReason = probe.hasWebGpuApi
        ? `WebGPU 不可用（${smokeReason ?? '未能获取可用的 GPU 适配器'}），已回退到 WASM`
        : '当前浏览器不支持 WebGPU，已回退到 WASM';
    }
  } else if (effectivePref === 'wasm') {
    device = 'wasm';
    dtype = 'q4';
  } else {
    // auto：能用就用，WebGPU 通常比 WASM 快一个数量级
    device = webgpuUsable ? 'webgpu' : 'wasm';
    dtype = webgpuUsable ? 'q4f16' : 'q4';
    if (!webgpuUsable && smokeReason) {
      fallbackReason = `WebGPU 冒烟测试未通过（${smokeReason}），已使用 WASM`;
    }
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
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
 * - `q4` —— 纯 q4 量化。**两个后端都用它**，也是当前唯一��� WebGPU 上实测可用的精度。
 * - `q4f16` —— q4 量化存储 + fp16 计算。
 *
 * ## ⚠️ 关于 q4f16 的重要更正（实测结论）
 *
 * 早期注释断言「q4f16 是 WebGPU 的正确选择，算子支持度最好」——**这个假设是错的**。
 * 在 NVIDIA Lovelace（RTX 40 系，`shader-f16` 可用、`crossOriginIsolated=true`）
 * 上用同一份 Qwen1.5-0.5B 权重做对照实验，结果是：
 *
 * | 精度| WebGPU EP | WASM EP |
 * |------|-----------|----------|
 * | `q4f16` | ❌ 裸数字失败（130907384 / 999335224 / 1003122552） | ✅ 38s 加载成功 |
 * | `q4`     | ✅ 61s 加载成功（51 个输入全在 GPU） | ✅ |
 * | `uint8`  | ✅ 72s 加载成功 | ✅ |
 *
 * 也就是说：**失败的是 q4f16 这条精度路径本身**，与显卡、驱动、权重文件都无关。
 * 同一个模型换 `q4` 就能在 GPU 上跑，说明 WebGPU EP 本身是好的。
 *
 * 因此 WebGPU 现在默认用 `q4`；`q4f16` 仅作为用户显式选择时才会被尝试，
 * 且失败会被降级阶梯自动兜回 `q4`。
 *
 * ⚠️ 另外不要在 WebGPU 上用 `fp16`：那会加载完整半精度权重（体积数倍于 q4），
 * 且部分算子在 WebGPU EP 上不受支持。
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
 * ## 它能测出什么、测不出什么
 *
 * 能测出：浏览器 WebGPU 队列是否可用（buffer 写入 + 映射回读）。
 * 这类环境问题确实存在 —— 驱动与浏览器实现不匹配、GPU 被其他进程独占、
 * 安全策略限制等，此时 `requestAdapter` 或队列本身就会出问题。
 *
 * 测不出：**ONNX Runtime WebGPU 执行后端（JSEP）的初始化**。
 * 那一层在 `requestAdapter` / `requestDevice` 全部成功之后才开始工作，
 * 失败时抛的是裸数字（如 999335224 / 130907384 / 1003122552）而非 Error 实例。
 *
 * ## 那个裸数字的真实原因（实测结论）
 *
 * 早期把它归因为「显卡驱动 / 环境不支持 WebGPU」，是误判。
 * 对照实验（NVIDIA Lovelace、shader-f16 可用、适配器与 device 均正常、
 * 同一份 493MB Qwen1.5-0.5B 权重）：
 *
 * | 精度 | WebGPU EP | WASM EP |
 * |------|-----------|----------|
 * | q4f16 | ❌ 裸数字失败 | ✅ |
 * | q4    | ✅ 成功      | ✅ |
 *
 * 所以真正的原因是 **q4f16 精度与 WebGPU EP 不兼容**，
 * 而不是硬件或环境。本函数测不到它，但 `resolveRuntime` 现在
 * 默认给 WebGPU 选 q4，从源头上避免触发（见 `RuntimeDtype`）。
 *
 * 本函数仍然保留：它挡掉的是「浏览器/驱动层面的 GPU 不可用」，
 * 这类情况在真实设备上并不罕见。
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
      // WebGPU 走 q4 —— 实测 q4f16 在 WebGPU EP 上必定失败（抛裸数字），
      // 详见 RuntimeDtype 的对照实验表。GPU 上 q4 已能跑满，
      // 没有理由再冒q4f16 失败的风险。
      dtype = 'q4';
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
    dtype = 'q4';
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
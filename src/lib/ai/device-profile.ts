/**
 * device-profile.ts —— 按「这台机器真实的 GPU 限额」算权重预算，而不是硬编码常量。
 *
 * ## 为什么要有这个模块
 *
 * 之前 `WEBGPU_MAX_Q4_BYTES` 是写死的 1 GiB。它是从一台具体机器实测出来的
 * （`maxBufferSize` = 2 GiB，ORT WebGPU EP 把整个权重塞进**单个** buffer），
 * 属于「经验值」，不是规范值：
 *
 * - 部分集成显卡 / 移动端浏览器把 `maxBufferSize` 报成 256 MB ~ 1 GiB，
 *   按 1 GiB 常量放行，结果是**下载完几百 MB 才在分配阶段崩**；
 * - 反过来，报出 4 GiB 上限的设备（部分独显 + 新版驱动）本可以跑 1.5B 的
 *   1.7 GB 权重，却被常量一刀切成 WASM，白白损失一个数量级的吞吐。
 *
 * 所以改成：**读 `GPUAdapter.limits` 算预算**，读不到才退回常量。
 *
 * ## 预算怎么算
 *
 * ORT 的 WebGPU EP 不提供分块/分页开关（可配项只有 `preferredLayout`），
 * 因此「权重能否上 GPU」的判据是**权重 ≤ 单次分配上限**。
 * 但单 buffer 上限不能全给权重 —— 激活值、KV cache、算子工作区都要挤在
 * 同一块显存里。故预算取单次分配上限的 **50%**：
 *
 *     预算 = min(maxBufferSize, maxStorageBufferBindingSize) × 0.5
 *
 * 50% 这个系数让主流设备（2 GiB 上限）得到 1 GiB —— **与历史常量完全一致**，
 * 即这次改动不改动已验证设备的既有行为，只修正溢出两侧的误判。
 *
 * ⚠️ 这是**上界估计**，不是承诺：显卡被其他标签页占用、驱动实现差异都可能
 * 让实际可用显存更少。真正的兜底仍是加载失败后的降级阶梯。
 */

/** GPU 适配器暴露的限额（只取我们关心的两项） */
export interface GpuLimits {
  /** 单个 GPUBuffer 的最大字节数 */
  maxBufferSize?: number;
  /** 单个 storage buffer binding 的最大字节数 */
  maxStorageBufferBindingSize?: number;
}

/**
 * 设备未暴露 limits 时的回落预算 —— 与历史常量保持一致（1 GiB）。
 * 宁可保守：这类环境通常是老浏览器或受限的集成显卡。
 */
export const FALLBACK_GPU_BUDGET_BYTES = 1024 * 1024 * 1024;

/** 单次分配上限中，留给权重的比例（余下给激活 / KV / 工作区） */
export const GPU_HEADROOM_RATIO = 0.5;

/**
 * 单次分配上限 = min(maxBufferSize, maxStorageBufferBindingSize)。
 *
 * 两个都要看：前者限制「能建多大的 buffer」，后者限制「能绑定多大的 buffer」，
 * 实际可用值是两者较小者。缺一个就按另一个算，两个都缺返回 undefined。
 */
export function readSingleAllocBytes(limits?: GpuLimits): number | undefined {
  const candidates = [limits?.maxBufferSize, limits?.maxStorageBufferBindingSize].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

/**
 * 算出本机 GPU 可用于**权重**的字节预算。
 *
 * @param limits 适配器限额；缺失或非法时退回 {@link FALLBACK_GPU_BUDGET_BYTES}
 */
export function computeGpuWeightBudget(limits?: GpuLimits): number {
  const single = readSingleAllocBytes(limits);
  if (single === undefined) return FALLBACK_GPU_BUDGET_BYTES;
  // 向下取整到整字节，避免浮点误差把边界值判反
  return Math.floor(single * GPU_HEADROOM_RATIO);
}

/** 权重能否放进 GPU 预算 */
export function fitsGpuBudget(weightBytes: number | undefined, budgetBytes: number): boolean {
  // 体积未知时放行 —— 宁可试一把，多数模型都在阈值内；明确超限才拦
  if (weightBytes === undefined) return true;
  return weightBytes <= budgetBytes;
}

/** 把字节数说成人话（界面文案与日志共用） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

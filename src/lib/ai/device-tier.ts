/**
 * device-tier.ts —— 把「这台机器能跑多大的模型」变成一个可解释的档位。
 *
 * ## 为什么只做「选模型」，不做「换路径」
 *
 * 规格里设想的是三档：本地完整推理 / 本地 prefill + 局域网 decode（SplitLLM）/ 后端转发。
 * 中间那一档需要自研运行时（两侧都要能拿到 KV cache 与隐藏状态），当前引擎做不到。
 * 所以这里只做**能落地的那一半**：给出档位 + 推荐模型，让用户不必自己猜
 * 「我这台机器该选 0.5B 还是 1.5B」。
 *
 * 档位依据 `device-profile.ts` 算出的 GPU 权重预算（实测 `GPUAdapter.limits`），
 * 不是拍脑袋的常量。三个阈值对应三件真实的事：
 *
 * | 档位 | 判据 | 含义 |
 * | --- | --- | --- |
 * | 高配 | 预算 ≥ 1.5 GiB | 1.5B 级模型能整个放进单个 GPU buffer |
 * | 中配 | 预算 ≥ 400 MiB | 0.5B/0.6B 级能上 GPU（最小模型 398 MB） |
 * | 低配 | 其余 / 无 WebGPU | 只能 CPU 推理，本地体验很差 |
 *
 * ## 低配为什么不推荐「最大的能跑的模型」
 *
 * WASM 下 1.5B 确实能跑（实测 319 秒加载），但那不是「能用」。
 * 低配设备的合理选择是**最小模型**，或者干脆改用后端转发 ——
 * 推荐一个要等五分钟的模型等于骗人。
 */

import type { LocalModelOption } from './local-models';

export type DeviceTier = 'high' | 'mid' | 'low';

/** 高配门槛：1.5 GiB —— 1.5B 的 q4 权重（1.7 GB）勉强放得进 2 GiB 预算 */
export const TIER_HIGH_BYTES = 1.5 * 1024 * 1024 * 1024;

/** 中配门槛：400 MiB —— 清单里最小的模型是 398 MB */
export const TIER_MID_BYTES = 400 * 1024 * 1024;

export interface DeviceTierInput {
  /** 来自 `resolveRuntime().gpuWeightBudgetBytes`；0 表示没有可用 GPU */
  gpuWeightBudgetBytes: number;
  /** 是否拿到可用的 WebGPU 适配器 */
  hasWebGpu: boolean;
  /**
   * 可选模型清单 —— **由调用方传入**，本模块不静态依赖 `local-models`。
   *
   * 这么做是为了让这个文件能被 Node 直接加载做单测：Node 的类型擦除
   * 不解析无扩展名的相对导入（项目里用的是 bundler 风格），
   * 而 `import type` 会被完全擦除，运行时不会触发解析。
   */
  models: readonly LocalModelOption[];
}

export interface DeviceAssessment {
  tier: DeviceTier;
  /** 展示用短名：高配 / 中配 / 低配 */
  label: string;
  /** 一句话解释「为什么是这一档」，直接展示给用户 */
  reason: string;
  /** 推荐的本地模型（低配时是最小的那个） */
  recommendedModel: LocalModelOption | undefined;
}

/** 按体积升序（清单本身已从小到大排，但不要依赖这个约定） */
function bySizeAscending(a: LocalModelOption, b: LocalModelOption): number {
  return (a.q4Bytes ?? 0) - (b.q4Bytes ?? 0);
}

/**
 * 在预算内挑**最大**的模型；一个都放不下时返回最小的。
 *
 * 「最大」是有意为之：能跑大模型时，质量差距比速度更影响体验。
 */
export function pickRecommendedModel(
  budgetBytes: number,
  models: readonly LocalModelOption[],
): LocalModelOption | undefined {
  const sorted = [...models].sort(bySizeAscending);
  if (sorted.length === 0) return undefined;
  const fit = sorted.filter((m) => (m.q4Bytes ?? 0) <= budgetBytes);
  return fit.length > 0 ? fit[fit.length - 1] : sorted[0];
}

/**
 * 评估设备档位并给出推荐模型。
 *
 * 注意：没有 WebGPU 时**一律低配** —— 即便预算数值看起来够，
 * 走 WASM 跑中等模型的等待时间也不可接受。
 */
export function assessDevice(input: DeviceTierInput): DeviceAssessment {
  const { gpuWeightBudgetBytes: budget, hasWebGpu, models } = input;
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  const smallest = [...models].sort(bySizeAscending)[0];

  if (!hasWebGpu) {
    return {
      tier: 'low',
      label: '低配',
      reason: '没有可用的 WebGPU，只能 CPU 推理；建议改用后端转发，或选最小模型',
      recommendedModel: smallest,
    };
  }

  if (budget >= TIER_HIGH_BYTES) {
    return {
      tier: 'high',
      label: '高配',
      reason: `GPU 可用显存预算约 ${mb(budget)} MB，1.5B 级模型能整个放进单个 GPU buffer`,
      recommendedModel: pickRecommendedModel(budget, models),
    };
  }

  if (budget >= TIER_MID_BYTES) {
    return {
      tier: 'mid',
      label: '中配',
      reason: `GPU 可用显存预算约 ${mb(budget)} MB，适合 0.5B–0.6B 级模型`,
      recommendedModel: pickRecommendedModel(budget, models),
    };
  }

  return {
    tier: 'low',
    label: '低配',
    reason: `GPU 可用显存预算只有 ${mb(budget)} MB，本地推理会很慢；建议改用后端转发`,
    recommendedModel: smallest,
  };
}

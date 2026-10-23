/**
 * GPU 权重预算 + 设备档位的行为测试
 *
 * 直接加载 `src/lib/ai/device-profile.ts` / `device-tier.ts`（Node 22.6+ 类型擦除）。
 * 这里测的是**纯函数**：给定适配器限额，预算、档位与推荐模型是否符合预期。
 * 真实 `GPUAdapter.limits` 的读取在 runtime.ts 里，需浏览器才能测。
 *
 * 用法：node scripts/ai-budget-test.mjs
 */

import {
  computeGpuWeightBudget,
  readSingleAllocBytes,
  fitsGpuBudget,
  formatBytes,
  FALLBACK_GPU_BUDGET_BYTES,
} from '../src/lib/ai/device-profile.ts';
import {
  assessDevice,
  pickRecommendedModel,
  TIER_HIGH_BYTES,
  TIER_MID_BYTES,
} from '../src/lib/ai/device-tier.ts';
import { WEBGPU_MAX_Q4_BYTES, LOCAL_MODEL_OPTIONS, canUseWebGpu } from '../src/lib/ai/local-models.ts';

let pass = 0;
let fail = 0;
function check(ok, name, extra = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  →  ' + extra : ''}`);
}

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

// 清单里的真实体积（避免手写魔法数）
const small = LOCAL_MODEL_OPTIONS.find((m) => m.id.includes('Qwen2.5-0.5B'));
const big = LOCAL_MODEL_OPTIONS.find((m) => m.id.includes('Qwen2.5-1.5B'));
const tiny = LOCAL_MODEL_OPTIONS.find((m) => m.id.includes('SmolLM2'));

// ========== 1. 读不到 limits → 退回保守常量，且与历史行为一致 ==========
check(
  computeGpuWeightBudget(undefined) === FALLBACK_GPU_BUDGET_BYTES,
  '没有 limits 时预算退回 1 GiB',
  formatBytes(computeGpuWeightBudget(undefined)),
);
check(
  FALLBACK_GPU_BUDGET_BYTES === WEBGPU_MAX_Q4_BYTES,
  '退回值与历史常量相等（升级不改变已验证设备的行为）',
  `${formatBytes(FALLBACK_GPU_BUDGET_BYTES)} vs ${formatBytes(WEBGPU_MAX_Q4_BYTES)}`,
);

// ========== 2. 主流设备：2 GiB 单次分配 → 预算仍为 1 GiB ==========
const mainstream = { maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 2 * GiB };
check(
  computeGpuWeightBudget(mainstream) === WEBGPU_MAX_Q4_BYTES,
  '2 GiB 上限 → 预算 1 GiB（与旧常量一致，行为不变）',
  formatBytes(computeGpuWeightBudget(mainstream)),
);
check(
  canUseWebGpu(small, computeGpuWeightBudget(mainstream)) === true &&
    canUseWebGpu(big, computeGpuWeightBudget(mainstream)) === false,
  '主流设备上 0.5B 可上 GPU、1.5B 不可',
  `0.5B=${formatBytes(small.q4Bytes)} 1.5B=${formatBytes(big.q4Bytes)}`,
);

// ========== 3. 高端设备：4 GiB 上限 → 1.5B 解锁（这次改动的实际收益） ==========
const highEnd = { maxBufferSize: 4 * GiB, maxStorageBufferBindingSize: 4 * GiB };
check(
  computeGpuWeightBudget(highEnd) === 2 * GiB,
  '4 GiB 上限 → 预算 2 GiB',
  formatBytes(computeGpuWeightBudget(highEnd)),
);
check(
  canUseWebGpu(big, computeGpuWeightBudget(highEnd)) === true,
  '高端设备上 1.5B（1.7 GB）可以走 WebGPU —— 旧常量会把这一档误拦',
  formatBytes(big.q4Bytes),
);

// ========== 4. 弱设备：提前拦住，避免下完才发现跑不了 ==========
const weak = { maxBufferSize: 256 * MiB, maxStorageBufferBindingSize: 256 * MiB };
check(
  !canUseWebGpu(tiny, computeGpuWeightBudget(weak)),
  '256 MiB 上限的设备连最小的模型都判为不可用（旧常量会放行到崩溃）',
  `预算 ${formatBytes(computeGpuWeightBudget(weak))} < 最小权重 ${formatBytes(tiny.q4Bytes)}`,
);

// ========== 5. 两个限额取较小者 ==========
check(
  readSingleAllocBytes({ maxBufferSize: 2 * GiB, maxStorageBufferBindingSize: 128 * MiB }) === 128 * MiB,
  '单次分配上限取 maxBufferSize 与 maxStorageBufferBindingSize 的较小者',
);
check(
  readSingleAllocBytes({}) === undefined && readSingleAllocBytes({ maxBufferSize: 0 }) === undefined,
  '空 / 非法限额返回 undefined（转由 fallback 接管）',
);

// ========== 6. 边界与未知体积 ==========
const budget = computeGpuWeightBudget(mainstream);
check(
  fitsGpuBudget(budget, budget) && !fitsGpuBudget(budget + 1, budget),
  '预算边界是闭区间：等于预算放行，多 1 字节就拦',
);
check(fitsGpuBudget(undefined, budget), '体积未知时放行（宁可试一把）');

// ========== 7. 文案 ==========
check(
  formatBytes(1 * GiB) === '1.0 GB' && formatBytes(512 * MiB) === '512 MB',
  'formatBytes 在 GB/MB 之间正确切换',
  `${formatBytes(1 * GiB)} / ${formatBytes(512 * MiB)}`,
);

// ========== 8. 设备档位与推荐模型 ==========
const high = assessDevice({ gpuWeightBudgetBytes: 2 * GiB, hasWebGpu: true, models: LOCAL_MODEL_OPTIONS });
check(high.tier === 'high', '预算 2 GiB + WebGPU → 高配', high.reason);
check(
  high.recommendedModel?.id === big.id,
  '高配推荐清单里最大的、且放得下的模型（1.5B）',
  high.recommendedModel?.id,
);

const mid = assessDevice({ gpuWeightBudgetBytes: 1 * GiB, hasWebGpu: true, models: LOCAL_MODEL_OPTIONS });
check(mid.tier === 'mid', '预算 1 GiB + WebGPU → 中配', mid.reason);
check(
  (mid.recommendedModel?.q4Bytes ?? Infinity) <= 1 * GiB,
  '中配推荐的模型必须放得进预算（不能推荐跑不动的）',
  `${mid.recommendedModel?.id} ${formatBytes(mid.recommendedModel?.q4Bytes ?? 0)}`,
);

const lowByBudget = assessDevice({ gpuWeightBudgetBytes: 200 * MiB, hasWebGpu: true, models: LOCAL_MODEL_OPTIONS });
check(lowByBudget.tier === 'low', '预算 200 MiB → 低配', lowByBudget.reason);

const lowNoGpu = assessDevice({ gpuWeightBudgetBytes: 2 * GiB, hasWebGpu: false, models: LOCAL_MODEL_OPTIONS });
check(
  lowNoGpu.tier === 'low',
  '没有 WebGPU 时一律低配（预算数字再大也不推荐本地跑大模型）',
  lowNoGpu.reason,
);
check(
  lowNoGpu.recommendedModel?.q4Bytes === tiny.q4Bytes,
  '低配推荐清单里最小的模型（而不是「最大的能跑的」）',
  lowNoGpu.recommendedModel?.id,
);

// 阈值边界：正好达到门槛应按更高档算
check(
  assessDevice({ gpuWeightBudgetBytes: TIER_HIGH_BYTES, hasWebGpu: true, models: LOCAL_MODEL_OPTIONS }).tier === 'high' &&
    assessDevice({ gpuWeightBudgetBytes: TIER_HIGH_BYTES - 1, hasWebGpu: true, models: LOCAL_MODEL_OPTIONS }).tier === 'mid',
  '高配门槛是闭区间（达到即高配，差 1 字节回落中配）',
);
check(
  assessDevice({ gpuWeightBudgetBytes: TIER_MID_BYTES, hasWebGpu: true, models: LOCAL_MODEL_OPTIONS }).tier === 'mid' &&
    assessDevice({ gpuWeightBudgetBytes: TIER_MID_BYTES - 1, hasWebGpu: true, models: LOCAL_MODEL_OPTIONS }).tier === 'low',
  '中配门槛是闭区间',
);

// 预算连最小模型都放不下时，仍要给出「最小的那个」而不是 undefined
check(
  pickRecommendedModel(1, LOCAL_MODEL_OPTIONS) !== undefined,
  '预算极小（1 字节）时仍返回最小模型，不返回 undefined',
  pickRecommendedModel(1, LOCAL_MODEL_OPTIONS)?.id,
);

console.log('\n════════════════════════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('════════════════════════════════════════');
process.exit(fail === 0 ? 0 : 1);

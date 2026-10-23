/**
 * engine/registry.ts —— 引擎注册表。
 *
 * 现在只有 Transformers.js 一个实现，注册表的意义是**让第二个实现只需要
 * 加一行 register**，而不是改 Worker。引擎实例在 Worker 内是单例：
 * 重复创建会各自持有一份 pipeline，等于把权重在内存里存两份。
 */

import type { EngineId, InferenceEngine } from './types';
import { createTransformersEngine } from './transformers';

/** 默认引擎 —— 没有显式指定时用它 */
export const DEFAULT_ENGINE_ID: EngineId = 'transformers';

const factories = new Map<EngineId, () => InferenceEngine>();
const instances = new Map<EngineId, InferenceEngine>();

/**
 * 注册引擎工厂。
 *
 * 用工厂而不是直接放实例：引擎构造可能要做动态 import（Transformers.js
 * 与 ORT 都不小），不该在模块求值阶段就跑。
 */
export function registerEngine(id: EngineId, factory: () => InferenceEngine): void {
  factories.set(id, factory);
}

/**
 * 取引擎单例。未知 id 自动回落到默认引擎 ——
 * 这样主线程存了一个已被删除的引擎名时，AI 对话不会直接坏掉。
 */
export function getEngine(id?: EngineId | string): InferenceEngine {
  const wanted = (id ?? DEFAULT_ENGINE_ID) as EngineId;
  const key = factories.has(wanted) ? wanted : DEFAULT_ENGINE_ID;

  const existing = instances.get(key);
  if (existing) return existing;

  const factory = factories.get(key);
  if (!factory) throw new Error(`没有可用的推理引擎（${key}）`);
  const created = factory();
  instances.set(key, created);
  return created;
}

/** 已注册的引擎 id 列表（供诊断与后续的界面选择器使用） */
export function listEngineIds(): EngineId[] {
  return [...factories.keys()];
}

// 内置引擎：Transformers.js / ONNX Runtime Web
registerEngine('transformers', createTransformersEngine);

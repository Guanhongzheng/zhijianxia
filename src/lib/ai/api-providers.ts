/**
 * API 服务商清单的类型定义与读取器。
 *
 * 清单本体位于 shared/api-providers.json —— 前端与后端共用同一份数据源，
 * 避免「前端列了 DeepSeek、后端却不认识」这类协议漂移。
 */

import catalog from '../../../shared/api-providers.json';

/** 能力分类 id */
export type ApiCapability = 'chat' | 'vision' | 'image' | 'speech';

/** 请求协议类型 —— 决定后端如何构造请求与解析响应 */
export type ApiProtocol = 'openai' | 'anthropic' | 'gemini' | 'stability';

export interface ApiCapabilityMeta {
  id: ApiCapability;
  name: string;
  desc: string;
  icon: string;
}

export interface ApiModelOption {
  id: string;
  name: string;
  desc: string;
}

export interface ApiProviderMeta {
  id: string;
  name: string;
  capabilities: ApiCapability[];
  protocol: ApiProtocol;
  baseUrl: string;
  keyHint: string;
  docs: string;
  models: Partial<Record<ApiCapability, ApiModelOption[]>>;
}

/** 完整清单 */
export const API_CATALOG = catalog as ApiCatalog;

/** 清单结构（后端会原样返回，前端可直接消费） */
export interface ApiCatalog {
  version: number;
  capabilities: ApiCapabilityMeta[];
  providers: ApiProviderMeta[];
}

/** 能力分类列表（按展示顺序） */
export const API_CAPABILITIES: ApiCapabilityMeta[] = API_CATALOG.capabilities;

/** 服务商列表 */
export const API_PROVIDERS: ApiProviderMeta[] = API_CATALOG.providers;

/** 按 id 查找服务商 */
export function findProvider(id: string): ApiProviderMeta | undefined {
  return API_PROVIDERS.find((p) => p.id === id);
}

/** 找出支持指定能力的服务商 */
export function providersFor(capability: ApiCapability): ApiProviderMeta[] {
  return API_PROVIDERS.filter((p) => p.capabilities.includes(capability));
}

/** 某能力下某个服务商的可选模型 */
export function modelsOf(
  providerId: string,
  capability: ApiCapability,
): ApiModelOption[] {
  return findProvider(providerId)?.models[capability] ?? [];
}

/** 能力分类 id 是否合法 */
export function isCapability(id: string): id is ApiCapability {
  return API_CAPABILITIES.some((c) => c.id === id);
}

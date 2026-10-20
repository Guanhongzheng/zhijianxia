/**
 * 后端 API 客户端 —— 统一封装与可选后端的通信。
 * 后端未启动时所有请求都会被拦截，调用方需先检查连接状态。
 */

export interface ApiConfig {
  /** API 地址（OpenAI 兼容） */
  apiUrl: string;
  /** API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 请求超时（毫秒） */
  timeout: number;
  /** 温度 */
  temperature: number;
  /** 后端转发模式还是前端本地模式 */
  mode: 'local' | 'backend';
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
  timeout: 30_000,
  temperature: 0.7,
  mode: 'local',
};

export const API_CONFIG_KEY = 'zj-api-config';

/** 局域网连接配置 */
export interface LanConfig {
  /** 后端局域网 IP */
  host: string;
  /** WebSocket 端口 */
  port: number;
  /** 自动重连 */
  autoReconnect: boolean;
}

export const DEFAULT_LAN_CONFIG: LanConfig = {
  host: '',
  port: 8787,
  autoReconnect: true,
};

export const LAN_CONFIG_KEY = 'zj-lan-config';

export class BackendOfflineError extends Error {
  constructor() {
    super('后端服务未开启，请启动后端服务后再使用该功能');
    this.name = 'BackendOfflineError';
  }
}

/** 拼装后端基础地址 */
export function backendBaseUrl(cfg: LanConfig): string {
  const host = cfg.host.trim() || 'localhost';
  return `http://${host}:${cfg.port}`;
}

/** 拼装 WebSocket 地址 */
export function backendWsUrl(cfg: LanConfig): string {
  const host = cfg.host.trim() || 'localhost';
  return `ws://${host}:${cfg.port}/ws`;
}

/** 带超时的 fetch */
async function fetchWithTimeout(url: string, init: RequestInit, timeout: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 通用后端请求 */
export async function backendFetch<T>(
  cfg: LanConfig,
  path: string,
  init: RequestInit & { timeout?: number } = {},
): Promise<T> {
  const { timeout = 8000, ...rest } = init;
  const url = `${backendBaseUrl(cfg)}${path}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, rest, timeout);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('连接后端服务超时，请检查网络与后端状态');
    }
    throw new BackendOfflineError();
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: '后端返回了无法解析的数据' };
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  return data as T;
}

/** 后端健康检查 */
export async function pingBackend(cfg: LanConfig): Promise<boolean> {
  try {
    await backendFetch(cfg, '/api/health', { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 后端仓库客户端 —— 局域网内的插件包与主题包仓库。
 *
 * 设计要点：
 * - 插件包与主题包的**元数据**存在后端 SQLite，任何设备都能浏览；
 * - 用户点击「下载」后，包内容被缓存到本地 IndexedDB，
 *   此后即使后端离线也能继续使用（满足「下载后才可离线使用」）。
 */

import { backendFetch, type LanConfig, BackendOfflineError } from './client';
import type { ThemePack } from '@/lib/theme/types';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 仓库中的插件包摘要 */
export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  author: string;
  preview: string;
  tags: string[];
  sizeKB: number;
  builtin: boolean;
  offline: boolean;
  minCoreVersion: string;
  createdAt: number;
}

/** 仓库中的主题包摘要 */
export interface RegistryTheme {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  author: string;
  preview: string;
  tags: string[];
  createdAt: number;
}

/** 下载得到的插件包原文（.plugin 信封） */
export interface RemotePluginPackage {
  format?: string;
  formatVersion?: number;
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    category?: string;
    author?: string;
    preview?: string;
    tags?: string[];
    minCoreVersion?: string;
    builtin?: boolean;
    offline?: boolean;
  };
  core?: { minVersion?: string };
  entry?: unknown;
  assets?: Record<string, string>;
  exportedAt?: string;
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

/** 列出后端仓库中的全部插件包 */
export async function fetchRegistryPlugins(
  cfg: LanConfig,
  token: string,
): Promise<RegistryPlugin[]> {
  const res = await backendFetch<{ plugins?: RegistryPlugin[] }>(
    cfg,
    '/api/registry/plugins',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.plugins ?? [];
}

/** 下载指定插件包的完整内容 */
export async function fetchRegistryPlugin(
  cfg: LanConfig,
  token: string,
  id: string,
): Promise<RemotePluginPackage> {
  const res = await backendFetch<{ package?: RemotePluginPackage }>(
    cfg,
    `/api/registry/plugins/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.package) {
    throw new Error('后端返回的插件包内容为空');
  }
  return res.package;
}

/** 列出后端仓库中的全部主题包 */
export async function fetchRegistryThemes(
  cfg: LanConfig,
  token: string,
): Promise<RegistryTheme[]> {
  const res = await backendFetch<{ themes?: RegistryTheme[] }>(
    cfg,
    '/api/registry/themes',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.themes ?? [];
}

/** 下载指定主题包的内容 */
export async function fetchRegistryTheme(
  cfg: LanConfig,
  token: string,
  id: string,
): Promise<ThemePack> {
  const res = await backendFetch<{ pack?: ThemePack }>(
    cfg,
    `/api/registry/themes/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.pack) {
    throw new Error('后端返回的主题包内容为空');
  }
  return res.pack;
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/** 上传插件包到后端仓库（管理员） */
export async function uploadRegistryPlugin(
  cfg: LanConfig,
  token: string,
  pkg: unknown,
): Promise<RegistryPlugin> {
  const res = await backendFetch<{ plugin?: RegistryPlugin }>(
    cfg,
    '/api/registry/plugins',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ package: pkg }),
    },
  );
  if (!res.plugin) {
    throw new Error('后端未返回插件包信息');
  }
  return res.plugin;
}

/** 上传主题包到后端仓库（管理员） */
export async function uploadRegistryTheme(
  cfg: LanConfig,
  token: string,
  pack: ThemePack,
): Promise<RegistryTheme> {
  const res = await backendFetch<{ theme?: RegistryTheme }>(
    cfg,
    '/api/registry/themes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pack }),
    },
  );
  if (!res.theme) {
    throw new Error('后端未返回主题包信息');
  }
  return res.theme;
}

/** 从后端仓库删除插件包（管理员） */
export async function deleteRegistryPlugin(
  cfg: LanConfig,
  token: string,
  id: string,
): Promise<void> {
  await backendFetch(cfg, `/api/registry/plugins/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** 从后端仓库删除主题包（管理员） */
export async function deleteRegistryTheme(
  cfg: LanConfig,
  token: string,
  id: string,
): Promise<void> {
  await backendFetch(cfg, `/api/registry/themes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export { BackendOfflineError };

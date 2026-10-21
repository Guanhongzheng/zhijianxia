/**
 * 仓库内容的本地缓存 —— 让下载过的插件包与主题包在断网（后端离线）后仍可用。
 *
 * 分层说明：
 * - 后端 SQLite：权威的「仓库」，存放包本体与元数据，任何设备可浏览
 * - IndexedDB：每台设备自己的「已下载副本」，下载后写入，离线可用
 * - LocalStorage：主题包定义本身较小，直接存这里；插件包可能较大，走 IndexedDB
 */

import { idbGet, idbSet, idbDel, idbDelByPrefix } from '@/lib/storage/idb';
import { readLocal, writeLocal } from '@/lib/utils';
import type { ThemePack } from '@/lib/theme/types';

// ---------------------------------------------------------------------------
// 插件包缓存（IndexedDB）
// ---------------------------------------------------------------------------

/** 插件包缓存的 IndexedDB 主键前缀 */
const PLUGIN_CACHE_PREFIX = 'registry-plugin:';

/** 缓存插件包原文 */
export async function cachePluginPackage(
  id: string,
  pkg: unknown,
): Promise<boolean> {
  return idbSet(`${PLUGIN_CACHE_PREFIX}${id}`, pkg);
}

/** 读取缓存的插件包 */
export async function readCachedPluginPackage(
  id: string,
): Promise<unknown | undefined> {
  return idbGet(`${PLUGIN_CACHE_PREFIX}${id}`);
}

/** 判断某插件是否已缓存到本地（可离线使用） */
export async function hasCachedPluginPackage(id: string): Promise<boolean> {
  const pkg = await readCachedPluginPackage(id);
  return pkg !== undefined;
}

/** 列出全部已缓存的插件 id */
export async function listCachedPluginIds(): Promise<string[]> {
  const keys = await idbKeysWithPrefix(PLUGIN_CACHE_PREFIX);
  return keys.map((k) => k.slice(PLUGIN_CACHE_PREFIX.length));
}

/** 删除某个插件包的缓存 */
export async function removeCachedPluginPackage(id: string): Promise<boolean> {
  return idbDel(`${PLUGIN_CACHE_PREFIX}${id}`);
}

/** 清空全部插件包缓存 */
export async function clearCachedPluginPackages(): Promise<number> {
  return idbDelByPrefix(PLUGIN_CACHE_PREFIX);
}

// ---------------------------------------------------------------------------
// 主题包缓存（LocalStorage —— 主题包是纯 JSON，体积小）
// ---------------------------------------------------------------------------

/** 主题包缓存的 localStorage 键 */
const THEME_CACHE_KEY = 'zj-registry-themes';

/** 读取全部已缓存的主题包 */
export function readCachedThemes(): ThemePack[] {
  return readLocal<ThemePack[]>(THEME_CACHE_KEY, []);
}

/** 缓存主题包（按 id 覆盖） */
export function cacheTheme(pack: ThemePack): void {
  const list = readCachedThemes();
  const next = [...list.filter((p) => p.id !== pack.id), pack];
  writeLocal(THEME_CACHE_KEY, next);
}

/** 删除主题包缓存 */
export function removeCachedTheme(id: string): void {
  writeLocal(
    THEME_CACHE_KEY,
    readCachedThemes().filter((p) => p.id !== id),
  );
}

/** 清空主题包缓存 */
export function clearCachedThemes(): void {
  writeLocal(THEME_CACHE_KEY, []);
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/** 读取带前缀的 IndexedDB 键列表 */
async function idbKeysWithPrefix(prefix: string): Promise<string[]> {
  const { idbKeys } = await import('@/lib/storage/idb');
  const keys = await idbKeys();
  return keys.filter((k) => k.startsWith(prefix));
}

/**
 * 智简匣 · 插件动态加载器
 *
 * 两种加载路径：
 * 1. 预装插件：静态映射（preinstalledModules），随应用打包，零网络依赖
 * 2. 运行时插件：从 .plugin 包里的 entry 字段动态加载
 *    - esm：Blob URL + 动态 import()
 *    - cjs：Function 沙箱执行（受限环境）
 *    - url：直接 import() 远程地址
 *
 * 加载器只负责「把代码变成 PluginModule」，不关心插件内部逻辑。
 */

import { builtinModules } from './builtin';
import { downloadableModules } from './downloadable';
import type { PluginModule, PluginModuleLoader, PluginModuleNamespace } from './types';
import type { PluginRegistry } from './registry';

export type { PluginModuleLoader };

/** 预装插件的加载器映射：id -> 加载函数（预装，开机即用） */
export const builtinModuleLoaders: Record<string, PluginModuleLoader> = { ...builtinModules };

/** 可下载插件的加载器映射：id -> 加载函数（需用户在广场安装） */
export const downloadableModuleLoaders: Record<string, PluginModuleLoader> = {
  ...downloadableModules,
};

/** 全部插件的加载器映射 */
export const preinstalledModules: Record<string, PluginModuleLoader> = {
  ...builtinModules,
  ...downloadableModules,
};

/** 预装插件 id 集合 */
export const BUILTIN_IDS = Object.keys(builtinModuleLoaders);

/** 可下载插件 id 集合 */
export const DOWNLOADABLE_IDS = Object.keys(downloadableModuleLoaders);

/** 列出全部预装插件 id */
export function listPreinstalledIds(): string[] {
  return Object.keys(preinstalledModules).sort();
}

/** 判断某个 id 是否为预装插件 */
export function isPreinstalled(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(preinstalledModules, id);
}

/**
 * 归一化动态导入得到的模块命名空间。
 * 兼容三种导出形态：直接导出 PluginModule、default 导出、plugin 具名导出。
 */
export function normalizeModule(
  namespace: PluginModuleNamespace | { default?: unknown; plugin?: unknown },
): PluginModule {
  const candidates: unknown[] = [
    namespace,
    (namespace as { plugin?: unknown }).plugin,
    (namespace as { default?: unknown }).default,
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      'manifest' in candidate &&
      'Component' in candidate
    ) {
      return candidate as PluginModule;
    }
  }

  throw new Error('插件加载失败：模块没有导出合法的 PluginModule（需包含 manifest 与 Component）');
}

/**
 * 加载预装插件。
 * @param id 插件 id
 */
export async function loadPreinstalled(id: string): Promise<PluginModule> {
  const loader = preinstalledModules[id];
  if (!loader) {
    throw new Error(`插件加载失败：未找到预装插件「${id}」`);
  }
  return normalizeModule(await loader());
}

/**
 * 加载全部插件（预装 + 可下载）。
 * 返回的模块由调用方决定安装状态。
 */
export async function loadAllPreinstalled(): Promise<PluginModule[]> {
  const modules = await Promise.all(
    listPreinstalledIds().map(async (id) => {
      try {
        return await loadPreinstalled(id);
      } catch (error) {
        console.error(`[插件加载器] 插件「${id}」加载失败：`, error);
        return null;
      }
    }),
  );
  return modules.filter((m): m is PluginModule => m !== null);
}

/**
 * 将 ESM 源码转换为 Blob URL 并动态导入。
 * 注意：Blob 模块内的裸导入（如 'react'）无法解析，
 * 因此第三方插件应以「已打包的独立产物」形式提供。
 */
async function importEsmSource(source: string): Promise<unknown> {
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('插件加载失败：当前环境不支持 Blob 动态导入');
  }
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* webpackIgnore: true */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 在受限沙箱中执行 CommonJS 风格源码 */
function runCjsSource(source: string, moduleExports: Record<string, unknown>): void {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'module',
    'exports',
    'require',
    `${source}\n//# sourceURL=zhijianxia-plugin.js`,
  );
  const moduleObject = { exports: moduleExports };
  factory(moduleObject, moduleExports, () => {
    throw new Error('插件加载失败：运行时插件不支持 require 外部依赖');
  });
}

/**
 * 加载运行时插件（来自 .plugin 包的 entry）。
 * @param entry 插件包入口描述
 */
export async function loadRuntimePlugin(entry: {
  kind: 'esm' | 'cjs' | 'url';
  source?: string;
  url?: string;
}): Promise<PluginModule> {
  if (entry.kind === 'url') {
    if (!entry.url) {
      throw new Error('插件加载失败：entry.url 为空');
    }
    return normalizeModule(
      (await import(/* webpackIgnore: true */ entry.url)) as PluginModuleNamespace,
    );
  }

  if (!entry.source) {
    throw new Error('插件加载失败：entry.source 为空');
  }

  if (entry.kind === 'esm') {
    return normalizeModule((await importEsmSource(entry.source)) as PluginModuleNamespace);
  }

  const moduleExports: Record<string, unknown> = {};
  runCjsSource(entry.source, moduleExports);
  return normalizeModule(moduleExports as unknown as PluginModuleNamespace);
}

/**
 * 把预装插件注册进注册表。
 * 注册失败时返回中文错误信息，而不是抛出异常。
 */
export async function registerPlugin(
  registry: PluginRegistry,
  id: string,
): Promise<{ ok: true; module: PluginModule } | { ok: false; error: string }> {
  try {
    const module = await loadPreinstalled(id);
    registry.register(module, { replace: true });
    return { ok: true, module };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/**
 * 把运行时插件注册进注册表。
 * @param entry 插件包入口描述
 */
export async function registerRuntimePlugin(
  registry: PluginRegistry,
  entry: { kind: 'esm' | 'cjs' | 'url'; source?: string; url?: string },
): Promise<{ ok: true; module: PluginModule } | { ok: false; error: string }> {
  try {
    const module = await loadRuntimePlugin(entry);
    registry.register(module, { replace: true });
    return { ok: true, module };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

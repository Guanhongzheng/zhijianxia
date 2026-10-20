/**
 * 智简匣 · 插件内核统一入口
 *
 * 主框架只需从这里导入即可完成插件体系的全部接入：
 *
 * ```ts
 * import { createPluginKernel } from '@/plugins';
 *
 * const kernel = createPluginKernel({
 *   ai,                 // PluginAI
 *   theme,              // ThemeBridge（对接 src/lib/theme）
 *   backendOnline: false,
 *   notify,             // 全局通知
 *   requireBackend,     // 依赖后端提示
 *   openCard,           // 打开其它卡片
 * });
 *
 * await kernel.boot();          // 加载并注册全部预装插件
 * kernel.registry.listInstalled().map(...)
 * ```
 *
 * 内核不引用任何具体插件的业务逻辑，新增插件只需在 builtin/ 或 downloadable/ 登记。
 */

import { createPluginContext, createPluginStorage, type ThemeBridge } from './context';
import { pluginRegistry, type PluginRegistry } from './registry';
import {
  loadAllPreinstalled,
  loadPreinstalled,
  loadRuntimePlugin,
  preinstalledModules,
  BUILTIN_IDS,
} from './loader';
import {
  parsePluginPackage,
  CORE_VERSION,
} from './packager';
import type {
  PluginAI,
  PluginContext,
  PluginManifest,
  PluginModule,
  PluginNotifyType,
  PluginPackageResult,
} from './types';

export * from './types';
export * from './registry';
export * from './loader';
export * from './packager';
export * from './marketplace';
export { createPluginContext, createPluginStorage, type ThemeBridge } from './context';
export { THEME_PACKS, findThemePack } from './theme-packs';
export { useAiTask, usePluginTheme, useStoredState, useInterval } from './hooks';

/** 内核初始化参数 */
export interface PluginKernelInit {
  /** AI 调度器 */
  ai: PluginAI;
  /** 主题桥接（对接主框架的 src/lib/theme） */
  theme: ThemeBridge;
  /** 后端是否在线 */
  backendOnline: boolean;
  /** 全局通知 */
  notify: (message: string, type?: PluginNotifyType) => void;
  /** 依赖后端时的提示 */
  requireBackend: () => void;
  /** 打开其它插件卡片 */
  openCard: (id: string) => void;
  /** 使用的注册表（默认使用全局单例） */
  registry?: PluginRegistry;
}

/** 插件内核 */
export interface PluginKernel {
  /** 内核版本 */
  version: string;
  /** 插件注册表 */
  registry: PluginRegistry;
  /**
   * 加载并注册全部预装插件。
   * 重复调用不会重复注册。
   */
  boot(): Promise<PluginModule[]>;
  /**
   * 加载并注册指定插件。
   * @param id 插件 id
   */
  load(id: string): Promise<PluginModule>;
  /**
   * 为指定插件创建上下文（存储命名空间按插件 id 隔离）。
   */
  createContext(pluginId: string): PluginContext;
  /**
   * 导入 .plugin 包。
   * 校验失败时返回中文错误，不会污染注册表。
   */
  importPackage(text: string): Promise<PluginPackageResult<PluginModule>>;
  /**
   * 卸载插件（调用 onUninstall 并从注册表移除）。
   */
  uninstall(id: string): Promise<void>;
}

/**
 * 创建插件内核。
 */
export function createPluginKernel(init: PluginKernelInit): PluginKernel {
  const registry = init.registry ?? pluginRegistry;
  let booted = false;

  /** 为插件创建上下文 */
  const createCtx = (pluginId: string): PluginContext =>
    createPluginContext({
      pluginId,
      ai: init.ai,
      theme: init.theme,
      backendOnline: init.backendOnline,
      notify: init.notify,
      requireBackend: init.requireBackend,
      openCard: init.openCard,
      storage: createPluginStorage(pluginId),
    });

  return {
    version: CORE_VERSION,
    registry,

    async boot(): Promise<PluginModule[]> {
      if (booted) {
        return registry.list();
      }
      booted = true;
      const modules = await loadAllPreinstalled();
      for (const module of modules) {
        try {
          // 预装插件开机即用；可下载插件仅完成加载，等待用户从广场安装
          const isBuiltin = BUILTIN_IDS.includes(module.manifest.id);
          registry.register(module, { replace: true, installed: isBuiltin });
        } catch (error) {
          console.error(`[插件内核] 注册插件「${module.manifest.id}」失败：`, error);
        }
      }
      return registry.list();
    },

    async load(id: string): Promise<PluginModule> {
      const module = await loadPreinstalled(id);
      // 显式 load 视为用户主动启用该插件
      registry.register(module, { replace: true, installed: true });
      return module;
    },

    createContext: createCtx,

    async importPackage(text: string): Promise<PluginPackageResult<PluginModule>> {
      const parsed = parsePluginPackage(text, CORE_VERSION);
      if (!parsed.ok) {
        return parsed;
      }

      const pkg = parsed.value;

      // 若包内带有代码入口，走运行时加载
      if (pkg.entry) {
        try {
          const module = await loadRuntimePlugin(pkg.entry);
          registry.register(module, { replace: true });
          return { ok: true, value: module };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, error: `插件加载失败：${message}` };
        }
      }

      // 否则视为「已随应用打包的插件」，直接按 id 启用
      const alreadyLoaded = registry.get(pkg.manifest.id);
      if (alreadyLoaded) {
        registry.register(alreadyLoaded, { replace: true });
        return { ok: true, value: alreadyLoaded };
      }

      const loader = preinstalledModules[pkg.manifest.id];
      if (!loader) {
        return {
          ok: false,
          error: `插件「${pkg.manifest.id}」未随应用打包，且包内不含可加载的代码入口`,
        };
      }
      const module = await loader();
      registry.register(module, { replace: true });
      return { ok: true, value: module };
    },

    async uninstall(id: string): Promise<void> {
      const module = registry.get(id);
      if (!module) return;
      if (module.onUninstall) {
        try {
          await module.onUninstall(createCtx(id));
        } catch (error) {
          console.error(`[插件内核] 卸载钩子执行失败（${id}）：`, error);
        }
      }
      registry.unregister(id);
    },
  };
}

/** 便捷类型：插件清单 */
export type { PluginManifest };

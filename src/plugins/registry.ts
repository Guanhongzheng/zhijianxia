/**
 * 智简匣 · 插件注册表
 *
 * 纯内存实现，保存「已知插件」与「已安装插件」两份状态：
 * - modules：内核当前已加载、可以渲染的插件模块（预装 / 广场下载 / 外部导入）
 * - installed：用户实际启用的插件 id 集合（广场的「已安装」标记）
 *
 * 注册表支持运行时注册 / 注销，并提供变更订阅，方便 UI 响应热插拔。
 */

import type { PluginManifest, PluginModule } from './types';

/** 注册表变更事件 */
export type PluginRegistryEventType = 'register' | 'uninstall' | 'update' | 'install';

/** 注册表变更事件体 */
export interface PluginRegistryEvent {
  type: PluginRegistryEventType;
  /** 插件 id */
  id: string;
  /** 涉及该事件的插件清单 */
  manifest?: PluginManifest;
}

/** 变更监听器 */
export type PluginRegistryListener = (event: PluginRegistryEvent) => void;

/** 注册插件时的可选参数 */
export interface RegisterOptions {
  /** 允许覆盖已存在的同 id 插件，默认 false */
  replace?: boolean;
  /** 注册后是否直接标记为「已安装」，默认 true */
  installed?: boolean;
}

export class PluginRegistry {
  /** 已加载的插件模块 */
  private readonly modules = new Map<string, PluginModule>();
  /** 已安装（启用）的插件 id */
  private readonly installed = new Set<string>();
  /** 变更监听器集合 */
  private readonly listeners = new Set<PluginRegistryListener>();

  /**
   * 注册插件模块。
   * 同 id 已存在且未开启 replace 时抛出异常，避免静默覆盖。
   */
  register(module: PluginModule, options: RegisterOptions = {}): PluginModule {
    const { replace = false, installed = true } = options;
    const id = module?.manifest?.id;
    if (!id) {
      throw new Error('插件注册失败：缺少 manifest.id');
    }
    if (this.modules.has(id) && !replace) {
      throw new Error(`插件注册失败：插件「${id}」已存在`);
    }
    this.modules.set(id, module);
    if (installed) {
      this.installed.add(id);
    } else {
      this.installed.delete(id);
    }
    this.emit({ type: 'register', id, manifest: module.manifest });
    return module;
  }

  /**
   * 注销插件（从内核中彻底移除）。
   * 返回是否确实移除了插件。
   */
  unregister(id: string): boolean {
    const existed = this.modules.delete(id);
    const wasInstalled = this.installed.delete(id);
    if (existed) {
      this.emit({ type: 'uninstall', id, manifest: undefined });
    }
    return existed || wasInstalled;
  }

  /** 获取插件模块 */
  get(id: string): PluginModule | undefined {
    return this.modules.get(id);
  }

  /** 是否已加载该插件 */
  has(id: string): boolean {
    return this.modules.has(id);
  }

  /** 列出全部已加载插件（按 id 排序，保证渲染顺序稳定） */
  list(): PluginModule[] {
    return Array.from(this.modules.values()).sort((a, b) =>
      a.manifest.id.localeCompare(b.manifest.id),
    );
  }

  /** 按分类筛选插件 */
  listByCategory(category: string): PluginModule[] {
    return this.list().filter((m) => m.manifest.category === category);
  }

  /** 标记插件为已安装 */
  markInstalled(id: string): boolean {
    if (!this.modules.has(id)) return false;
    if (this.installed.has(id)) return true;
    this.installed.add(id);
    this.emit({ type: 'install', id, manifest: this.modules.get(id)?.manifest });
    return true;
  }

  /** 标记插件为未安装（保留模块，便于再次启用） */
  markUninstalled(id: string): boolean {
    if (!this.installed.has(id)) return false;
    this.installed.delete(id);
    this.emit({ type: 'uninstall', id, manifest: this.modules.get(id)?.manifest });
    return true;
  }

  /** 插件是否处于已安装状态 */
  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  /** 列出已安装的插件模块 */
  listInstalled(): PluginModule[] {
    return this.list().filter((m) => this.installed.has(m.manifest.id));
  }

  /**
   * 更新插件模块（热更新场景）。
   * 插件不存在时直接注册。
   */
  update(module: PluginModule): PluginModule {
    if (!this.modules.has(module.manifest.id)) {
      return this.register(module);
    }
    this.modules.set(module.manifest.id, module);
    this.emit({ type: 'update', id: module.manifest.id, manifest: module.manifest });
    return module;
  }

  /** 订阅注册表变更，返回取消订阅函数 */
  subscribe(listener: PluginRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 清空注册表 */
  clear(): void {
    this.modules.clear();
    this.installed.clear();
  }

  /** 派发变更事件 */
  private emit(event: PluginRegistryEvent): void {
    // 复制一份再遍历，避免监听器内部增删导致迭代异常
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (error) {
        console.error('[插件注册表] 监听器执行失败：', error);
      }
    }
  }
}

/** 全局单例注册表 */
export const pluginRegistry = new PluginRegistry();

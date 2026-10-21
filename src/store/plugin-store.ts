'use client';

import { create } from 'zustand';
import {
  createPluginKernel,
  type PluginAI,
  type PluginContext,
  type PluginKernel,
  type PluginManifest,
  type PluginModule,
} from '@/plugins';
import { useAppStore } from './app-store';
import { useAuthStore } from './auth-store';
import { useThemeStore, readThemeSnapshot } from './theme-store';
import { aiChat } from '@/lib/ai/scheduler';
import { getLocalAiState } from '@/lib/ai/local-engine';
import { idbGet, idbSet } from '@/lib/storage/idb';
import { readLocal } from '@/lib/utils';

const INSTALLED_KEY = 'zj-plugin-installed';

interface PluginStoreState {
  /** 内核实例 */
  kernel: PluginKernel | null;
  /** 已加载的插件模块 */
  modules: PluginModule[];
  /** 已安装的插件 id */
  installed: string[];
  /** 内核是否启动完成 */
  booted: boolean;
  /** 加载中（显示骨架屏） */
  loading: boolean;
  /** 导入中的文件名 */
  importing: string | null;
  /** 错误信息 */
  error: string | null;

  boot: () => Promise<void>;
  install: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  /** 从后端仓库下载插件包并缓存到本地（下载后方可离线使用） */
  downloadFromRegistry: (id: string) => Promise<void>;
  /** 上传已安装插件的包到后端仓库（管理员） */
  uploadToRegistry: (id: string) => Promise<void>;
  /** 正在下载的插件 id */
  downloading: string | null;
  importPackageFile: (file: File) => Promise<void>;
  exportPackage: (id: string) => Promise<void>;
  isInstalled: (id: string) => boolean;
  getModule: (id: string) => PluginModule | undefined;
  createContext: (id: string) => PluginContext | null;
  setError: (msg: string | null) => void;
}

/** 主题桥接：把主框架的主题 store 适配为内核的 ThemeBridge */
const themeBridge = {
  getSnapshot: () => {
    const snap = readThemeSnapshot();
    return {
      mode: snap.mode,
      accent: snap.accent,
      tokens: snap.tokens,
      packId: snap.packId,
    };
  },
  subscribe: (listener: () => void) => {
    // 主题 store 变化时通知插件重渲染
    return useThemeStore.subscribe((state) => {
      void state;
      listener();
    });
  },
  setMode: (mode: 'light' | 'dark') => useThemeStore.getState().setMode(mode),
  setAccent: (hex: string) => useThemeStore.getState().setAccent(hex),
  applyThemePack: (id: string) => useThemeStore.getState().applyThemePack(id),
};

/** 统一的插件 AI 适配器 */
function createPluginAI(): PluginAI {
  return {
    get available() {
      const { api, backendOnline } = useAppStore.getState();
      if (api.mode === 'backend') return backendOnline;
      return getLocalAiState().status === 'ready';
    },
    get mode() {
      const { api } = useAppStore.getState();
      return api.mode === 'backend' ? 'backend' : 'local';
    },
    async chat(request) {
      const { api, lan } = useAppStore.getState();
      const token = useAuthStore.getState().token;
      const text = await aiChat(
        { mode: api.mode, lan, token },
        request.messages.map((m) => ({ role: m.role, content: m.content })),
        { maxTokens: request.maxTokens, temperature: request.temperature },
      );
      return { text, model: api.mode === 'backend' ? api.model : '本地模型' };
    },
  };
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  kernel: null,
  modules: [],
  installed: [],
  downloading: null,
  booted: false,
  loading: true,
  importing: null,
  error: null,

  /** 启动内核：加载预装插件并恢复用户安装状态 */
  boot: async () => {
    if (get().booted) return;
    set({ loading: true, error: null });

    const kernel = createPluginKernel({
      ai: createPluginAI(),
      theme: themeBridge,
      get backendOnline() {
        return useAppStore.getState().backendOnline;
      },
      notify: (message, type) => useAppStore.getState().notify(message, type),
      requireBackend: () => {
        useAppStore.getState().notify('后端服务未开启，请启动后端服务后再使用该功能', 'error');
      },
      openCard: (id) => useAppStore.getState().openCard(id),
    });

    try {
      const modules = await kernel.boot();

      // 恢复用户安装状态（IndexedDB 持久化）
      const saved = await idbGet<string[]>(INSTALLED_KEY);
      const builtinIds = modules
        .filter((m) => m.manifest.builtin)
        .map((m) => m.manifest.id);

      if (Array.isArray(saved)) {
        for (const id of saved) {
          try {
            await kernel.load(id);
          } catch {
            /* 插件可能已不存在，忽略 */
          }
        }
      }

      const installed = kernel.registry.listInstalled().map((m) => m.manifest.id);
      set({
        kernel,
        modules,
        installed: Array.from(new Set([...builtinIds, ...installed])),
        booted: true,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        booted: true,
        error: err instanceof Error ? err.message : '插件内核启动失败',
      });
    }
  },

  /** 安装插件 */
  install: async (id) => {
    const { kernel } = get();
    if (!kernel) return;
    try {
      await kernel.load(id);
      const module = kernel.registry.get(id);
      if (module?.onInstall) {
        await module.onInstall(kernel.createContext(id));
      }
      const installed = kernel.registry.listInstalled().map((m) => m.manifest.id);
      set({ installed, error: null });
      await idbSet(INSTALLED_KEY, installed);
      useAppStore.getState().notify('插件已安装', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '插件安装失败';
      set({ error: msg });
      useAppStore.getState().notify(msg, 'error');
    }
  },

  /**
   * 从后端仓库下载插件包。
   *
   * 流程：后端取包 → 校验兼容性 → 缓存到 IndexedDB → 注册启用。
   * 缓存后即使后端离线，该插件仍可继续使用。
   */
  downloadFromRegistry: async (id) => {
    const { kernel } = get();
    if (!kernel) return;
    const { lan } = useAppStore.getState();
    const token = readLocal<string | null>('zj-token', null);
    if (!token) {
      useAppStore.getState().notify('请先登录后再下载插件', 'error');
      return;
    }

    set({ downloading: id, error: null });
    try {
      const { fetchRegistryPlugin } = await import('@/lib/backend/registry');
      const { cachePluginPackage } = await import('@/lib/registry-cache');

      const pkg = await fetchRegistryPlugin(lan, token, id);

      // 缓存到本地（供离线使用）
      await cachePluginPackage(id, pkg);

      // 走内核的包导入流程，校验版本与兼容性
      const result = await kernel.importPackage(JSON.stringify(pkg));
      if (!result.ok) {
        set({ error: result.error, downloading: null });
        useAppStore.getState().notify(result.error, 'error');
        return;
      }

      const module = result.value;
      kernel.registry.register(module, { replace: true, installed: true });
      if (module.onInstall) {
        await module.onInstall(kernel.createContext(module.manifest.id));
      }

      const installed = kernel.registry.listInstalled().map((m) => m.manifest.id);
      set({
        modules: kernel.registry.list(),
        installed,
        downloading: null,
        error: null,
      });
      await idbSet(INSTALLED_KEY, installed);
      useAppStore
        .getState()
        .notify(`插件「${module.manifest.name}」已下载，可在离线状态下使用`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '插件下载失败';
      set({ error: msg, downloading: null });
      useAppStore.getState().notify(msg, 'error');
    }
  },

  /** 上传已安装插件的包到后端仓库（管理员） */
  uploadToRegistry: async (id) => {
    const { lan } = useAppStore.getState();
    const token = readLocal<string | null>('zj-token', null);
    if (!token) {
      useAppStore.getState().notify('请先登录后再上传插件', 'error');
      return;
    }
    try {
      const { uploadRegistryPlugin } = await import('@/lib/backend/registry');
      const { readCachedPluginPackage } = await import('@/lib/registry-cache');
      const { createPluginPackage } = await import('@/plugins/packager');

      const module = get().modules.find((m) => m.manifest.id === id);
      if (!module) {
        useAppStore.getState().notify('插件不存在，无法上传', 'error');
        return;
      }

      // 优先上传本地缓存的原始包，保持与下载源一致
      const cached = await readCachedPluginPackage(id);
      const pkg = cached ?? createPluginPackage(module.manifest);

      await uploadRegistryPlugin(lan, token, pkg);
      useAppStore
        .getState()
        .notify(`插件「${module.manifest.name}」已上传到广场`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '插件上传失败';
      set({ error: msg });
      useAppStore.getState().notify(msg, 'error');
    }
  },

  /** 卸载插件 */
  uninstall: async (id) => {
    const { kernel } = get();
    if (!kernel) return;
    try {
      await kernel.uninstall(id);
      const installed = kernel.registry.listInstalled().map((m) => m.manifest.id);
      set({ installed, error: null });
      await idbSet(INSTALLED_KEY, installed);
      useAppStore.getState().notify('插件已卸载', 'info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '插件卸载失败';
      set({ error: msg });
      useAppStore.getState().notify(msg, 'error');
    }
  },

  /** 导入 .plugin 包 */
  importPackageFile: async (file) => {
    const { kernel } = get();
    if (!kernel) return;
    set({ importing: file.name, error: null });
    try {
      const text = await file.text();
      const result = await kernel.importPackage(text);
      if (!result.ok) {
        set({ error: result.error });
        useAppStore.getState().notify(result.error, 'error');
        return;
      }
      const module = result.value;
      kernel.registry.register(module, { replace: true, installed: true });
      const installed = kernel.registry.listInstalled().map((m) => m.manifest.id);
      set({
        modules: kernel.registry.list(),
        installed,
        error: null,
      });
      await idbSet(INSTALLED_KEY, installed);
      useAppStore.getState().notify(`插件「${module.manifest.name}」导入成功`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '插件包解析失败';
      set({ error: msg });
      useAppStore.getState().notify(msg, 'error');
    } finally {
      set({ importing: null });
    }
  },

  /** 导出插件包为 .plugin 文件 */
  exportPackage: async (id) => {
    const { kernel } = get();
    if (!kernel) return;
    const module = kernel.registry.get(id);
    if (!module) {
      useAppStore.getState().notify('插件未安装，无法导出', 'error');
      return;
    }
    try {
      const { createPluginPackage, downloadPluginPackage } = await import(
        '@/plugins/packager'
      );
      const pkg = createPluginPackage(module.manifest);
      downloadPluginPackage(pkg);
      useAppStore.getState().notify('插件包已导出', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '插件导出失败';
      set({ error: msg });
      useAppStore.getState().notify(msg, 'error');
    }
  },

  isInstalled: (id) => get().installed.includes(id),

  getModule: (id) => get().modules.find((m) => m.manifest.id === id),

  createContext: (id) => {
    const { kernel } = get();
    if (!kernel) return null;
    return kernel.createContext(id);
  },

  setError: (msg) => set({ error: msg }),
}));

/** 便捷：按分类分组插件清单 */
export function groupByCategory(modules: PluginModule[]): Map<string, PluginModule[]> {
  const map = new Map<string, PluginModule[]>();
  for (const m of modules) {
    const cat = m.manifest.category || '其它';
    const list = map.get(cat) ?? [];
    list.push(m);
    map.set(cat, list);
  }
  return map;
}

export type { PluginManifest };

/**
 * 智简匣 · 插件上下文工厂
 *
 * 内核通过本文件把「能力」注入插件：
 * - 存储：命名空间隔离的 localStorage 包装，插件之间互不串数据
 * - 主题：只读快照 + 三个写入口（setMode / setAccent / applyThemePack），实际写入由内核完成
 * - AI：统一调度器（前端本地 Transformers.js 或后端转发）
 *
 * 插件拿到的永远是 PluginContext，**不会**直接接触全局 zustand store。
 */

import { THEME_PACKS } from './theme-packs';
import type {
  PluginAI,
  PluginContext,
  PluginNotifyType,
  PluginStorage,
  PluginThemeState,
  ThemeMode,
  ThemePack,
} from './types';

/** 存储键前缀 */
const STORAGE_PREFIX = 'zhijianxia:plugin:';
/** 跨插件共享存储前缀 */
const SHARED_PREFIX = 'zhijianxia:shared:';
/** 插件可用的共享键前缀（调用方写 'shared:xxx'） */
const SHARED_KEY = 'shared:';

/* -------------------------------------------------------------------------- */
/* 存储                                                                        */
/* -------------------------------------------------------------------------- */

/** 同一页面内共享的键监听表：让不同插件能监听同一个共享键 */
const keyListeners = new Map<string, Set<(value: unknown) => void>>();

/** 广播某个物理键的变化 */
function broadcast(physicalKey: string, value: unknown): void {
  const listeners = keyListeners.get(physicalKey);
  if (!listeners) return;
  for (const listener of Array.from(listeners)) {
    try {
      listener(value);
    } catch (error) {
      console.error('[插件存储] 监听器执行失败：', error);
    }
  }
}

/** localStorage 访问的安全封装（SSR / 隐私模式下降级为内存存储） */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 内存存储降级方案 */
const memoryStore = new Map<string, string>();

function readRaw(key: string): string | null {
  const store = safeStorage();
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      /* 落到内存 */
    }
  }
  return memoryStore.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  const store = safeStorage();
  if (store) {
    try {
      store.setItem(key, value);
      return;
    } catch {
      /* 落到内存 */
    }
  }
  memoryStore.set(key, value);
}

function removeRaw(key: string): void {
  const store = safeStorage();
  if (store) {
    try {
      store.removeItem(key);
    } catch {
      /* 忽略 */
    }
  }
  memoryStore.delete(key);
}

function keysRaw(prefix: string): string[] {
  const store = safeStorage();
  const result: string[] = [];
  if (store) {
    try {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && key.startsWith(prefix)) result.push(key);
      }
    } catch {
      /* 忽略 */
    }
  }
  memoryStore.forEach((_v, key) => {
    if (key.startsWith(prefix) && !result.includes(key)) result.push(key);
  });
  return result;
}

/**
 * 创建插件私有存储。
 * @param pluginId 插件 id，用于命名空间隔离
 */
export function createPluginStorage(pluginId: string): PluginStorage {
  const namespace = `${STORAGE_PREFIX}${pluginId}:`;

  /** 把逻辑键转换为物理键，shared: 前缀的键进入公共命名空间 */
  const physical = (key: string): string =>
    key.startsWith(SHARED_KEY)
      ? `${SHARED_PREFIX}${key.slice(SHARED_KEY.length)}`
      : `${namespace}${key}`;

  /** 物理键反推逻辑键（用于遍历时过滤） */
  const isShared = (physicalKey: string): boolean => physicalKey.startsWith(SHARED_PREFIX);

  const storage: PluginStorage = {
    namespace,
    sharedPrefix: SHARED_KEY,

    get<T>(key: string, fallback: T): T {
      const raw = readRaw(physical(key));
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    },

    set<T>(key: string, value: T): void {
      const physicalKey = physical(key);
      writeRaw(physicalKey, JSON.stringify(value));
      broadcast(physicalKey, value);
    },

    remove(key: string): void {
      const physicalKey = physical(key);
      removeRaw(physicalKey);
      broadcast(physicalKey, undefined);
    },

    keys(): string[] {
      const own = keysRaw(namespace)
        .filter((k) => !isShared(k))
        .map((k) => k.slice(namespace.length));
      return own.sort();
    },

    clear(): void {
      for (const key of storage.keys()) {
        storage.remove(key);
      }
    },

    subscribe<T = unknown>(key: string, listener: (value: T | undefined) => void): () => void {
      const physicalKey = physical(key);
      let set = keyListeners.get(physicalKey);
      if (!set) {
        set = new Set();
        keyListeners.set(physicalKey, set);
      }
      const wrapped = listener as (value: unknown) => void;
      set.add(wrapped);
      return () => {
        set?.delete(wrapped);
        if (set && set.size === 0) keyListeners.delete(physicalKey);
      };
    },
  };

  return storage;
}

/* -------------------------------------------------------------------------- */
/* 主题                                                                        */
/* -------------------------------------------------------------------------- */

/** 主题桥接接口：主框架（src/lib/theme）实现，内核据此读写主题 */
export interface ThemeBridge {
  /** 读取当前主题快照 */
  getSnapshot(): {
    mode: ThemeMode;
    accent: string;
    tokens: Record<string, string>;
    packId: string | null;
  };
  /** 订阅主题变化 */
  subscribe(listener: () => void): () => void;
  /** 切换明暗模式 */
  setMode(mode: ThemeMode): void;
  /** 设置主色调 */
  setAccent(hex: string): void;
  /** 套用主题包 */
  applyThemePack(id: string): void;
}

/** 主题包清单（由主题包定义模块提供，主框架可覆盖） */
export function getThemePacks(): ThemePack[] {
  return THEME_PACKS.map((pack) => ({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    mode: pack.mode,
    accent: pack.accent,
    tokens: pack.tokens,
  }));
}

/**
 * 依据桥接构造主题快照对象。
 * mode / accent / tokens / packId 使用 getter 实时读取，
 * 插件在主题变化触发重渲染后即可读到最新值。
 */
export function createThemeState(bridge: ThemeBridge): PluginThemeState {
  return {
    get mode() {
      return bridge.getSnapshot().mode;
    },
    get accent() {
      return bridge.getSnapshot().accent;
    },
    get tokens() {
      return bridge.getSnapshot().tokens;
    },
    get packId() {
      return bridge.getSnapshot().packId;
    },
    packs: getThemePacks(),
    subscribe: (listener) => bridge.subscribe(listener),
  };
}

/* -------------------------------------------------------------------------- */
/* 上下文                                                                      */
/* -------------------------------------------------------------------------- */

/** 创建插件上下文所需的参数 */
export interface PluginContextInit {
  /** 插件 id，用于存储命名空间 */
  pluginId: string;
  /** AI 调度器 */
  ai: PluginAI;
  /** 主题桥接 */
  theme: ThemeBridge;
  /** 后端是否在线 */
  backendOnline: boolean;
  /** 全局通知 */
  notify: (message: string, type?: PluginNotifyType) => void;
  /** 依赖后端时的提示回调 */
  requireBackend: () => void;
  /** 打开其它卡片 */
  openCard: (id: string) => void;
  /** 存储实现覆盖（默认 localStorage 命名空间隔离） */
  storage?: PluginStorage;
}

/**
 * 创建插件上下文。
 * 这是插件接触全局能力的唯一入口。
 */
export function createPluginContext(init: PluginContextInit): PluginContext {
  const storage = init.storage ?? createPluginStorage(init.pluginId);

  return {
    ai: init.ai,
    storage,
    theme: createThemeState(init.theme),
    backendOnline: init.backendOnline,
    notify: init.notify,
    requireBackend: init.requireBackend,
    openCard: init.openCard,
    setMode: (mode) => init.theme.setMode(mode),
    setAccent: (hex) => init.theme.setAccent(hex),
    applyThemePack: (id) => init.theme.applyThemePack(id),
  };
}

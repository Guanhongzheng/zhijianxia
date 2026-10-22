/**
 * 智简匣 · 插件内核 —— 核心类型定义
 *
 * 设计约束（务必保持）：
 * 1. 插件与内核完全解耦：内核不引用任何具体插件，插件只依赖本文件定义的结构契约。
 * 2. 插件不直接 import 全局 zustand store，所有能力通过注入的 PluginContext 获取。
 * 3. 任何写操作（主题、卡片、通知）都必须走 ctx 上显式暴露的方法，便于内核统一审计。
 * 4. 本文件只允许出现「类型」与「常量」，不得引入任何运行时依赖。
 */

import type React from 'react';

/* -------------------------------------------------------------------------- */
/* 清单与标识                                                                  */
/* -------------------------------------------------------------------------- */

/** 插件唯一标识，必须是 kebab-case */
export type PluginId = string;

/** 插件清单：描述插件身份、版本与兼容性 */
export interface PluginManifest {
  /** 全局唯一，kebab-case */
  id: PluginId;
  name: string;
  /** semver */
  version: string;
  description: string;
  /** 分类标签，用于广场筛选 */
  category: string;
  author?: string;
  /** lucide 图标名 */
  icon?: string;
  /** 预览缩略图（emoji / dataURL / 主题色块标识） */
  preview?: string;
  tags?: string[];
  /** 最低内核兼容版本，导入时校验 */
  minCoreVersion?: string;
  /** 是否预装 */
  builtin?: boolean;
  /** 是否纯本地（不依赖后端） */
  offline?: boolean;
}

/* -------------------------------------------------------------------------- */
/* 主题                                                                        */
/* -------------------------------------------------------------------------- */

/** 主题模式 */
export type ThemeMode = 'light' | 'dark';

/** 内置主题包 */
export interface ThemePack {
  id: string;
  name: string;
  description?: string;
  mode: ThemeMode;
  /** 主色（十六进制） */
  accent: string;
  /** 附加设计 token */
  tokens?: Record<string, string>;
}

/**
 * 主题只读快照。
 * 主题变化时内核会整体替换该对象（新的引用），插件据此触发重渲染。
 */
export interface PluginThemeState {
  readonly mode: ThemeMode;
  readonly accent: string;
  readonly tokens: Readonly<Record<string, string>>;
  /** 内核提供的主题包清单 */
  readonly packs: readonly ThemePack[];
  /** 当前生效的主题包 id（未套用主题包时为 null） */
  readonly packId: string | null;
  /** 订阅主题变化，返回取消订阅函数 */
  subscribe(listener: () => void): () => void;
}

/* -------------------------------------------------------------------------- */
/* 存储                                                                        */
/* -------------------------------------------------------------------------- */

/** 底层 KV 存储契约（同步读写，localStorage 语义） */
export interface PluginStore {
  get<T = unknown>(key: string, fallback: T): T;
  set<T = unknown>(key: string, value: T): void;
  remove(key: string): void;
  keys(): string[];
  clear(): void;
  /**
   * 监听某个 key 的变化。
   * 以 `shared:` 开头的 key 属于跨插件共享命名空间，可用于插件间联动。
   */
  subscribe<T = unknown>(key: string, listener: (value: T | undefined) => void): () => void;
}

/** 插件私有存储：命名空间隔离，插件之间互不干扰 */
export interface PluginStorage extends PluginStore {
  /** 当前插件的存储命名空间 */
  readonly namespace: string;
  /** 跨插件共享 key 的前缀 */
  readonly sharedPrefix: string;
}

/* -------------------------------------------------------------------------- */
/* AI 能力                                                                     */
/* -------------------------------------------------------------------------- */

/** 消息角色 */
export type PluginAIMessageRole = 'system' | 'user' | 'assistant';

/** 单条对话消息 */
export interface PluginAIMessage {
  role: PluginAIMessageRole;
  content: string;
}

/** AI 调用参数 */
export interface PluginAIRequest {
  messages: PluginAIMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 是否请求流式输出 */
  stream?: boolean;
  signal?: AbortSignal;
}

/** AI 返回结果 */
export interface PluginAIResponse {
  /** 模型输出的纯文本 */
  text: string;
  model?: string;
  finishReason?: 'stop' | 'length' | 'error';
}

/** AI 调度器：前端本地 Transformers.js 或后端转发由内核决定 */
export interface PluginAI {
  /** 当前是否可用（模型未加载完成时为 false） */
  readonly available: boolean;
  /**
   * 不可用的原因（可用时为空串）。
   *
   * 插件应据此提示用户「去做什么」，而不是只显示「AI 不可用」——
   * 常见原因只有几种：模型未加载、后端未启动、未登录。
   */
  readonly unavailableReason?: string;
  /** 当前推理通道 */
  readonly mode: 'local' | 'backend' | 'offline';
  /** 一次性对话 */
  chat(request: PluginAIRequest): Promise<PluginAIResponse>;
  /** 可选的流式对话，逐段 yield 增量文本 */
  streamChat?(request: PluginAIRequest): AsyncIterable<string>;
}

/* -------------------------------------------------------------------------- */
/* 插件能力与上下文                                                            */
/* -------------------------------------------------------------------------- */

/** 通知类型 */
export type PluginNotifyType = 'info' | 'success' | 'error';

/**
 * 插件可调用的全局能力。
 * PluginContext 继承本接口，因此 ctx.notify / ctx.openCard / ctx.setMode 等均可直接使用。
 */
export interface PluginApi {
  /** 弹出全局通知 */
  notify(message: string, type?: PluginNotifyType): void;
  /** 声明依赖后端能力，内核负责弹提示 */
  requireBackend(): void;
  /** 打开内核注册的其它卡片 */
  openCard(id: string): void;
  /** 切换亮/暗模式（写入口，仅主题中心类插件应调用） */
  setMode(mode: ThemeMode): void;
  /** 设置全局主色调（写入口） */
  setAccent(hex: string): void;
  /** 套用内核内置主题包（写入口） */
  applyThemePack(id: string): void;
}

/**
 * 插件上下文：内核在渲染插件时注入。
 * 插件只能通过它访问 AI、存储、主题与通知，**禁止**直接 import 全局 store。
 */
export interface PluginContext extends PluginApi {
  /** 统一 AI 调度 */
  ai: PluginAI;
  /** 插件私有 KV（命名空间隔离） */
  storage: PluginStorage;
  /** 主题只读快照 */
  theme: PluginThemeState;
  /** 后端是否在线 */
  backendOnline: boolean;
}

/* -------------------------------------------------------------------------- */
/* 插件模块                                                                    */
/* -------------------------------------------------------------------------- */

/** 插件卡片组件的 props */
export interface PluginComponentProps {
  ctx: PluginContext;
}

/** 插件模块：内核加载插件后得到的统一结构 */
export interface PluginModule {
  manifest: PluginManifest;
  /** 插件卡片 UI */
  Component: React.ComponentType<PluginComponentProps>;
  /** 安装钩子（注册 / 初始化本地数据） */
  onInstall?: (ctx: PluginContext) => void | Promise<void>;
  /** 卸载钩子（清理本地数据） */
  onUninstall?: (ctx: PluginContext) => void | Promise<void>;
}

/** 插件模块加载器：按需动态导入插件 */
export type PluginModuleLoader = () => Promise<PluginModule>;

/** 动态导入得到的模块命名空间（允许 default / plugin 两种导出形态） */
export type PluginModuleNamespace = PluginModule & {
  default?: PluginModule;
  plugin?: PluginModule;
};

/* -------------------------------------------------------------------------- */
/* 插件包（.plugin）                                                            */
/* -------------------------------------------------------------------------- */

/** 插件包格式标识 */
export const PLUGIN_FORMAT = 'zhijianxia.plugin';

/** 插件包格式版本 */
export const PLUGIN_FORMAT_VERSION = 1;

/** 插件包内联的代码入口 */
export interface PluginPackageEntry {
  /** 入口类型：esm 走 blob 动态 import，cjs 走 Function 沙箱，url 走远程 import */
  kind: 'esm' | 'cjs' | 'url';
  /** 源码（kind 为 esm / cjs 时） */
  source?: string;
  /** 远程地址（kind 为 url 时） */
  url?: string;
  /** 原始文件名，便于展示 */
  file?: string;
}

/** 插件包 */
export interface PluginPackage {
  format: typeof PLUGIN_FORMAT;
  formatVersion: number;
  manifest: PluginManifest;
  /** 内核兼容性声明 */
  core: {
    minVersion: string;
  };
  /** 可选：内联代码入口 */
  entry?: PluginPackageEntry;
  /** 可选：随包携带的静态资源 */
  assets?: Record<string, string>;
  exportedAt?: string;
}

/** 统一的校验 / 导入结果 */
export type PluginPackageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

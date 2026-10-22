'use client';

/**
 * plugin-runtime.ts —— 第三方插件的运行时 SDK
 *
 * ## 为什么需要它
 *
 * 插件包（.plugin）里的代码以 **Blob URL + 动态 import()** 的方式执行。
 * 这条路径有一个硬性限制：**无法解析裸模块导入**。
 *
 * ```js
 * // ❌ 在 Blob 模块里这样写会失败：浏览器不知道 'react' 指向哪个文件
 * import { useState } from 'react';
 *
 * // ❌ 也不行：路径相对于 blob: URL，解析不到真实文件
 * import { Button } from '@/components/ui/button';
 * ```
 *
 * 这意味着第三方开发者若想写插件，就必须先搭一套 Vite/webpack 工程、
 * 把 React 与宿主 UI 一起打进产物 —— 门槛极高，且产物体积巨大。
 *
 * 本模块的做法是**由宿主预先把依赖挂到全局**，插件代码从全局取用：
 *
 * ```js
 * // ✅ 第三方插件这样写即可，无需任何构建步骤
 * const { useState, Button, Card } = globalThis.ZJ;
 * ```
 *
 * 这与主题包的做法是同一个思路：
 * **宿主提供能力，插件只声明用法；不要求插件了解宿主内部结构。**
 *
 * ## 安全边界
 *
 * 这是「本地优先」应用：插件代码本来就以完全信任的方式在用户自己的
 * 浏览器里执行（与 Electron 的 preload 权限模型一致）。
 * 运行时不做沙箱隔离 —— 那属于伪安全（拦得住 import，拦不住 fetch）。
 * 真正的约束在**导入时的包校验**（见 packager.ts）：
 * manifest 合法性、语义化版本、内核兼容性、代码入口类型。
 */

import * as React from 'react';
import { createElement } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { runAi, runAiStream, isBlank, cx, formatRelativeTime } from './utils';
import { useAiTask, useStoredState, useInterval, usePluginTheme } from './hooks';
import type { PluginContext, PluginManifest } from './types';

/** lucide-react 全量导出（第三方插件通常需要图标） */
import * as Icons from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* JSX 工厂                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * JSX 工厂函数。
 *
 * 第三方插件可以直接写 JSX 而无需在文件头声明 pragma：
 * 宿主已在加载前把它挂到全局，TS/JSX 编译器会优先读取全局设置。
 */
export const h = createElement;

/**
 * 片段别名（React 的 Fragment）。
 * 插件写 `ZJ.Fragment` 比 import React 更直观。
 */
export const Fragment = React.Fragment;

/* -------------------------------------------------------------------------- */
/* hooks                                                                       */
/* -------------------------------------------------------------------------- */

export const {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useReducer,
  useContext,
  createContext,
  memo,
  useLayoutEffect,
  useId,
} = React;

/* -------------------------------------------------------------------------- */
/* 样式工具                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * className 合并。
 * 用法：`className={ZJ.cx('text-sm', cond && 'font-bold')}`
 */
export { cx };

/* -------------------------------------------------------------------------- */
/* 运行时对象                                                                  */
/* -------------------------------------------------------------------------- */

/** 全局 SDK 的类型（插件里 `globalThis.ZJ` 的形状） */
export interface PluginRuntimeSdk {
  /* ---- JSX 与 React ---- */
  h: typeof createElement;
  Fragment: typeof React.Fragment;
  useState: typeof React.useState;
  useEffect: typeof React.useEffect;
  useMemo: typeof React.useMemo;
  useCallback: typeof React.useCallback;
  useRef: typeof React.useRef;
  useReducer: typeof React.useReducer;
  useContext: typeof React.useContext;
  createContext: typeof React.createContext;
  useLayoutEffect: typeof React.useLayoutEffect;
  useId: typeof React.useId;
  memo: typeof React.memo;

  /* ---- 工具 ---- */
  cx: typeof cx;
  isBlank: typeof isBlank;
  formatRelativeTime: typeof formatRelativeTime;

  /* ---- 插件专用 hooks ---- */
  useAiTask: typeof useAiTask;
  useStoredState: typeof useStoredState;
  useInterval: typeof useInterval;
  usePluginTheme: typeof usePluginTheme;

  /* ---- AI ---- */
  runAi: typeof runAi;
  runAiStream: typeof runAiStream;

  /* ---- UI 组件 ---- */
  Button: typeof Button;
  Input: typeof Input;
  Textarea: typeof Textarea;
  Card: typeof Card;
  CardHeader: typeof CardHeader;
  CardTitle: typeof CardTitle;
  CardContent: typeof CardContent;
  Badge: typeof Badge;
  Switch: typeof Switch;
  Slider: typeof Slider;
  Progress: typeof Progress;
  Label: typeof Label;
  Separator: typeof Separator;
  Skeleton: typeof Skeleton;
  Tabs: typeof Tabs;
  TabsList: typeof TabsList;
  TabsTrigger: typeof TabsTrigger;
  TabsContent: typeof TabsContent;
  Dialog: typeof Dialog;
  DialogContent: typeof DialogContent;
  DialogHeader: typeof DialogHeader;
  DialogTitle: typeof DialogTitle;
  DialogDescription: typeof DialogDescription;
  DialogFooter: typeof DialogFooter;
  DropdownMenu: typeof DropdownMenu;
  DropdownMenuTrigger: typeof DropdownMenuTrigger;
  DropdownMenuContent: typeof DropdownMenuContent;
  DropdownMenuItem: typeof DropdownMenuItem;
  Select: typeof Select;
  SelectTrigger: typeof SelectTrigger;
  SelectValue: typeof SelectValue;
  SelectContent: typeof SelectContent;
  SelectItem: typeof SelectItem;
  Tooltip: typeof Tooltip;
  TooltipProvider: typeof TooltipProvider;
  TooltipTrigger: typeof TooltipTrigger;
  TooltipContent: typeof TooltipContent;

  /* ---- 图标 ---- */
  icons: typeof Icons;
  /** 图标的简写访问：`ZJ.icon.Sparkles` 等价于 `ZJ.icons.Sparkles` */
  icon: typeof Icons;

  /** 宿主设计 token 变量名，插件写内联样式时用 */
  tokens: Record<string, string>;
  /** 内核版本，用于插件做特性检测 */
  coreVersion: string;
  /** 当前插件的上下文（由内核在渲染时注入） */
  __ctx?: PluginContext;
}

/**
 * 宿主设计 token。
 * 插件**应当**使用这些变量而不是硬编码颜色 —— 这样插件会自动跟随主题变化。
 */
const TOKENS: Record<string, string> = {
  accent: 'var(--zj-accent)',
  'accent-fg': 'var(--zj-accent-fg)',
  'accent-soft': 'var(--zj-accent-soft)',
  bg: 'var(--zj-bg)',
  fg: 'var(--zj-fg)',
  'muted-fg': 'var(--zj-muted-fg)',
  card: 'var(--zj-card)',
  border: 'var(--zj-border)',
  muted: 'var(--zj-muted)',
  shadow: 'var(--zj-shadow)',
  radius: 'var(--zj-radius)',
  danger: 'var(--zj-danger)',
};

/** 组装 SDK 对象 */
function buildSdk(coreVersion: string): PluginRuntimeSdk {
  return {
    h,
    Fragment,
    useState,
    useEffect,
    useMemo,
    useCallback,
    useRef,
    useReducer,
    useContext,
    createContext,
    useLayoutEffect,
    useId,
    memo,

    cx,
    isBlank,
    formatRelativeTime,

    useAiTask,
    useStoredState,
    useInterval,
    usePluginTheme,

    runAi,
    runAiStream,

    Button,
    Input,
    Textarea,
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    Badge,
    Switch,
    Slider,
    Progress,
    Label,
    Separator,
    Skeleton,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Tooltip,
    TooltipProvider,
    TooltipTrigger,
    TooltipContent,

    icons: Icons,
    icon: Icons,

    tokens: TOKENS,
    coreVersion,
  };
}

let installed = false;

/**
 * 把 SDK 挂到 `globalThis.ZJ`。
 *
 * 必须在**加载任何第三方插件之前**调用 —— 插件代码执行时会同步读取它。
 * 重复调用是安全的（幂等）。
 *
 * @param coreVersion 宿主内核版本，写进 SDK 供插件做特性检测
 */
export function installPluginRuntime(coreVersion: string): void {
  if (installed && typeof globalThis !== 'undefined' && (globalThis as { ZJ?: unknown }).ZJ) {
    return;
  }
  if (typeof globalThis === 'undefined') return;
  (globalThis as { ZJ?: PluginRuntimeSdk }).ZJ = buildSdk(coreVersion);
  installed = true;
}

/**
 * 读取当前插件上下文。
 * 插件内 `const ctx = ZJ.useCtx()` 即可拿到（内核在渲染时注入）。
 */
export function useCtx(): PluginContext {
  const sdk = (globalThis as { ZJ?: PluginRuntimeSdk }).ZJ;
  if (!sdk?.__ctx) {
    throw new Error('插件上下文尚未注入：请确保组件由插件内核渲染（props.ctx 已传入）');
  }
  return sdk.__ctx;
}

/** 内部：内核在创建上下文时调用，刷新 SDK 上的 __ctx */
export function setRuntimeContext(ctx: PluginContext): void {
  const sdk = (globalThis as { ZJ?: PluginRuntimeSdk }).ZJ;
  if (sdk) sdk.__ctx = ctx;
}

/** 内部：组件渲染时同步 __ctx，供 useCtx() 读取 */
export function PluginRuntimeProvider({ ctx, children }: { ctx: PluginContext; children: React.ReactNode }) {
  setRuntimeContext(ctx);
  return createElement(React.Fragment, null, children);
}

/** 导出类型供第三方开发者参考 */
export type { PluginManifest };
/**
 * 智简匣 · 插件通用 React Hooks
 *
 * 这些 Hook 只依赖 PluginContext，不依赖任何全局 store，
 * 因此插件可以独立于主框架渲染与测试。
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginContext, PluginThemeState } from './types';

/**
 * 订阅主题变化。
 * 主题变化时组件自动重渲染，返回的快照始终是最新值。
 */
export function usePluginTheme(ctx: PluginContext): PluginThemeState {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    // 主题桥接可能是动态替换的，这里只订阅快照自身的 subscribe
    const unsubscribe = ctx.theme.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, [ctx]);

  return ctx.theme;
}

/** AI 任务状态 */
export interface AiTaskState {
  /** 是否正在生成 */
  loading: boolean;
  /** 生成结果文本 */
  result: string;
  /** 错误信息 */
  error: string | null;
}

/**
 * 通用的 AI 任务执行器。
 * 负责 loading / result / error 三态，插件只需关心渲染。
 */
export function useAiTask() {
  const [state, setState] = useState<AiTaskState>({ loading: false, result: '', error: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * 执行一次 AI 任务。
   * @param task 返回文本的任务函数
   */
  const run = useCallback(async (task: () => Promise<string>): Promise<string | null> => {
    setState({ loading: true, result: '', error: null });
    try {
      const text = await task();
      if (mounted.current) {
        setState({ loading: false, result: text, error: null });
      }
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 调用失败，请稍后再试';
      if (mounted.current) {
        setState({ loading: false, result: '', error: message });
      }
      return null;
    }
  }, []);

  /** 重置任务状态 */
  const reset = useCallback(() => {
    setState({ loading: false, result: '', error: null });
  }, []);

  return { ...state, run, reset, setResult: (result: string) => setState({ loading: false, result, error: null }) };
}

/**
 * 与插件存储绑定的状态。
 * 写入时自动持久化到 ctx.storage。
 */
export function useStoredState<T>(
  ctx: PluginContext,
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => ctx.storage.get<T>(key, initial));

  const update = useCallback(
    (next: T) => {
      setValue(next);
      ctx.storage.set(key, next);
    },
    [ctx, key],
  );

  return [value, update];
}

/**
 * 创建一个随组件卸载自动清理的定时器句柄。
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return undefined;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

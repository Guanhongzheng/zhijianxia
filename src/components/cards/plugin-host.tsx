'use client';

import { useMemo } from 'react';
import type { PluginContext } from '@/plugins';
import { usePluginStore } from '@/store/plugin-store';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * 插件宿主：创建插件上下文并渲染插件组件。
 * 插件通过 ctx 访问 AI / 存储 / 主题，不直接接触全局 store。
 *
 * 插件模块是动态 import 的，加载期间统一显示骨架屏。
 */
export function PluginHost({ pluginId }: { pluginId: string }) {
  const module = usePluginStore((s) => s.modules.find((m) => m.manifest.id === pluginId));
  const kernel = usePluginStore((s) => s.kernel);

  const ctx = useMemo<PluginContext | null>(() => {
    if (!kernel) return null;
    return kernel.createContext(pluginId);
  }, [kernel, pluginId]);

  if (!module || !ctx) {
    return <PluginSkeleton />;
  }

  const Component = module.Component;
  return <Component ctx={ctx} />;
}

/** 插件加载中的骨架屏 */
function PluginSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-32 w-full rounded-[var(--zj-radius)]" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import type { PluginContext } from '@/plugins';
import { usePluginStore } from '@/store/plugin-store';

/**
 * 插件宿主：创建插件上下文并渲染插件组件。
 * 插件通过 ctx 访问 AI / 存储 / 主题，不直接接触全局 store。
 */
export function PluginHost({ pluginId }: { pluginId: string }) {
  const module = usePluginStore((s) => s.modules.find((m) => m.manifest.id === pluginId));
  const kernel = usePluginStore((s) => s.kernel);

  const ctx = useMemo<PluginContext | null>(() => {
    if (!kernel) return null;
    return kernel.createContext(pluginId);
  }, [kernel, pluginId]);

  if (!module || !ctx) {
    return (
      <div className="space-y-3 py-4">
        <div className="zj-skeleton h-4 w-1/3" />
        <div className="zj-skeleton h-24 w-full rounded-[var(--zj-radius)]" />
        <div className="zj-skeleton h-3 w-2/3" />
      </div>
    );
  }

  const Component = module.Component;
  return <Component ctx={ctx} />;
}

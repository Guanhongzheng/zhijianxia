'use client';

import { motion } from 'framer-motion';
import { Boxes, Package, Play, Store } from 'lucide-react';
import { usePluginStore } from '@/store/plugin-store';
import { useAppStore } from '@/store/app-store';

/**
 * 启动插件磁贴 —— 承载全部已安装插件，点击条目直接启动。
 * 顶部为磁贴图标区，下方为插件列表，底部为「笨蛋广场」式入口。
 */
export function LauncherTile() {
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);
  const loading = usePluginStore((s) => s.loading);
  const openCard = useAppStore((s) => s.openCard);

  const installedModules = modules.filter((m) => installed.includes(m.manifest.id));

  return (
    <div className="zj-tile flex min-h-56 h-full flex-col overflow-hidden text-white">
      {/* 磁贴标题 */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
        <Boxes className="size-4 shrink-0" strokeWidth={1.9} />
        <span className="text-sm font-medium">启动插件</span>
        <span className="text-[11px] opacity-80">
          {loading ? '' : `${installedModules.length} 个`}
        </span>
        <button
          type="button"
          onClick={() => openCard('marketplace')}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-75"
        >
          <Store className="size-3" />
          插件广场
        </button>
      </div>

      {/* 插件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {loading ? (
          <div className="space-y-1.5 py-1">
            <div className="h-11 animate-pulse rounded bg-white/20" />
            <div className="h-11 animate-pulse rounded bg-white/15" />
            <div className="h-11 animate-pulse rounded bg-white/10" />
          </div>
        ) : installedModules.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 py-8 text-center">
            <Package className="size-6 opacity-80" />
            <p className="text-sm opacity-90">还没有安装插件</p>
            <p className="text-[11px] opacity-75">去插件广场挑选需要的插件</p>
          </div>
        ) : (
          <div className="space-y-1">
            {installedModules.map((module, idx) => (
              <motion.button
                key={module.manifest.id}
                type="button"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(idx * 0.03, 0.2),
                  ease: [0.16, 1, 0.3, 1],
                }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openCard(`plugin:${module.manifest.id}`)}
                className="group flex w-full items-center gap-2.5 rounded bg-white/12 p-2 text-left transition-colors hover:bg-white/22"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded bg-white/15 text-base">
                  {module.manifest.preview ?? '🧩'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {module.manifest.name}
                  </span>
                  <span className="block truncate text-[10px] opacity-75">
                    {module.manifest.category} · v{module.manifest.version}
                  </span>
                </span>
                <Play className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-80" />
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

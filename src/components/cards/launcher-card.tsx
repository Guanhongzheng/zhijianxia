'use client';

import { motion } from 'framer-motion';
import { Boxes, Package, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePluginStore } from '@/store/plugin-store';
import { useAppStore } from '@/store/app-store';

/**
 * 启动插件卡片 —— 承载全部已安装插件。
 * 所有插件集中在这张卡片内，点击任意插件直接启动对应功能。
 */
export function LauncherCard() {
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);
  const loading = usePluginStore((s) => s.loading);
  const openCard = useAppStore((s) => s.openCard);

  const installedModules = modules.filter((m) => installed.includes(m.manifest.id));

  return (
    <div className="zj-card flex h-full min-h-0 flex-col overflow-hidden">
      {/* 卡片头 */}
      <div className="flex items-center gap-3 border-b border-[var(--zj-border)] px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          <Boxes className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">启动插件</p>
          <p className="truncate text-[11px] text-[var(--zj-muted-fg)]">
            {loading
              ? '正在加载…'
              : `已安装 ${installedModules.length} 个插件，点击直接启动`}
          </p>
        </div>
        <Button2 />
      </div>

      {/* 插件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-md" />
            ))}
          </div>
        ) : installedModules.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <Package className="size-5 text-[var(--zj-muted-fg)]" />
            <p className="text-sm text-[var(--zj-muted-fg)]">还没有安装插件</p>
            <p className="text-xs text-[var(--zj-muted-fg)]">
              打开功能广场挑选需要的插件
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
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
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => openCard(`plugin:${module.manifest.id}`)}
                className="flex w-full items-center gap-3 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-[var(--zj-border)] hover:bg-[var(--zj-muted)]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-base">
                  {module.manifest.preview ?? '🧩'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {module.manifest.name}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--zj-muted-fg)]">
                    {module.manifest.category} · v{module.manifest.version}
                  </span>
                </span>
                <Play className="size-3.5 shrink-0 text-[var(--zj-muted-fg)]" />
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 卡片头右侧的「功能广场」入口 */
function Button2() {
  const openCard = useAppStore((s) => s.openCard);
  return (
    <button
      type="button"
      onClick={() => openCard('marketplace')}
      className="shrink-0 text-xs text-[var(--zj-accent)] transition-opacity hover:opacity-70"
    >
      功能广场
    </button>
  );
}

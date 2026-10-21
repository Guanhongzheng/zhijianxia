'use client';

import { motion } from 'framer-motion';
import { Package, Play, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';
import { usePluginStore } from '@/store/plugin-store';
import { cn } from '@/lib/utils';

/**
 * 我的插件卡片 —— 展示已安装插件，点击直接**全屏启动**。
 *
 * 加载期间统一使用骨架屏（不显示转圈）。
 */
export function InstalledPluginsCard() {
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);
  const loading = usePluginStore((s) => s.loading);
  const openCard = useAppStore((s) => s.openCard);

  const installedModules = modules.filter((m) => installed.includes(m.manifest.id));

  return (
    <div className="zj-card flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--zj-border)] px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          <Package className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">我的插件</p>
          <p className="truncate text-[0.75rem] text-[var(--zj-muted-fg)]">
            点击插件卡片即可全屏启动
          </p>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <Badge variant="outline" className="text-[0.6875rem]">
            已装 {installedModules.length}
          </Badge>
        )}
      </div>

      <div className="p-3">
        {loading ? (
          /* 加载中：骨架屏 */
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-[var(--zj-border)] p-3"
              >
                <Skeleton className="size-9 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-2.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : installedModules.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
            <Package className="size-5 text-[var(--zj-muted-fg)]" />
            <p className="text-sm text-[var(--zj-muted-fg)]">还没有安装插件</p>
            <button
              type="button"
              onClick={() => openCard('marketplace')}
              className="flex items-center gap-1.5 text-xs text-[var(--zj-accent)] transition-opacity hover:opacity-70"
            >
              <Store className="size-3" />
              去功能广场看看
            </button>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {installedModules.map((m) => (
              <motion.button
                key={m.manifest.id}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => openCard(`plugin:${m.manifest.id}`)}
                className="flex items-center gap-3 rounded-md border border-[var(--zj-border)] p-3 text-left transition-colors hover:border-[var(--zj-accent)]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-lg">
                  {m.manifest.preview ?? '🧩'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {m.manifest.name}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-[var(--zj-muted-fg)]">
                    {m.manifest.category} · v{m.manifest.version}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-md',
                    'bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]',
                  )}
                  aria-hidden
                >
                  <Play className="size-3.5" />
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

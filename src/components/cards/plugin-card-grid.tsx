'use client';

import { motion } from 'framer-motion';
import { Package } from 'lucide-react';
import type { PluginModule } from '@/plugins';
import { SkeletonCard } from '@/components/ui/skeleton';
import { usePluginStore } from '@/store/plugin-store';
import { useAppStore } from '@/store/app-store';

/** 已安装插件的卡片网格 */
export function PluginCardGrid({
  modules,
  loading = false,
  emptyHint = '暂无插件',
}: {
  modules: PluginModule[];
  loading?: boolean;
  emptyHint?: string;
}) {
  const openCard = useAppStore((s) => s.openCard);
  const notify = useAppStore((s) => s.notify);

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (modules.length === 0) {
    return (
      <div className="zj-card flex flex-col items-center gap-2 px-5 py-8 text-center">
        <Package className="size-5 text-[var(--zj-muted-fg)]" />
        <p className="text-sm text-[var(--zj-muted-fg)]">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map((module, idx) => {
        const { manifest } = module;
        return (
          <motion.button
            type="button"
            key={manifest.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.22,
              delay: Math.min(idx * 0.04, 0.24),
              ease: [0.16, 1, 0.3, 1],
            }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => openCard(`plugin:${manifest.id}`)}
            className="zj-card flex flex-col items-start gap-2.5 p-4 text-left transition-colors hover:border-[var(--zj-accent)]"
          >
            <div className="flex w-full items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--zj-accent-soft)] text-lg">
                {manifest.preview ?? '🧩'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{manifest.name}</p>
                <p className="truncate text-[11px] text-[var(--zj-muted-fg)]">
                  v{manifest.version} · {manifest.category}
                </p>
              </div>
            </div>
            <p className="line-clamp-2 text-xs leading-relaxed text-[var(--zj-muted-fg)]">
              {manifest.description}
            </p>
          </motion.button>
        );
      })}
    </div>
  );
}

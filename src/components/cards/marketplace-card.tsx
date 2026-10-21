'use client';

import { motion } from 'framer-motion';
import { Package, Palette, Search, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePluginStore } from '@/store/plugin-store';
import { useAppStore } from '@/store/app-store';
import { useThemeStore } from '@/store/theme-store';
import { cn } from '@/lib/utils';

/**
 * 功能广场卡片 —— 展示插件安装概况与快捷入口。
 * 点击卡片任意位置打开功能广场。
 */
export function MarketplaceCard({ className }: { className?: string }) {
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);
  const loading = usePluginStore((s) => s.loading);
  const openCard = useAppStore((s) => s.openCard);
  const themeCount = useThemeStore((s) => s.packs.filter((p) => !p.builtin).length);

  const installedCount = installed.length;
  const total = modules.length;

  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => openCard('marketplace')}
      className={cn(
        'zj-card flex h-full flex-col items-start gap-3 p-5 text-left transition-colors hover:border-[var(--zj-accent)]',
        className,
      )}
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          <Package className="size-4" />
        </div>
        {loading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <Badge variant="outline" className="text-[0.6875rem]">
            已装 {installedCount} / {total}
          </Badge>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">功能广场</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--zj-muted-fg)]">
          搜索、筛选、安装与卸载插件，也可下载主题包
        </p>
      </div>

      {/* 快捷入口 */}
      <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-[var(--zj-border)] pt-2.5">
        <span className="flex items-center gap-1 text-[0.75rem] text-[var(--zj-muted-fg)]">
          <Search className="size-3" />
          搜索
        </span>
        <span className="text-[0.75rem] text-[var(--zj-muted-fg)]">·</span>
        <span className="flex items-center gap-1 text-[0.75rem] text-[var(--zj-muted-fg)]">
          <Palette className="size-3" />
          主题 {themeCount}
        </span>
        <span className="text-[0.75rem] text-[var(--zj-muted-fg)]">·</span>
        <span className="flex items-center gap-1 text-[0.75rem] text-[var(--zj-muted-fg)]">
          <Store className="size-3" />
          导入导出
        </span>
      </div>
    </motion.button>
  );
}

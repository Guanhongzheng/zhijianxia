'use client';

import { motion } from 'framer-motion';
import { Boxes, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { useThemeStore, useThemeBrand } from '@/store/theme-store';

/**
 * 顶部导航栏 —— 左侧品牌区，右侧状态与操作。
 * 视觉保持扁平卡片风格：白底、1px 边框、极轻阴影、统一圆角。
 *
 * 品牌区的图标、名称与副标题可由主题包覆盖（brand 段）。
 */
export function TopBar({
  title,
  subtitle,
  icon: Icon = Boxes,
  /** 是否用主题包的品牌名覆盖标题（应用首页用 true，页面标题用 false） */
  preferBrandName = false,
}: {
  title: string;
  subtitle: string;
  icon?: typeof Boxes;
  preferBrandName?: boolean;
}) {
  const backendOnline = useAppStore((s) => s.backendOnline);
  const checking = useAppStore((s) => s.checking);
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const brand = useThemeBrand();
  const showIcon = useThemeStore((s) => {
    const packs = s.packs;
    const pack = packs.find((p) => p.id === s.activePackId) ?? packs[0];
    return pack?.nav?.showIcon !== false;
  });

  // 主题包品牌优先（仅首页）；其余页面保留自身标题
  const displayTitle = preferBrandName && brand.name ? brand.name : title;
  const displaySubtitle = preferBrandName && brand.tagline ? brand.tagline : subtitle;
  /** 品牌图标是 http(s) 图片时按图片渲染，否则按 emoji / 字符渲染 */
  const brandIcon = brand.icon ?? '';
  const isImageIcon = /^https?:\/\//i.test(brandIcon);

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="zj-card zj-nav flex w-full shrink-0 items-center gap-3 px-4 py-3 sm:px-5"
    >
      {/* 品牌区 */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          {!showIcon ? null : isImageIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandIcon} alt="" className="size-6 object-contain" />
          ) : brandIcon ? (
            <span className="text-base leading-none">{brandIcon}</span>
          ) : (
            <Icon className="size-4" strokeWidth={1.9} />
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[1rem] leading-tight font-semibold">
            {displayTitle}
          </h1>
          <p className="truncate text-[0.75rem] leading-tight text-[var(--zj-muted-fg)]">
            {displaySubtitle}
          </p>
        </div>
      </div>

      {/* 右侧状态与操作 */}
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={backendOnline ? 'success' : 'outline'}>
          <span className="flex items-center gap-1">
            {backendOnline ? (
              <Wifi className="size-3" />
            ) : (
              <WifiOff className="size-3" />
            )}
            {checking ? '检测中…' : backendOnline ? '后端在线' : '后端未启动'}
          </span>
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleMode}
          aria-label="切换亮暗模式"
          title={`当前：${mode === 'dark' ? '暗色' : '亮色'}模式`}
        >
          {mode === 'dark' ? '☀' : '☾'}
        </Button>
      </div>
    </motion.header>
  );
}

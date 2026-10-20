'use client';

import { motion } from 'framer-motion';
import { Boxes, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { useThemeStore } from '@/store/theme-store';

/**
 * 顶部导航栏 —— 左侧品牌区，右侧状态与操作。
 * 视觉保持扁平卡片风格：白底、1px 边框、极轻阴影、统一圆角。
 */
export function TopBar({
  title,
  subtitle,
  icon: Icon = Boxes,
}: {
  title: string;
  subtitle: string;
  icon?: typeof Boxes;
}) {
  const backendOnline = useAppStore((s) => s.backendOnline);
  const checking = useAppStore((s) => s.checking);
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="zj-card flex w-full shrink-0 items-center gap-3 px-4 py-3 sm:px-5"
    >
      {/* 品牌区 */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          <Icon className="size-4" strokeWidth={1.9} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] leading-tight font-semibold">
            {title}
          </h1>
          <p className="truncate text-[11px] leading-tight text-[var(--zj-muted-fg)]">
            {subtitle}
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

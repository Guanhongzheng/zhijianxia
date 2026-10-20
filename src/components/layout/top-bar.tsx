'use client';

import { motion } from 'framer-motion';
import { Boxes, Menu } from 'lucide-react';

/**
 * 顶部条 —— 实色横栏，左侧标题与副标题。
 * 对应启动器首页的「开始」头部。
 */
export function TopBar({
  title,
  subtitle,
  onMenu,
  icon: Icon = Boxes,
}: {
  title: string;
  subtitle: string;
  onMenu?: () => void;
  icon?: typeof Boxes;
}) {
  return (
    <div className="zj-bar flex h-16 shrink-0 items-center gap-3 px-3 text-white sm:h-[4.5rem] sm:px-4">
      {/* 图标 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 sm:size-11"
      >
        <Icon className="size-5 sm:size-6" strokeWidth={1.8} />
      </motion.div>

      {/* 标题 */}
      <div className="min-w-0 flex-1">
        <motion.h1
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="truncate text-lg leading-tight font-semibold sm:text-xl"
        >
          {title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="truncate text-[11px] leading-tight opacity-85 sm:text-xs"
        >
          {subtitle}
        </motion.p>
      </div>

      {/* 菜单按钮 */}
      {onMenu && (
        <button
          type="button"
          onClick={onMenu}
          aria-label="菜单"
          className="flex size-9 shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80 sm:size-10"
        >
          <Menu className="size-5 sm:size-6" />
        </button>
      )}
    </div>
  );
}

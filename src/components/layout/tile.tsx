'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

/**
 * 启动器风格磁贴组件。
 * 视觉语言：直角色块 + 白色图标 + 悬停变色，无边框无圆角。
 */
export function Tile({
  icon: Icon,
  label,
  sublabel,
  onClick,
  variant = 'default',
  className = '',
  size = 'md',
}: {
  icon?: LucideIcon;
  label?: string;
  sublabel?: string;
  onClick?: () => void;
  /** default=蓝磁贴，news=红磁贴，go=绿磁贴，plain=透明 */
  variant?: 'default' | 'news' | 'go' | 'plain';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const variantClass =
    variant === 'news'
      ? 'zj-tile zj-tile-news'
      : variant === 'go'
        ? 'zj-tile zj-tile-go'
        : variant === 'plain'
          ? ''
          : 'zj-tile';

  const iconSize =
    size === 'lg' ? 'size-11' : size === 'sm' ? 'size-5' : 'size-7';

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className={`${variantClass} group flex w-full flex-col items-center justify-center gap-1.5 p-3 text-center text-white ${className}`}
    >
      {Icon && (
        <Icon className={`${iconSize} shrink-0`} strokeWidth={1.8} />
      )}
      {label && (
        <span
          className={`leading-tight ${
            size === 'sm' ? 'text-[10px]' : 'text-xs'
          } opacity-95`}
        >
          {label}
        </span>
      )}
      {sublabel && (
        <span className="text-[10px] leading-tight opacity-70">
          {sublabel}
        </span>
      )}
    </motion.button>
  );
}

/** 磁贴区块容器：控制磁贴之间的间隙 */
export function TileGrid({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid gap-1.5 ${className}`}>{children}</div>
  );
}

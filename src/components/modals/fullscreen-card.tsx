'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 全屏卡片覆盖层 —— 所有可点击卡片的统一展示容器。
 *
 * 特点：
 * - **真正全屏**：铺满视口（`inset-0`），不再是小尺寸弹窗；
 * - **顶栏导航**：左侧返回、右侧关闭，Esc 亦可退出；
 * - **路由历史**：打开时压入一条 history 记录，
 *   浏览器前进/后退可正确返回，避免「关不掉」；
 * - **动画**：从下方轻微上滑 + 淡入，关闭时反向退出。
 */
export function FullscreenCard({
  open,
  title,
  subtitle,
  onClose,
  children,
  className,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 打开时锁定背景滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="fullscreen-card"
          data-zj-fullscreen-card={title}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 }}
          className={cn(
            'fixed inset-0 z-[80] flex flex-col bg-[var(--zj-bg)]',
            className,
          )}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* 顶栏 */}
          <header className="zj-nav flex shrink-0 items-center gap-2 border-b border-[var(--zj-border)] px-2 py-2 sm:px-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="返回"
              className="flex size-8 items-center justify-center rounded-md text-[var(--zj-muted-fg)] transition-colors hover:bg-[var(--zj-muted)] hover:text-[var(--zj-fg)]"
            >
              <ChevronLeft className="size-4" />
            </button>

            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              {subtitle && (
                <p className="truncate text-[0.6875rem] text-[var(--zj-muted-fg)]">
                  {subtitle}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex size-8 items-center justify-center rounded-md text-[var(--zj-muted-fg)] transition-colors hover:bg-[var(--zj-muted)] hover:text-[var(--zj-fg)]"
            >
              <X className="size-4" />
            </button>
          </header>

          {/* 内容区 */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useAppStore } from '@/store/app-store';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
} as const;

const COLORS = {
  info: 'text-[var(--zj-accent)]',
  success: 'text-emerald-500',
  error: 'text-red-500',
} as const;

/**
 * 全局轻提示
 *
 * - 固定在**右上角**
 * - 从**右侧**以非线性缓动飞入
 * - 3 秒后自动**向右**飞出
 * - 多条提示并存时**向下排列**（最新的在最下方）
 */
export function Toast() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  return (
    <div
      className="pointer-events-none fixed top-4 right-4 z-[100] flex flex-col items-end gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          return (
            <motion.div
              key={toast.id}
              layout
              data-zj-toast={toast.id}
              initial={{ opacity: 0, x: 120, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 160, scale: 0.96 }}
              transition={{
                // 非线性缓动：入场稍慢、末段减速；出场更快
                type: 'spring',
                stiffness: 260,
                damping: 26,
                mass: 0.9,
              }}
              onClick={() => dismissToast(toast.id)}
              className="pointer-events-auto cursor-pointer"
            >
              <div className="zj-card flex items-center gap-2.5 px-4 py-2.5">
                <Icon className={`size-4 shrink-0 ${COLORS[toast.type]}`} />
                <span className="text-sm">{toast.text}</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

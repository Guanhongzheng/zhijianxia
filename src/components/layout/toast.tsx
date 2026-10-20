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

/** 全局轻提示 */
export function Toast() {
  const toast = useAppStore((s) => s.toast);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2"
          role="status"
        >
          <div className="zj-card flex items-center gap-2.5 px-4 py-2.5">
            {(() => {
              const Icon = ICONS[toast.type];
              return <Icon className={`size-4 shrink-0 ${COLORS[toast.type]}`} />;
            })()}
            <span className="text-sm">{toast.text}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

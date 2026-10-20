'use client';

import type { ReactNode } from 'react';

/** 卡片组容器：全站统一的分组标题 + 内容布局 */
export function GroupSection({
  title,
  description,
  icon,
  action,
  children,
  requiresBackend = false,
  isAdmin = false,
  onAdminAction,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  requiresBackend?: boolean;
  isAdmin?: boolean;
  onAdminAction?: () => void;
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
              {icon}
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && (
              <p className="text-xs text-[var(--zj-muted-fg)]">{description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && onAdminAction && (
            <button
              type="button"
              onClick={onAdminAction}
              className="text-xs text-[var(--zj-accent)] transition-opacity hover:opacity-70"
            >
              管理
            </button>
          )}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

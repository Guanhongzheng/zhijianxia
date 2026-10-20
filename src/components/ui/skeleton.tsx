import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * 全站统一骨架屏基础组件。
 * 所有异步加载场景必须复用本组件，禁止使用转圈 loading。
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('zj-skeleton', className)} {...props} />;
}

/** 骨架屏 - 文本行 */
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

/** 骨架屏 - 卡片 */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('zj-card p-5', className)}>
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

/** 骨架屏 - 列表项 */
function SkeletonList({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border border-[var(--zj-border)] p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 骨架屏 - 消息条目（聊天气泡） */
function SkeletonMessage({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3', className)}>
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-7 w-2/5 rounded-lg" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

/** 骨架屏 - 公告条目 */
function SkeletonNotice({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-md border border-[var(--zj-border)] p-4', className)}>
      <Skeleton className="mb-3 h-4 w-1/3" />
      <SkeletonText lines={2} />
      <Skeleton className="mt-3 h-2.5 w-24" />
    </div>
  );
}

/** 骨架屏 - 详情面板 */
function SkeletonDetail({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <SkeletonText lines={4} />
    </div>
  );
}

/** 骨架屏 - 网格（插件广场等） */
function SkeletonGrid({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonList,
  SkeletonMessage,
  SkeletonNotice,
  SkeletonDetail,
  SkeletonGrid,
};

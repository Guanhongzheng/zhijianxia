'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Megaphone,
  MessageSquare,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { ensureBackend } from '@/components/modals/backend-gate';
import { AnnouncementsCard } from '@/components/cards/announcements-card';
import { MarketplaceCard } from '@/components/cards/marketplace-card';
import { TopBar } from '@/components/layout/top-bar';

/**
 * 第 2 页：功能卡片汇总页
 * 扁平卡片风格，卡片按内容自适应高度并保留留白。
 */
export function DashboardPage({ active }: { active: boolean }) {
  const backendOnline = useAppStore((s) => s.backendOnline);
  const openCard = useAppStore((s) => s.openCard);
  const logged = useAuthStore((s) => s.logged);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  useEffect(() => {
    if (active && backendOnline) {
      void useAppStore.getState().loadNotices();
    }
  }, [active, backendOnline]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 顶部导航栏 */}
      <div className="shrink-0 px-2 pt-2 sm:px-3 sm:pt-3">
        <TopBar
          title="初来乍到"
          subtitle="欢迎来到智简匣，一切功能都在这里"
          icon={Sparkles}
        />
      </div>

      {/* 卡片区：按内容自适应高度，不强制铺满 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-3">
        {/* 公告卡片 */}
        <div className="lg:col-span-2">
          <CardShell
            icon={<Megaphone className="size-4" />}
            title="公告"
            desc="更新日志与新增功能公告"
            action={
              isAdmin ? (
                <button
                  type="button"
                  onClick={() => openCard('announcements')}
                  className="text-xs text-[var(--zj-accent)] transition-opacity hover:opacity-70"
                >
                  管理
                </button>
              ) : null
            }
          >
            <AnnouncementsCard />
          </CardShell>
        </div>

        {/* 功能广场卡片（原启动插件位置） */}
        <MarketplaceCard />

        {/* 好友卡片 */}
        <EntryCard
          icon={<Users className="size-4" />}
          title="好友"
          desc="通过 UID 搜索并添加好友"
          requiresBackend
          logged={logged}
          onClick={async () => {
            const ok = await ensureBackend('好友');
            if (ok) openCard('friends');
          }}
        />

        {/* 群聊卡片 */}
        <EntryCard
          icon={<MessageSquare className="size-4" />}
          title="群聊"
          desc="创建群组，实时收发消息"
          requiresBackend
          logged={logged}
          onClick={async () => {
            const ok = await ensureBackend('群聊');
            if (ok) openCard('groups');
          }}
        />

        {/* 系统设置卡片 */}
        <EntryCard
          icon={<Settings className="size-4" />}
          title="系统设置"
          desc="AI 引擎、局域网连接与通用设置"
          onClick={() => openCard('settings')}
        />
        </div>
      </div>
    </div>
  );
}

/** 带标题栏的卡片外壳 */
function CardShell({
  icon,
  title,
  desc,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="zj-card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--zj-border)] px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="truncate text-[0.75rem] text-[var(--zj-muted-fg)]">{desc}</p>
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/** 功能入口卡片 */
function EntryCard({
  icon,
  title,
  desc,
  onClick,
  requiresBackend = false,
  logged = true,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  requiresBackend?: boolean;
  logged?: boolean;
}) {
  const backendOnline = useAppStore((s) => s.backendOnline);
  const offline = requiresBackend && (!backendOnline || !logged);

  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className="zj-card flex flex-col items-start gap-2.5 p-5 text-left transition-colors hover:border-[var(--zj-accent)]"
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          {icon}
        </div>
        {offline && (
          <Badge variant="warning" className="text-[0.6875rem]">
            需后端
          </Badge>
        )}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--zj-muted-fg)]">
          {desc}
        </p>
      </div>
    </motion.button>
  );
}

'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Megaphone,
  MessageSquare,
  Package,
  Settings,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { usePluginStore } from '@/store/plugin-store';
import { useThemeStore } from '@/store/theme-store';
import { ensureBackend } from '@/components/modals/backend-gate';
import { AnnouncementsCard } from '@/components/cards/announcements-card';
import { PluginCardGrid } from '@/components/cards/plugin-card-grid';
import { GroupSection } from '@/components/layout/group-section';

/** 第 2 页：功能卡片汇总页 */
export function DashboardPage({ active }: { active: boolean }) {
  const backendOnline = useAppStore((s) => s.backendOnline);
  const checking = useAppStore((s) => s.checking);
  const openCard = useAppStore((s) => s.openCard);
  const logged = useAuthStore((s) => s.logged);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);
  const pluginsLoading = usePluginStore((s) => s.loading);
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  // 进入本页时，若后端在线则加载公告
  useEffect(() => {
    if (active && backendOnline) {
      void useAppStore.getState().loadNotices();
    }
  }, [active, backendOnline]);

  const installedModules = modules.filter((m) => installed.includes(m.manifest.id));

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      {/* 页头 */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">功能汇总</h2>
          <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
            全部功能以卡片形式呈现，插件化扩展，无需跳转页面
          </p>
        </div>

        <div className="flex items-center gap-2">
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
      </header>

      {/* 公告卡片组 —— 放在靠前位置 */}
      <GroupSection
        title="公告"
        icon={<Megaphone className="size-4" />}
        description="更新日志与新增功能公告"
        requiresBackend
        isAdmin={isAdmin}
        onAdminAction={() => openCard('announcements')}
      >
        <AnnouncementsCard />
      </GroupSection>

      {/* 已安装插件卡片组 */}
      <GroupSection
        title="我的插件"
        icon={<Package className="size-4" />}
        description={`已安装 ${installedModules.length} 个插件`}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => openCard('marketplace')}
          >
            打开功能广场
          </Button>
        }
      >
        <PluginCardGrid
          modules={installedModules}
          loading={pluginsLoading}
          emptyHint="还没有安装插件，去功能广场挑选几个吧"
        />
      </GroupSection>

      <Separator className="my-7" />

      {/* 社交与设置入口 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <EntryCard
          icon={<Package className="size-4" />}
          title="功能广场"
          desc="搜索、筛选、安装与卸载插件"
          onClick={() => openCard('marketplace')}
        />
        <EntryCard
          icon={<Settings className="size-4" />}
          title="系统设置"
          desc="AI 引擎、局域网连接与通用设置"
          onClick={() => openCard('settings')}
        />
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-8 text-center text-xs text-[var(--zj-muted-fg)]"
      >
        智简匣 · 纯本地功能无需后端即可使用
      </motion.p>
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
      className="zj-card flex flex-col items-start gap-2.5 p-4 text-left transition-colors hover:border-[var(--zj-accent)]"
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          {icon}
        </div>
        {offline && <Badge variant="warning">需后端</Badge>}
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

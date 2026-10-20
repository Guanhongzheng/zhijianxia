'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Boxes,
  MessageSquare,
  Package,
  Settings,
  Users,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { ensureBackend } from '@/components/modals/backend-gate';
import { AnnouncementsTile } from '@/components/cards/announcements-tile';
import { LauncherTile } from '@/components/cards/launcher-tile';
import { TopBar } from '@/components/layout/top-bar';
import { Tile } from '@/components/layout/tile';

/**
 * 第 2 页：功能磁贴页
 * 启动器风格：顶部条 + 磁贴网格。
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
      {/* 顶部条 */}
      <TopBar
        title="初来乍到"
        subtitle="点击下面的磁贴以使用更多 智简匣 精彩功能"
        icon={Boxes}
      />

      {/* 磁贴区 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 sm:p-4">
        <div className="grid min-h-full gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* 左列：小功能磁贴组 + 设置磁贴 */}
          <div className="flex min-h-0 flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-1.5">
              <Tile
                icon={Users}
                label="好友"
                size="sm"
                onClick={async () => {
                  const ok = await ensureBackend('好友');
                  if (ok) openCard('friends');
                }}
              />
              <Tile
                icon={MessageSquare}
                label="群聊"
                size="sm"
                onClick={async () => {
                  const ok = await ensureBackend('群聊');
                  if (ok) openCard('groups');
                }}
              />
              <Tile
                icon={Package}
                label="功能广场"
                size="sm"
                onClick={() => openCard('marketplace')}
              />
              <Tile
                icon={Settings}
                label="系统设置"
                size="sm"
                onClick={() => openCard('settings')}
              />
            </div>

            {/* 设置磁贴（大块） */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => openCard('settings')}
              className="zj-tile flex min-h-28 flex-1 flex-col items-center justify-center gap-2 p-4 text-white"
            >
              <Settings className="size-9" strokeWidth={1.7} />
              <span className="text-sm font-medium">本体设置</span>
              <span className="text-[11px] opacity-85">
                AI 引擎 · 局域网连接 · 通用设置
              </span>
            </motion.button>
          </div>

          {/* 中列：公告磁贴（红色资讯块） */}
          <AnnouncementsTile isAdmin={isAdmin} />

          {/* 右列：启动插件磁贴 */}
          <LauncherTile />
        </div>
      </div>
    </div>
  );
}

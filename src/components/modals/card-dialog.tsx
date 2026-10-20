'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAppStore } from '@/store/app-store';
import { usePluginStore } from '@/store/plugin-store';
import { useThemeStore } from '@/store/theme-store';
import { PluginHost } from '@/components/cards/plugin-host';
import { MarketplacePanel } from '@/components/cards/marketplace-panel';
import { SettingsPanel } from '@/components/cards/settings-panel';
import { FriendsPanel } from '@/components/cards/friends-panel';
import { GroupsPanel } from '@/components/cards/groups-panel';
import { AnnouncementsCard } from '@/components/cards/announcements-card';

/**
 * 卡片弹窗宿主：根据 activeCard 渲染对应内容。
 * 插件卡片通过 `plugin:<id>` 路由。
 */
export function CardDialog() {
  const activeCard = useAppStore((s) => s.activeCard);
  const openCard = useAppStore((s) => s.openCard);
  const mode = useThemeStore((s) => s.mode);

  const pluginId = useMemo(
    () => (activeCard?.startsWith('plugin:') ? activeCard.slice(7) : null),
    [activeCard],
  );

  const module = usePluginStore((s) =>
    pluginId ? s.modules.find((m) => m.manifest.id === pluginId) : undefined,
  );

  // 主题切换时让插件内容重渲染
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    return useThemeStore.subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  const title = (() => {
    switch (activeCard) {
      case 'marketplace':
        return '功能广场';
      case 'settings':
        return '系统设置';
      case 'friends':
        return '好友';
      case 'groups':
        return '群聊';
      case 'announcements':
        return '公告管理';
      default:
        return module?.manifest.name ?? '功能卡片';
    }
  })();

  const open = activeCard !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && openCard(null)}>
      <DialogContent
        className={
          activeCard === 'marketplace'
            ? 'max-w-3xl'
            : activeCard === 'settings'
              ? 'max-w-2xl'
              : 'max-w-xl'
        }
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        <motion.div
          key={activeCard}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeCard === 'marketplace' && <MarketplacePanel />}
          {activeCard === 'settings' && <SettingsPanel />}
          {activeCard === 'friends' && <FriendsPanel />}
          {activeCard === 'groups' && <GroupsPanel />}
          {activeCard === 'announcements' && (
            <div className="space-y-3">
              <AnnouncementsCard />
            </div>
          )}
          {pluginId && module && <PluginHost pluginId={pluginId} />}
          {pluginId && !module && (
            <p className="py-8 text-center text-sm text-[var(--zj-muted-fg)]">
              该插件未安装或已被卸载
            </p>
          )}
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

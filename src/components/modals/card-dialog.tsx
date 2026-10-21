'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/app-store';
import { usePluginStore } from '@/store/plugin-store';
import { useThemeStore } from '@/store/theme-store';
import { FullscreenCard } from '@/components/modals/fullscreen-card';
import { PluginHost } from '@/components/cards/plugin-host';
import { MarketplacePanel } from '@/components/cards/marketplace-panel';
import { SettingsPanel } from '@/components/cards/settings-panel';
import { FriendsPanel } from '@/components/cards/friends-panel';
import { GroupsPanel } from '@/components/cards/groups-panel';
import { AnnouncementsCard } from '@/components/cards/announcements-card';
import { AiChatPanel } from '@/components/ai/ai-chat-panel';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * 卡片全屏宿主：根据 activeCard 渲染对应内容。
 * 所有卡片（功能广场、系统设置、好友、群聊、公告与插件）统一以全屏方式展示。
 * 插件卡片通过 `plugin:<id>` 路由。
 */
export function CardDialog() {
  const activeCard = useAppStore((s) => s.activeCard);
  const openCard = useAppStore((s) => s.openCard);

  const pluginId = useMemo(
    () => (activeCard?.startsWith('plugin:') ? activeCard.slice(7) : null),
    [activeCard],
  );

  const allModules = usePluginStore((s) => s.modules);

  /**
   * 插件路由解析。
   *
   * 插件之间可以互相唤起（如番茄钟 → 音乐播放器），
   * 此时传入的是裸插件 id 而非 `plugin:<id>`，
   * 需要按已安装插件清单补全前缀，否则会渲染出空白页。
   */
  const resolvedPluginId = useMemo(() => {
    if (pluginId) return pluginId;
    if (!activeCard) return null;
    // 固定卡片 id 不走插件路由
    const STATIC_CARDS = [
      'marketplace',
      'settings',
      'friends',
      'groups',
      'announcements',
      'ai-chat',
    ];
    if (STATIC_CARDS.includes(activeCard)) return null;
    // 裸 id 命中某个已安装插件时，按插件卡片处理
    return allModules.some((m) => m.manifest.id === activeCard)
      ? activeCard
      : null;
  }, [pluginId, activeCard, allModules]);

  const module = usePluginStore((s) =>
    resolvedPluginId
      ? s.modules.find((m) => m.manifest.id === resolvedPluginId)
      : undefined,
  );

  // 插件内核尚未启动完成时，先显示骨架屏而非空白
  const kernelLoading = usePluginStore((s) => s.loading);

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
      case 'ai-chat':
        return 'AI 对话';
      default:
        return module?.manifest.name ?? '功能卡片';
    }
  })();

  const subtitle = (() => {
    switch (activeCard) {
      case 'marketplace':
        return '安装插件、下载主题包';
      case 'settings':
        return 'AI 引擎、个性化、局域网与 API';
      case 'friends':
        return '通过 UID 搜索并添加好友';
      case 'groups':
        return '创建群组，实时收发消息';
      case 'announcements':
        return '更新日志与新增功能公告';
      case 'ai-chat':
        return 'Vercel AI SDK 驱动的流式对话、工具调用与生成式界面';
      default:
        return module?.manifest.description;
    }
  })();

  const open = activeCard !== null;

  return (
    <FullscreenCard
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={() => openCard(null)}
    >
      <motion.div
        key={activeCard}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-5"
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
        {/* AI 对话：整卡片高度铺满，让消息区吃掉多余空间 */}
        {activeCard === 'ai-chat' && (
          <div className="h-[calc(100vh-13rem)] min-h-[420px]">
            <AiChatPanel className="h-full" />
          </div>
        )}
        {resolvedPluginId && kernelLoading && <PluginBootSkeleton />}
        {resolvedPluginId && !kernelLoading && module && (
          <PluginHost pluginId={resolvedPluginId} />
        )}
        {resolvedPluginId && !kernelLoading && !module && (
          <p className="py-8 text-center text-sm text-[var(--zj-muted-fg)]">
            该插件未安装或已被卸载
          </p>
        )}      </motion.div>
    </FullscreenCard>
  );
}

/** 插件内核启动期间的骨架屏 */
function PluginBootSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-32 w-full rounded-[var(--zj-radius)]" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

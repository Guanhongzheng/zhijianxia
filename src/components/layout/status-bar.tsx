'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Boxes, Check, CircleDot, LogIn, Play, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { usePluginStore } from '@/store/plugin-store';
import { avatarColor, cn } from '@/lib/utils';

/**
 * 底部导航栏 —— 左侧头像与问候语，右侧状态图标与主行动入口。
 * 结构参照启动器底栏：问候在左，状态与主行动在右。
 */
export function StatusBar({ page }: { page: 1 | 2 }) {
  const logged = useAuthStore((s) => s.logged);
  const user = useAuthStore((s) => s.user);
  const openLogin = useAuthStore((s) => s.openLogin);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const checkBackend = useAppStore((s) => s.checkBackend);
  const openCard = useAppStore((s) => s.openCard);
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);

  const installedModules = modules.filter((m) => installed.includes(m.manifest.id));
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  /**
   * 当前选中的插件 id —— 切换器只负责「选择」，
   * 真正启动由右下角「启动插件」主行动触发。
   */
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

  // 选中的插件若被卸载，则回落到第一个可用插件
  const selectedPlugin =
    installedModules.find((m) => m.manifest.id === selectedPluginId) ??
    installedModules[0] ??
    null;
  const firstPlugin = installedModules[0];

  // 点击外部或按 Esc 关闭插件切换器
  useEffect(() => {
    if (!switcherOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!switcherRef.current?.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [switcherOpen]);

  // 第 1 页主行动为登录，第 2 页为启动插件
  const primary = page === 1
    ? {
        label: logged ? '个人资料' : '登录',
        hint: logged ? '查看与修改资料' : '解锁好友与群聊',
        icon: LogIn,
        onClick: () => {
          if (logged) openCard('settings');
          else openLogin();
        },
        disabled: false,
      }
    : {
        label: selectedPlugin ? '启动插件' : '去安装插件',
        hint: selectedPlugin
          ? selectedPlugin.manifest.name
          : '功能广场里有更多',
        icon: Play,
        onClick: () => {
          if (selectedPlugin) openCard(`plugin:${selectedPlugin.manifest.id}`);
          else openCard('marketplace');
        },
        disabled: false,
      };

  const PrimaryIcon = primary.icon;

  return (
    <motion.footer
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="zj-card flex w-full shrink-0 items-center gap-3 px-3 py-2.5 sm:px-4"
    >
      {/* 左侧：头像 + 问候语 */}
      <button
        type="button"
        onClick={() => {
          if (!logged) openLogin();
          else openCard('settings');
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--zj-muted)]"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
          style={{
            backgroundColor: logged
              ? avatarColor(user?.uid)
              : 'var(--zj-muted-fg)',
          }}
        >
          {logged ? (user?.nickname ?? '?').slice(0, 1).toUpperCase() : '?'}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm leading-tight font-medium">
            {logged ? `您好！ ${user?.nickname ?? ''}` : '您好！ 访客'}
          </span>
          <span className="block truncate text-[0.6875rem] leading-tight text-[var(--zj-muted-fg)]">
            {logged ? '点击查看个人资料' : '点击登录解锁完整功能'}
          </span>
        </span>
      </button>

      {/* 右侧：状态图标 + 主行动 */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* 后端状态 */}
        <button
          type="button"
          onClick={() => void checkBackend()}
          title={
            backendOnline
              ? '后端在线，点击重新检测'
              : '后端未开启，点击重新检测'
          }
          aria-label="后端状态"
          className="flex size-8 items-center justify-center rounded-md text-[var(--zj-muted-fg)] transition-colors hover:bg-[var(--zj-muted)] hover:text-[var(--zj-fg)]"
        >
          {backendOnline ? (
            <CircleDot className="size-4" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </button>

        {/* 插件切换器：点击展开可切换已安装插件 */}
        {page === 2 && (
          <div className="relative" ref={switcherRef}>
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              title="展开插件列表"
              aria-label="展开插件列表"
              aria-expanded={switcherOpen}
              className="flex size-8 items-center justify-center rounded-md text-[var(--zj-muted-fg)] transition-colors hover:bg-[var(--zj-muted)] hover:text-[var(--zj-fg)]"
            >
              <Boxes className="size-4" />
            </button>

            <AnimatePresence>
              {switcherOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="zj-card absolute right-0 bottom-10 z-50 w-60 overflow-hidden p-1.5"
                >
                  <p className="px-2 py-1.5 text-[0.6875rem] text-[var(--zj-muted-fg)]">
                    已安装 {installedModules.length} 个插件 · 选择后点右下角启动
                  </p>
                  {installedModules.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-[var(--zj-muted-fg)]">
                      还没有安装插件
                    </p>
                  ) : (
                    <div className="max-h-64 space-y-0.5 overflow-y-auto">
                      {installedModules.map((m) => {
                        const isSelected = selectedPlugin?.manifest.id === m.manifest.id;
                        return (
                          <button
                            key={m.manifest.id}
                            type="button"
                            onClick={() => {
                              // 只做选择，不直接启动 —— 启动由右下角「启动插件」触发
                              setSelectedPluginId(m.manifest.id);
                              setSwitcherOpen(false);
                            }}
                            aria-pressed={isSelected}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                              isSelected
                                ? 'bg-[var(--zj-accent-soft)]'
                                : 'hover:bg-[var(--zj-muted)]',
                            )}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded bg-[var(--zj-accent-soft)] text-sm">
                              {m.manifest.preview ?? '🧩'}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  'block truncate text-xs font-medium',
                                  isSelected ? 'text-[var(--zj-accent)]' : '',
                                )}
                              >
                                {m.manifest.name}
                              </span>
                              <span className="block truncate text-[0.6875rem] text-[var(--zj-muted-fg)]">
                                {m.manifest.category} · v{m.manifest.version}
                              </span>
                            </span>
                            {isSelected ? (
                              <Check className="size-3.5 shrink-0 text-[var(--zj-accent)]" />
                            ) : (
                              <Play className="size-3 shrink-0 text-[var(--zj-muted-fg)]" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      openCard('marketplace');
                    }}
                    className="mt-1 w-full rounded-md border-t border-[var(--zj-border)] px-2 py-1.5 text-left text-[0.75rem] text-[var(--zj-accent)] transition-opacity hover:opacity-70"
                  >
                    去功能广场安装更多 →
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 主行动 */}
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="flex items-center gap-1.5 rounded-md bg-[var(--zj-accent-soft)] px-3 py-1.5 text-[var(--zj-fg)] transition-colors hover:bg-[var(--zj-accent)] hover:text-[var(--zj-accent-fg)] disabled:opacity-60"
        >
          <PrimaryIcon className="size-3.5 text-[var(--zj-accent)] transition-colors group-hover:text-[var(--zj-accent-fg)]" />
          <span className="text-left">
            <span className="block text-xs leading-tight font-medium">
              {primary.label}
            </span>
            <span className="block max-w-[9rem] truncate text-[0.6875rem] leading-tight text-[var(--zj-muted-fg)]">
              {primary.hint}
            </span>
          </span>
        </button>
      </div>
    </motion.footer>
  );
}

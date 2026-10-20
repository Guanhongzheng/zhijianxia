'use client';

import { motion } from 'framer-motion';
import { CircleDot, LogIn, Play, RefreshCw, Sun, Moon } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { useThemeStore } from '@/store/theme-store';
import { usePluginStore } from '@/store/plugin-store';
import { avatarColor } from '@/lib/utils';

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
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);

  const installedModules = modules.filter((m) => installed.includes(m.manifest.id));
  const firstPlugin = installedModules[0];

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
        label: firstPlugin ? '启动插件' : '去安装插件',
        hint: firstPlugin
          ? firstPlugin.manifest.name
          : '功能广场里有更多',
        icon: Play,
        onClick: () => {
          if (firstPlugin) openCard(`plugin:${firstPlugin.manifest.id}`);
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
          <span className="block truncate text-[10px] leading-tight text-[var(--zj-muted-fg)]">
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

        {/* 亮暗切换 */}
        <button
          type="button"
          onClick={toggleMode}
          title={mode === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          aria-label="切换亮暗模式"
          className="flex size-8 items-center justify-center rounded-md text-[var(--zj-muted-fg)] transition-colors hover:bg-[var(--zj-muted)] hover:text-[var(--zj-fg)]"
        >
          {mode === 'dark' ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </button>

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
            <span className="block max-w-[9rem] truncate text-[10px] leading-tight text-[var(--zj-muted-fg)]">
              {primary.hint}
            </span>
          </span>
        </button>
      </div>
    </motion.footer>
  );
}

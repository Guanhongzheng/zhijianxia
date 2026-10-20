'use client';

import { motion } from 'framer-motion';
import { CircleDot, Power, RefreshCw, Sun, Moon } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { useThemeStore } from '@/store/theme-store';
import { avatarColor } from '@/lib/utils';

/**
 * 底部状态栏 —— 左侧头像与问候语，右侧主行动区。
 * 视觉语言：整条实色横栏，右侧为绿色行动块。
 */
export function StatusBar({ onGo }: { onGo?: () => void }) {
  const logged = useAuthStore((s) => s.logged);
  const user = useAuthStore((s) => s.user);
  const openLogin = useAuthStore((s) => s.openLogin);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const checkBackend = useAppStore((s) => s.checkBackend);
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  const nickname = user?.nickname ?? '未登录';
  const displayName = logged ? `您好！ ${user?.nickname ?? ''}` : '点击登录';

  return (
    <div className="zj-bar flex h-14 shrink-0 items-stretch text-white select-none">
      {/* 左侧：头像 + 问候语 */}
      <button
        type="button"
        onClick={() => {
          if (!logged) openLogin();
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 text-left transition-opacity hover:opacity-90"
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold ring-1 ring-white/40"
          style={{
            backgroundColor: logged
              ? avatarColor(user?.uid)
              : 'rgba(255,255,255,0.18)',
          }}
        >
          {logged ? nickname.slice(0, 1).toUpperCase() : '?'}
        </span>
        <span className="min-w-0 truncate text-xs font-medium sm:text-base">
          {displayName}
        </span>
      </button>

      {/* 右侧：状态图标 + 主行动块 */}
      <div className="flex shrink-0 items-stretch">
        {/* 后端状态 */}
        <button
          type="button"
          onClick={() => void checkBackend()}
          title={backendOnline ? '后端在线，点击重新检测' : '后端未开启，点击重新检测'}
          aria-label="后端状态"
          className="hidden w-11 items-center justify-center transition-opacity hover:opacity-80 sm:flex"
        >
          {backendOnline ? (
            <CircleDot className="size-5" />
          ) : (
            <RefreshCw className="size-5" />
          )}
        </button>

        {/* 亮暗切换 */}
        <button
          type="button"
          onClick={toggleMode}
          title={mode === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          aria-label="切换亮暗模式"
          className="flex w-11 items-center justify-center transition-opacity hover:opacity-80"
        >
          {mode === 'dark' ? (
            <Sun className="size-5" />
          ) : (
            <Moon className="size-5" />
          )}
        </button>

        {/* 主行动块（绿色） */}
        <motion.button
          type="button"
          onClick={onGo}
          whileTap={{ scale: 0.98 }}
          className="zj-tile-go flex min-w-[6.5rem] flex-col items-center justify-center px-3 py-1.5 text-white sm:min-w-[10rem] sm:px-4"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-base">
            <Power className="size-3.5 sm:size-4" />
            启动插件
          </span>
          <span className="hidden text-[10px] opacity-85 sm:block">
            &lt;尚未选择核心&gt;
          </span>
        </motion.button>
      </div>
    </div>
  );
}

'use client';

import { motion } from 'framer-motion';
import { LogIn, Play } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { usePluginStore } from '@/store/plugin-store';

/**
 * 右下角浮动操作条。
 * - 第 1 页：登录入口（未登录时打开登录弹窗）
 * - 第 2 页：启动插件（点击直接启动最近使用的插件，或打开插件列表）
 */
export function CornerActions({ page }: { page: 1 | 2 }) {
  const openLogin = useAuthStore((s) => s.openLogin);
  const logged = useAuthStore((s) => s.logged);
  const openCard = useAppStore((s) => s.openCard);
  const modules = usePluginStore((s) => s.modules);
  const installed = usePluginStore((s) => s.installed);

  // 第 1 页：登录
  if (page === 1) {
    return (
      <div className="pointer-events-none absolute right-4 bottom-4 z-20 sm:right-6 sm:bottom-6">
        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => {
            if (logged) {
              openCard('settings');
            } else {
              openLogin();
            }
          }}
          className="zj-card pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors hover:border-[var(--zj-accent)]"
        >
          <LogIn className="size-4 text-[var(--zj-accent)]" />
          {logged ? '个人资料' : '登录'}
        </motion.button>
      </div>
    );
  }

  // 第 2 页：启动插件
  const installedModules = modules.filter((m) => installed.includes(m.manifest.id));
  const first = installedModules[0];

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-20 sm:right-6 sm:bottom-6">
      <motion.button
        type="button"
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        disabled={!first}
        onClick={() => {
          if (first) {
            openCard(`plugin:${first.manifest.id}`);
          } else {
            openCard('marketplace');
          }
        }}
        className="zj-card pointer-events-auto flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors hover:border-[var(--zj-accent)] disabled:opacity-60"
      >
        <Play className="size-4 text-[var(--zj-accent)]" />
        {first ? `启动 ${first.manifest.name}` : '去安装插件'}
      </motion.button>
    </div>
  );
}

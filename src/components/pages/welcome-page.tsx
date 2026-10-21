'use client';

import { motion } from 'framer-motion';
import { ArrowDown, LogIn, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';
import { avatarColor } from '@/lib/utils';
import { TopBar } from '@/components/layout/top-bar';

/**
 * 第 1 页：用户欢迎页
 * 上导航栏 + 居中主文案 + 下导航栏（登录卡片作为导航栏）。
 */
export function WelcomePage({ onEnter }: { onEnter: () => void }) {
  const logged = useAuthStore((s) => s.logged);
  const user = useAuthStore((s) => s.user);
  const openLogin = useAuthStore((s) => s.openLogin);
  const backendOnline = useAppStore((s) => s.backendOnline);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* 顶部导航栏 */}
      <div className="shrink-0 px-2 pt-2 sm:px-3 sm:pt-3">
        <TopBar
          title="智简匣"
          subtitle="本地离线 AI 工具箱"
          icon={Sparkles}
        />
      </div>

      {/* 主文案 —— 整体居中 */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-12 text-center sm:pb-16"
      >
        <h2 className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          把 AI 装进你自己的设备，
          <br />
          <span className="text-[var(--zj-accent)]">不联网也能用。</span>
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--zj-muted-fg)] sm:text-base">
          智简匣以本地离线 AI 为核心，底层能力封装、界面极简干净。
          所有扩展功能都通过插件广场按需安装，前后端解耦——后端只在需要好友、群聊与公告时才启动。
        </p>

        <p className="mt-5 text-xs text-[var(--zj-muted-fg)]">
          {backendOnline
            ? '后端已连接，好友与群聊功能可用'
            : '本地 AI 与插件无需后端，随时可用'}
        </p>
      </motion.div>

      {/* 下导航栏：登录卡片 */}
      <div className="shrink-0 px-2 pb-2 sm:px-3 sm:pb-3">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          {logged && user ? (
            <div className="zj-card flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: avatarColor(user.uid) }}
                >
                  {user.nickname.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm leading-tight font-medium">
                    您好！ {user.nickname}
                  </p>
                  <p className="truncate text-[0.6875rem] leading-tight text-[var(--zj-muted-fg)]">
                    UID {user.uid}
                    {user.role === 'admin' ? ' · 管理员' : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onEnter}
                className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--zj-accent-soft)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--zj-accent)] hover:text-[var(--zj-accent-fg)]"
              >
                进入功能区
                <ArrowDown className="size-3.5 rotate-90" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openLogin()}
              className="zj-card group flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors hover:border-[var(--zj-accent)]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)] transition-transform duration-200 group-hover:scale-105">
                  <LogIn className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm leading-tight font-medium">
                    登录以使用完整功能
                  </p>
                  <p className="truncate text-[0.6875rem] leading-tight text-[var(--zj-muted-fg)]">
                    好友、群聊与公告管理需要登录
                  </p>
                </div>
              </div>
              <ArrowDown className="size-4 shrink-0 rotate-[-90deg] text-[var(--zj-muted-fg)] transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          )}
        </motion.div>
      </div>
    </div>
  );
}

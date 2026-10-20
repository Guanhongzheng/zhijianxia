'use client';

import { motion } from 'framer-motion';
import { Cpu, Menu, Package, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';

/**
 * 第 1 页：用户欢迎页
 * 启动器风格：左上角品牌标题块 + 全屏纹理背景 + 底部状态栏。
 */
export function WelcomePage({ onEnter }: { onEnter: () => void }) {
  const logged = useAuthStore((s) => s.logged);
  const user = useAuthStore((s) => s.user);
  const openLogin = useAuthStore((s) => s.openLogin);
  const backendOnline = useAppStore((s) => s.backendOnline);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* 左上角品牌标题块 */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="zj-bar relative z-10 w-full max-w-md px-4 py-3 text-white sm:max-w-lg sm:px-5 sm:py-4"
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onEnter}
            aria-label="进入功能区"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded transition-opacity hover:opacity-75"
          >
            <Menu className="size-6" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg leading-tight font-semibold sm:text-2xl">
              欢迎使用全新 智简匣
            </h1>
            <p className="mt-0.5 text-[11px] leading-snug opacity-90 sm:text-sm">
              智简匣现已焕然一新。不太一样，大不一样！
            </p>
          </div>
        </div>
      </motion.div>

      {/* 中部主体 */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-2xl text-center"
        >
          <div className="mb-4 flex items-center justify-center gap-2.5">
            <div className="zj-bar flex size-11 items-center justify-center rounded-lg text-white">
              <Sparkles className="size-6" />
            </div>
            <span className="text-2xl font-semibold tracking-tight sm:text-3xl">
              智简匣
            </span>
          </div>

          <p className="text-sm leading-relaxed text-[var(--zj-muted-fg)] sm:text-base">
            以本地离线 AI 为核心的局域网工具箱。
            <br className="hidden sm:block" />
            把 AI 装进你自己的设备，不联网也能用。
          </p>

          {/* 特性磁贴 */}
          <div className="mt-6 grid grid-cols-3 gap-1.5">
            <FeatureTile icon={<Cpu className="size-5" />} title="本地推理" />
            <FeatureTile icon={<Package className="size-5" />} title="插件热插拔" />
            <FeatureTile icon={<ShieldCheck className="size-5" />} title="隐私优先" />
          </div>

          {/* 登录入口 */}
          {logged && user ? (
            <button
              type="button"
              onClick={onEnter}
              className="zj-tile-go mt-4 flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              进入功能区
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openLogin()}
              className="zj-tile mt-4 flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              登录以使用完整功能
            </button>
          )}

          <p className="mt-3 text-[11px] text-[var(--zj-muted-fg)]">
            {backendOnline
              ? '后端已连接，好友与群聊功能可用'
              : '本地 AI 与插件无需后端，随时可用'}
          </p>
        </motion.div>
      </div>
    </div>
  );
}

/** 特性磁贴 */
function FeatureTile({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="zj-tile flex flex-col items-center gap-1.5 px-2 py-3 text-white">
      {icon}
      <span className="text-[11px] leading-tight opacity-95">{title}</span>
    </div>
  );
}

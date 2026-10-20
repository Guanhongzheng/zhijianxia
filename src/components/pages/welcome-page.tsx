'use client';

import { motion } from 'framer-motion';
import {
  ArrowDown,
  Cpu,
  LogIn,
  Package,
  ShieldCheck,
  Sparkles,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';
import { useThemeStore } from '@/store/theme-store';
import { avatarColor } from '@/lib/utils';

/** 第 1 页：用户欢迎页 */
export function WelcomePage({ onEnter }: { onEnter: () => void }) {
  const logged = useAuthStore((s) => s.logged);
  const user = useAuthStore((s) => s.user);
  const openLogin = useAuthStore((s) => s.openLogin);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  return (
    <div className="flex h-full min-h-0 w-full flex-col px-5 py-6 sm:px-8 sm:py-8">
      {/* 顶部品牌区 */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex shrink-0 items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--zj-accent)] text-[var(--zj-accent-fg)]">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-lg leading-tight font-semibold">智简匣</h1>
            <p className="text-xs text-[var(--zj-muted-fg)]">本地离线 AI 工具箱</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={backendOnline ? 'success' : 'outline'}>
            <span className="flex items-center gap-1">
              <Wifi className="size-3" />
              后端{backendOnline ? '在线' : '未启动'}
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
      </motion.header>

      {/* 主文案 —— 占据剩余空间并垂直居中 */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="flex min-h-0 flex-1 flex-col justify-center"
      >
        <h2 className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          把 AI 装进你自己的设备，
          <br />
          <span className="text-[var(--zj-accent)]">不联网也能用。</span>
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--zj-muted-fg)]">
          智简匣以本地离线 AI 为核心，底层能力封装、界面极简干净。
          所有扩展功能都通过插件广场按需安装，前后端解耦——后端只在需要好友、群聊与公告时才启动。
        </p>
      </motion.div>

      {/* 特性卡片组 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 grid max-w-4xl shrink-0 gap-3 sm:grid-cols-3"
      >
        <FeatureCard
          icon={<Cpu className="size-4" />}
          title="本地离线推理"
          desc="模型跑在浏览器里，提示词不上传"
        />
        <FeatureCard
          icon={<Package className="size-4" />}
          title="插件热插拔"
          desc="功能广场按需下载，改内核不用动"
        />
        <FeatureCard
          icon={<ShieldCheck className="size-4" />}
          title="隐私优先"
          desc="局域网内互联，全程自持数据"
        />
      </motion.div>

      {/* 登录卡片入口：未登录直接在此页展示，不单独跳转登录页 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mt-5 max-w-4xl shrink-0"
      >
        {logged && user ? (
          <div className="zj-card flex items-center justify-between gap-4 p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: avatarColor(user.uid) }}
              >
                {user.nickname.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.nickname}</p>
                <p className="truncate text-xs text-[var(--zj-muted-fg)]">
                  UID {user.uid}
                  {user.role === 'admin' ? ' · 管理员' : ''}
                </p>
              </div>
            </div>
            <Button onClick={onEnter} className="shrink-0">
              进入功能区
              <ArrowDown className="size-4 rotate-90" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openLogin()}
            className="zj-card group flex w-full items-center justify-between gap-4 p-5 text-left transition-all duration-200 hover:border-[var(--zj-accent)]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--zj-accent-soft)] text-[var(--zj-accent)] transition-transform duration-200 group-hover:scale-105">
                <LogIn className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">登录以使用完整功能</p>
                <p className="mt-0.5 truncate text-xs text-[var(--zj-muted-fg)]">
                  好友、群聊与公告管理需要登录；本地 AI 与插件无需登录即可使用
                </p>
              </div>
            </div>
            <ArrowDown className="size-4 shrink-0 rotate-[-90deg] text-[var(--zj-muted-fg)] transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        )}
      </motion.div>

      {/* 向下滚动提示 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="mt-6 flex shrink-0 items-center justify-center gap-1.5 text-xs text-[var(--zj-muted-fg)]"
      >
        <span>向下滚动进入功能汇总页</span>
        <motion.span
          animate={{ y: [0, 4, 0] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        >
          <ArrowDown className="size-3.5" />
        </motion.span>
      </motion.div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="zj-card p-4">
      <div className="mb-2.5 flex size-8 items-center justify-center rounded-lg bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--zj-muted-fg)]">
        {desc}
      </p>
    </div>
  );
}

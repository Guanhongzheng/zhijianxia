'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WelcomePage } from '@/components/pages/welcome-page';
import { DashboardPage } from '@/components/pages/dashboard-page';
import { LoginDialog } from '@/components/modals/login-dialog';
import { CardDialog } from '@/components/modals/card-dialog';
import { BackendGate } from '@/components/modals/backend-gate';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { useThemeStore } from '@/store/theme-store';

/**
 * 主布局：两个页面区块 + CSS 滚动吸附。
 * - 第 1 页：用户欢迎页（未登录时直接展示登录卡片入口）
 * - 第 2 页：功能卡片汇总页
 * 滚动切换到第 2 页时自动弹出登录弹窗（未登录状态）。
 */
export function AppShell() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePage, setActivePage] = useState<0 | 1>(0);
  const hasTriggeredLogin = useRef(false);

  const logged = useAuthStore((s) => s.logged);
  const openLogin = useAuthStore((s) => s.openLogin);
  const themeLoading = useThemeStore((s) => s.loading);
  const activeCard = useAppStore((s) => s.activeCard);

  /** 监听滚动位置，判断当前处于第几页 */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const idx = el.scrollTop > el.clientHeight * 0.5 ? 1 : 0;
      setActivePage((prev) => (prev === idx ? prev : idx));
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  /** 滚动到第 2 页时，若未登录则自动弹出登录弹窗 */
  useEffect(() => {
    if (activePage === 1 && !logged && !hasTriggeredLogin.current) {
      hasTriggeredLogin.current = true;
      openLogin();
    }
  }, [activePage, logged, openLogin]);

  /** 用户主动点击登录卡片后，若之后退出登录，允许再次自动触发 */
  useEffect(() => {
    if (logged) hasTriggeredLogin.current = true;
  }, [logged]);

  const scrollToPage = useCallback((index: 0 | 1) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: index * el.clientHeight, behavior: 'smooth' });
  }, []);

  return (
    <>
      <div ref={containerRef} className="zj-scroll-snap">
        <section className="zj-snap-section" aria-label="欢迎页">
          <div className="flex min-h-0 flex-1 flex-col">
            <WelcomePage onEnter={() => scrollToPage(1)} />
          </div>
        </section>
        <section className="zj-snap-section" aria-label="功能汇总页">
          <div className="flex min-h-0 flex-1 flex-col">
            <DashboardPage active={activePage === 1} />
          </div>
        </section>
      </div>

      {/* 登录弹窗（浮层，不新开页面） */}
      <LoginDialog />

      {/* 各类功能卡片弹窗 */}
      <CardDialog />

      {/* 后端未开启提示网关 */}
      <BackendGate />

      {/* 主题加载期间整体骨架屏 */}
      {themeLoading && <ThemeBootSkeleton />}
    </>
  );
}

/** 主题包加载期间的全局骨架屏 */
function ThemeBootSkeleton() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--zj-bg)]">
      <div className="w-full max-w-3xl space-y-4 px-6">
        <div className="zj-skeleton h-8 w-48" />
        <div className="zj-skeleton h-3 w-72" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="zj-skeleton h-28 rounded-[var(--zj-radius)]" />
          ))}
        </div>
      </div>
    </div>
  );
}

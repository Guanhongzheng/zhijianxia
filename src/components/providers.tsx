'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { useThemeStore } from '@/store/theme-store';
import { usePluginStore } from '@/store/plugin-store';
import { LanSocket } from '@/lib/backend/socket';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toast } from '@/components/layout/toast';

/**
 * 全局 Provider：负责启动主题、插件内核、恢复登录态、轮询后端状态、建立 WebSocket。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const socketRef = useRef<LanSocket | null>(null);

  // 1) 主题初始化（需最先完成，避免首屏闪烁）
  useEffect(() => {
    void useThemeStore.getState().init();
  }, []);

  // 2) 恢复登录态 + 插件内核启动
  useEffect(() => {
    void (async () => {
      await useAuthStore.getState().restore();
      await usePluginStore.getState().boot();
      setReady(true);
    })();
  }, []);

  // 3) 后端状态轮询（每 8 秒检测一次）
  useEffect(() => {
    void useAppStore.getState().checkBackend();
    const timer = setInterval(() => {
      void useAppStore.getState().checkBackend();
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  // 4) 后端上线后自动连接 WebSocket 并拉取依赖后端的数据
  const backendOnline = useAppStore((s) => s.backendOnline);
  const logged = useAuthStore((s) => s.logged);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!backendOnline || !logged || !token || !user) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    const { lan, setOnlineUids, loadNotices, loadFriends, loadGroups } =
      useAppStore.getState();

    const socket = new LanSocket(lan, token, user.uid, {
      onOpen: () => {
        useAppStore.getState().notify('局域网实时连接已建立', 'success');
      },
      onClose: () => {
        setOnlineUids([]);
      },
      onPresence: (online) => setOnlineUids(online),
    });
    socketRef.current = socket;
    socket.connect();

    // 首屏拉取后端数据
    void loadNotices();
    void loadFriends();
    void loadGroups();

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [backendOnline, logged, token, user]);

  return (
    <TooltipProvider delayDuration={200}>
      {children}
      <Toast />
    </TooltipProvider>
  );
}

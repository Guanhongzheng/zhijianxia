'use client';

import { useCallback, useEffect, useState } from 'react';
import { Server, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';

/**
 * 后端未开启提示网关。
 * 依赖后端的功能（好友、群聊、局域网通信、后端转发 API、公告管理）在后端离线时
 * 统一弹出此提示。
 */
export function BackendGate() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const checking = useAppStore((s) => s.checking);
  const checkBackend = useAppStore((s) => s.checkBackend);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const logged = useAuthStore((s) => s.logged);
  const openLogin = useAuthStore((s) => s.openLogin);

  /**
   * 检查后端是否可用。
   * @returns true 表示可以继续使用依赖后端的功能
   */
  const requireBackend = useCallback(
    async (featureName?: string) => {
      const online = await checkBackend();
      if (online) return true;
      setReason(
        featureName ? `「${featureName}」需要后端服务支持` : '该功能需要后端服务支持',
      );
      setOpen(true);
      return false;
    },
    [checkBackend],
  );

  // 后端恢复在线后自动关闭提示
  useEffect(() => {
    if (backendOnline && open) {
      setOpen(false);
    }
  }, [backendOnline, open]);

  // 暴露全局检查方法，供各功能模块调用
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      zjRequireBackend?: (name?: string) => Promise<boolean>;
    };
    w.zjRequireBackend = requireBackend;
    return () => {
      delete w.zjRequireBackend;
    };
  }, [requireBackend]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WifiOff className="size-4 text-amber-500" />
            后端服务未开启
          </DialogTitle>
          <DialogDescription>
            {reason}，请启动后端服务后再使用该功能。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-[var(--zj-border)] bg-[var(--zj-muted)] p-3 text-xs leading-relaxed">
          <p className="mb-1.5 font-medium">启动方式</p>
          <code className="block rounded bg-[var(--zj-card)] px-2 py-1.5 text-[0.75rem]">
            npm run server
          </code>
          <p className="mt-1.5 text-[0.75rem] text-[var(--zj-muted-fg)]">
            启动后终端会打印本机局域网 IP，请到「系统设置 → 局域网」中填写该地址。
            本地 AI、插件、备忘录、主题包等纯本地功能不受影响，可正常使用。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            知道了
          </Button>
          <Button
            onClick={async () => {
              const online = await checkBackend();
              if (online) {
                setOpen(false);
                useAppStore.getState().notify('后端已连接', 'success');
                if (!logged) openLogin();
              }
            }}
            disabled={checking}
          >
            <Server className="size-3.5" />
            {checking ? '检测中…' : '重新检测'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 全局后端依赖检查入口。
 * 任何依赖后端的功能在执行前调用它，返回 false 表示后端不可用（此时已弹出提示）。
 */
export async function ensureBackend(featureName?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    zjRequireBackend?: (name?: string) => Promise<boolean>;
  };
  if (w.zjRequireBackend) return w.zjRequireBackend(featureName);

  // 兜底：直接检测一次
  const online = await useAppStore.getState().checkBackend();
  if (!online) {
    useAppStore
      .getState()
      .notify('后端服务未开启，请启动后端服务后再使用该功能', 'error');
  }
  return online;
}

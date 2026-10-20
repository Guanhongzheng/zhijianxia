'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, UserPlus, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';

/** 登录弹窗：浮层形式，不新开页面 */
export function LoginDialog() {
  const open = useAuthStore((s) => s.loginDialogOpen);
  const close = useAuthStore((s) => s.closeLogin);
  const submitting = useAuthStore((s) => s.submitting);
  const error = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    // 打开弹窗时重置表单与错误提示
    if (open) {
      setMode('login');
      setNickname('');
      setPassword('');
    }
  }, [open]);

  const submit = async () => {
    if (!nickname.trim() || !password) return;
    if (mode === 'login') {
      await login(nickname.trim(), password);
    } else {
      await register(nickname.trim(), password);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>登录智简匣</DialogTitle>
          <DialogDescription>
            登录后可使用好友、群聊与公告管理功能
          </DialogDescription>
        </DialogHeader>

        {!backendOnline && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/8 p-3"
          >
            <WifiOff className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="text-xs leading-relaxed">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                后端服务未开启
              </p>
              <p className="mt-0.5 text-[var(--zj-muted-fg)]">
                登录依赖后端服务。请先运行 <code>npm run server</code> 启动后端，
                再回到本页登录。本地 AI 与插件功能无需登录即可使用。
              </p>
            </div>
          </motion.div>
        )}

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'register')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">
              <LogIn className="size-3.5" />
              登录
            </TabsTrigger>
            <TabsTrigger value="register">
              <UserPlus className="size-3.5" />
              注册
            </TabsTrigger>
          </TabsList>

          {(['login', 'register'] as const).map((m) => (
            <TabsContent key={m} value={m} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="login-nickname">昵称</Label>
                <Input
                  id="login-nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="请输入昵称"
                  autoComplete="username"
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password">密码</Label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* 提交中：骨架屏占位，避免按钮文字闪烁 */}
        {submitting && (
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </motion.p>
        )}

        <Button
          className="w-full"
          disabled={!nickname.trim() || !password || submitting}
          onClick={() => void submit()}
        >
          {submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
        </Button>

        <div className="flex items-center justify-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            局域网内注册
          </Badge>
          <span className="text-[11px] text-[var(--zj-muted-fg)]">
            账号数据仅保存在你自己的设备上
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, LogOut, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';
import { avatarColor } from '@/lib/utils';

/**
 * 个人资料设置 —— 查看与编辑昵称、简介。
 * 需要登录；未登录时引导先登录。
 */
export function ProfileSettings() {
  const logged = useAuthStore((s) => s.logged);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const updateUser = useAuthStore((s) => s.updateUser);
  const logout = useAuthStore((s) => s.logout);
  const openLogin = useAuthStore((s) => s.openLogin);
  const lan = useAppStore((s) => s.lan);
  const notify = useAppStore((s) => s.notify);
  const jumpToPage = useAppStore((s) => s.jumpToPage);
  const openCard = useAppStore((s) => s.openCard);

  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname ?? '');
      setBio(user.bio ?? '');
    }
  }, [user]);

  // 未登录
  if (!logged || !user) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          <User className="size-6" />
        </div>
        <p className="text-sm font-medium">登录后可编辑个人资料</p>
        <p className="max-w-xs text-xs leading-relaxed text-[var(--zj-muted-fg)]">
          个人资料包含昵称与个人简介，仅保存在你的局域网后端中。
        </p>
        <Button size="sm" onClick={() => openLogin()}>
          去登录
        </Button>
      </div>
    );
  }

  const dirty =
    nickname.trim() !== (user.nickname ?? '') ||
    bio.trim() !== (user.bio ?? '');

  return (
    <div className="space-y-5">
      {/* 资料概览 */}
      <div className="flex items-center gap-3.5">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
          style={{ backgroundColor: avatarColor(user.uid) }}
        >
          {(user.nickname || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{user.nickname}</p>
            {user.role === 'admin' && (
              <Badge variant="solid" className="shrink-0 text-[0.6875rem]">
                <ShieldCheck className="size-2.5" />
                管理员
              </Badge>
            )}
          </div>
          <p className="truncate text-[0.75rem] text-[var(--zj-muted-fg)]">
            UID {user.uid}
          </p>
        </div>
      </div>

      {/* 编辑表单 */}
      <div className="space-y-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="profile-nickname" className="text-xs">
            昵称
          </Label>
          <Input
            id="profile-nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="请输入昵称"
            maxLength={24}
            disabled={loading}
          />
          <p className="text-[0.6875rem] text-[var(--zj-muted-fg)]">
            {nickname.length} / 24
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-bio" className="text-xs">
            个人简介
          </Label>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="介绍一下自己…"
            rows={4}
            maxLength={200}
            disabled={loading}
          />
          <p className="text-[0.6875rem] text-[var(--zj-muted-fg)]">
            {bio.length} / 200
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || !nickname.trim() || saving}
            onClick={async () => {
              setSaving(true);
              setLoading(true);
              const ok = await updateUser({
                nickname: nickname.trim(),
                bio: bio.trim(),
              });
              setSaving(false);
              setLoading(false);
              if (ok) {
                notify('个人资料已保存', 'success');
              } else {
                notify('保存失败，请检查后端连接', 'error');
              }
            }}
          >
            {saving ? '保存中…' : '保存修改'}
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNickname(user.nickname ?? '');
                setBio(user.bio ?? '');
              }}
            >
              撤销
            </Button>
          )}
        </div>
      </div>

      {/* 账号操作 */}
      <div className="rounded-md border border-[var(--zj-border)] p-3.5">
        <p className="text-xs font-medium">账号</p>
        <p className="mt-0.5 mb-3 text-[0.75rem] leading-relaxed text-[var(--zj-muted-fg)]">
          退出后需要重新输入昵称与密码登录。本地个性化配置（主题、插件、备忘录）不会丢失。
        </p>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            logout();
            // 关闭设置弹窗并回到欢迎页
            openCard(null);
            jumpToPage(0);
            notify('已退出登录', 'info');
          }}
        >
          <LogOut className="size-3" />
          退出登录
        </Button>
      </div>
    </div>
  );
}

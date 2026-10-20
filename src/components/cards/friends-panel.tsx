'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageSquare, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SkeletonList } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import {
  acceptFriend,
  rejectFriend,
  removeFriend,
  requestFriend,
} from '@/lib/backend/api';
import { avatarColor } from '@/lib/utils';

/** 好友卡片面板 */
export function FriendsPanel() {
  const friends = useAppStore((s) => s.friends);
  const loading = useAppStore((s) => s.friendsLoading);
  const onlineUids = useAppStore((s) => s.onlineUids);
  const lan = useAppStore((s) => s.lan);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const notify = useAppStore((s) => s.notify);
  const loadFriends = useAppStore((s) => s.loadFriends);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [uid, setUid] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (backendOnline && token) {
      void loadFriends();
    }
  }, [backendOnline, token, loadFriends]);

  if (!backendOnline) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="好友功能需要后端服务"
        desc="启动后端服务后即可通过 UID 搜索并添加好友"
      />
    );
  }

  const pending = friends.filter((f) => f.status === 'pending');
  const accepted = friends.filter((f) => f.status !== 'pending');

  return (
    <div className="space-y-4">
      {/* 搜索添加 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--zj-muted-fg)]" />
          <Input
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            placeholder="输入对方的 UID 添加好友"
            className="pl-9"
            onKeyDown={async (e) => {
              if (e.key !== 'Enter') return;
              if (!token || !uid.trim()) return;
              setSearching(true);
              try {
                await requestFriend(lan, token, uid.trim());
                notify('好友请求已发送', 'success');
                setUid('');
                await loadFriends();
              } catch (err) {
                notify(err instanceof Error ? err.message : '添加好友失败', 'error');
              } finally {
                setSearching(false);
              }
            }}
          />
        </div>
        <Button
          size="sm"
          disabled={!uid.trim() || searching || !token}
          onClick={async () => {
            if (!token || !uid.trim()) return;
            setSearching(true);
            try {
              await requestFriend(lan, token, uid.trim());
              notify('好友请求已发送', 'success');
              setUid('');
              await loadFriends();
            } catch (err) {
              notify(err instanceof Error ? err.message : '添加好友失败', 'error');
            } finally {
              setSearching(false);
            }
          }}
        >
          <UserPlus className="size-3.5" />
          添加
        </Button>
      </div>

      {user && (
        <div className="rounded-md border border-[var(--zj-border)] px-3 py-2 text-[11px] text-[var(--zj-muted-fg)]">
          你的 UID：<span className="font-medium text-[var(--zj-fg)]">{user.uid}</span>
          ，把它分享给同一局域网内的伙伴即可互相添加。
        </div>
      )}

      {/* 待处理请求 */}
      {pending.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium">待处理请求（{pending.length}）</p>
          <div className="space-y-2">
            {pending.map((f) => (
              <FriendRow
                key={`pending-${f.id}`}
                uid={f.uid}
                nickname={f.nickname}
                bio={f.bio}
                online={onlineUids.includes(f.uid)}
                actions={
                  <>
                    <Button
                      size="xs"
                      onClick={async () => {
                        if (!token) return;
                        try {
                          await acceptFriend(lan, token, f.id);
                          notify('已接受好友请求', 'success');
                          await loadFriends();
                        } catch (err) {
                          notify(
                            err instanceof Error ? err.message : '操作失败',
                            'error',
                          );
                        }
                      }}
                    >
                      接受
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={async () => {
                        if (!token) return;
                        try {
                          await rejectFriend(lan, token, f.id);
                          await loadFriends();
                        } catch (err) {
                          notify(
                            err instanceof Error ? err.message : '操作失败',
                            'error',
                          );
                        }
                      }}
                    >
                      拒绝
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* 好友列表 */}
      <div>
        <p className="mb-2 text-xs font-medium">好友列表（{accepted.length}）</p>
        {loading ? (
          <SkeletonList count={3} />
        ) : accepted.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="还没有好友"
            desc="用上方的 UID 搜索框添加第一位好友吧"
          />
        ) : (
          <div className="space-y-2">
            {accepted.map((f) => (
              <FriendRow
                key={f.uid}
                uid={f.uid}
                nickname={f.nickname}
                bio={f.bio}
                online={onlineUids.includes(f.uid)}
                actions={
                  <>
                    <Button
                      size="xs"
                      variant="ghost"
                      title="发起私聊"
                      onClick={() => {
                        notify('私聊功能请在群聊模块中使用', 'info');
                      }}
                    >
                      <MessageSquare className="size-3" />
                      私聊
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-red-500 hover:bg-red-500/10"
                      onClick={async () => {
                        if (!token) return;
                        try {
                          await removeFriend(lan, token, f.uid);
                          notify('已删除好友', 'info');
                          await loadFriends();
                        } catch (err) {
                          notify(
                            err instanceof Error ? err.message : '删除失败',
                            'error',
                          );
                        }
                      }}
                    >
                      <Trash2 className="size-3" />
                      删除
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 好友卡片行 */
function FriendRow({
  uid,
  nickname,
  bio,
  online,
  actions,
}: {
  uid: string;
  nickname: string;
  bio?: string;
  online: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="flex items-center gap-3 rounded-md border border-[var(--zj-border)] p-3"
    >
      <div className="relative shrink-0">
        <Avatar>
          <AvatarFallback
            style={{ backgroundColor: avatarColor(uid) }}
            className="text-white"
          >
            {nickname.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span
          className={`absolute - right-0.5 - bottom-0.5 size-2.5 rounded-full border-2 border-[var(--zj-card)] ${
            online ? 'bg-emerald-500' : 'bg-[var(--zj-muted-fg)]'
          }`}
          aria-label={online ? '在线' : '离线'}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{nickname}</p>
          {online && (
            <Badge variant="success" className="shrink-0 text-[10px]">
              在线
            </Badge>
          )}
        </div>
        <p className="truncate text-[11px] text-[var(--zj-muted-fg)]">
          UID {uid}
          {bio ? ` · ${bio}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </motion.div>
  );
}

/** 空状态 */
export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <span className="text-[var(--zj-muted-fg)]">{icon}</span>
      <p className="text-sm">{title}</p>
      <p className="text-xs text-[var(--zj-muted-fg)]">{desc}</p>
    </div>
  );
}

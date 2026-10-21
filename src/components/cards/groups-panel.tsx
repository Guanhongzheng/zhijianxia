'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Plus, Send, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SkeletonMessage, SkeletonList } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import {
  createGroup,
  deleteGroup,
  fetchMessages,
  type ChatMessage,
  type Group,
} from '@/lib/backend/api';
import { LanSocket } from '@/lib/backend/socket';
import { aiChat } from '@/lib/ai/scheduler';
import { avatarColor, formatTime } from '@/lib/utils';
import { EmptyState } from './friends-panel';

/** 群聊面板：创建群组 + 实时聊天 */
export function GroupsPanel() {
  const groups = useAppStore((s) => s.groups);
  const loading = useAppStore((s) => s.groupsLoading);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const lan = useAppStore((s) => s.lan);
  const notify = useAppStore((s) => s.notify);
  const loadGroups = useAppStore((s) => s.loadGroups);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    if (backendOnline && token) {
      void loadGroups();
    }
  }, [backendOnline, token, loadGroups]);

  if (!backendOnline) {
    return (
      <EmptyState
        icon={<Users className="size-5" />}
        title="群聊功能需要后端服务"
        desc="启动后端服务后即可创建群组并实时收发消息"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* 群组列表 */}
      <div className="flex gap-2">
        <Input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="输入新群聊名称"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void createGroupAndOpen();
            }
          }}
        />
        <Button
          size="sm"
          disabled={!groupName.trim() || !token}
          onClick={() => void createGroupAndOpen()}
        >
          <Plus className="size-3.5" />
          创建
        </Button>
      </div>

      {loading ? (
        <SkeletonList count={3} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="还没有群聊"
          desc="创建一个群聊，把好友聚在一起"
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <motion.button
              key={g.groupId}
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveGroup(g)}
              className="flex items-center gap-3 rounded-md border border-[var(--zj-border)] p-3 text-left transition-colors hover:border-[var(--zj-accent)]"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
                <Users className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.name}</p>
                <p className="truncate text-[0.75rem] text-[var(--zj-muted-fg)]">
                  {g.groupId} · {g.memberCount ?? g.members?.length ?? 0} 位成员
                </p>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* 群聊详情 */}
      <AnimatePresence>
        {activeGroup && (
          <GroupChatView
            group={activeGroup}
            onClose={() => setActiveGroup(null)}
            onDeleted={async () => {
              setActiveGroup(null);
              await loadGroups();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );

  /** 创建群聊并打开 */
  async function createGroupAndOpen() {
    if (!token || !groupName.trim()) return;
    try {
      const g = await createGroup(lan, token, groupName.trim());
      notify('群聊已创建', 'success');
      setGroupName('');
      await loadGroups();
      setActiveGroup(g);
    } catch (err) {
      notify(err instanceof Error ? err.message : '创建群聊失败', 'error');
    }
  }
}

/** 单个群聊的聊天视图 */
function GroupChatView({
  group,
  onClose,
  onDeleted,
}: {
  group: Group;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const lan = useAppStore((s) => s.lan);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const api = useAppStore((s) => s.api);
  const notify = useAppStore((s) => s.notify);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const socketRef = useRef<LanSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 加载历史消息 + 建立 WebSocket
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      if (!token || !user) return;
      setLoading(true);
      try {
        const history = await fetchMessages(lan, token, 'group', group.groupId);
        if (!cancelled) setMessages(history);
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }

      const socket = new LanSocket(lan, token, user.uid, {
        onMessage: (msg) => {
          if (msg.type !== 'message') return;
          const payload = msg.payload as
            | {
                id?: number;
                scope?: string;
                target?: string;
                senderUid?: string;
                body?: string;
                createdAt?: number;
              }
            | undefined;
          if (!payload || payload.scope !== 'group') return;
          if (payload.target !== group.groupId) return;
          setMessages((prev) => {
            // 避免与服务端广播 + 历史拉取重复
            if (prev.some((m) => m.id === payload.id)) return prev;
            return [
              ...prev,
              {
                id: Number(payload.createdAt ?? Date.now()),
                scope: 'group',
                target: group.groupId,
                senderUid: payload.senderUid ?? '',
                body: payload.body ?? '',
                createdAt: payload.createdAt ?? Date.now(),
              },
            ];
          });
        },
      });
      socketRef.current = socket;
      socket.connect();
    };

    void setup();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [group.groupId, lan, token, user]);

  // 滚动到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, aiThinking]);

  /** 发送消息 */
  const send = async () => {
    const body = input.trim();
    if (!body) return;
    setInput('');

    const sent = socketRef.current?.sendChat('group', group.groupId, body);
    if (!sent) {
      notify('实时连接尚未就绪，请稍后重试', 'error');
      setInput(body);
      return;
    }

    // 群内 AI 助手
    if (aiEnabled) {
      setAiThinking(true);
      try {
        const reply = await aiChat(
          { mode: api.mode, lan, token },
          [
            {
              role: 'system',
              content: `你是群聊「${group.name}」里的 AI 助手，请用简洁友好的中文回复。`,
            },
            { role: 'user', content: body },
          ],
          { maxTokens: 200 },
        );
        if (reply) {
          socketRef.current?.sendChat('group', group.groupId, `[AI] ${reply}`);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : 'AI 回复失败', 'error');
      } finally {
        setAiThinking(false);
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="flex max-h-[52dvh] flex-col rounded-[var(--zj-radius)] border border-[var(--zj-border)]"
    >
      {/* 群头部 */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--zj-border)] px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{group.name}</p>
          <p className="truncate text-[0.75rem] text-[var(--zj-muted-fg)]">
            {group.groupId} · {group.memberCount ?? group.members?.length ?? 0} 位成员
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Bot className="size-3.5 text-[var(--zj-muted-fg)]" />
            <Label htmlFor="ai-toggle" className="text-[0.75rem]">
              AI
            </Label>
            <Switch
              id="ai-toggle"
              checked={aiEnabled}
              onCheckedChange={setAiEnabled}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-red-500 hover:bg-red-500/10"
            onClick={async () => {
              if (!token) return;
              setDeleting(true);
              try {
                await deleteGroup(lan, token, group.groupId);
                notify('群聊已解散', 'info');
                await onDeleted();
              } catch (err) {
                notify(err instanceof Error ? err.message : '解散失败', 'error');
              } finally {
                setDeleting(false);
              }
            }}
            aria-label="解散群聊"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={onClose}>
            收起
          </Button>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={listRef} className="min-h-32 flex-1 space-y-3 overflow-y-auto p-3.5">
        {loading ? (
          <>
            <SkeletonMessage />
            <SkeletonMessage />
            <SkeletonMessage />
          </>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--zj-muted-fg)]">
            还没有消息，说点什么吧
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderUid === user?.uid;
            const isAi = m.body.startsWith('[AI]');
            return (
              <div
                key={`${m.id}-${m.senderUid}`}
                className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}
              >
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback
                    className="text-[0.6875rem] text-white"
                    style={{
                      backgroundColor: isAi
                        ? 'var(--zj-accent)'
                        : avatarColor(m.senderUid),
                    }}
                  >
                    {isAi ? 'AI' : (m.senderUid || '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={`max-w-[78%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    mine
                      ? 'bg-[var(--zj-accent)] text-[var(--zj-accent-fg)]'
                      : 'bg-[var(--zj-muted)] text-[var(--zj-fg)]'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">
                    {isAi ? m.body.slice(4).trim() : m.body}
                  </p>
                  <p
                    className={`mt-1 text-[0.6875rem] ${
                      mine ? 'opacity-70' : 'text-[var(--zj-muted-fg)]'
                    }`}
                  >
                    {mine ? '我' : m.senderUid} · {formatTime(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}

        {aiThinking && (
          <div className="flex gap-2.5">
            <Avatar className="size-7 shrink-0">
              <AvatarFallback
                className="bg-[var(--zj-accent)] text-[0.6875rem] text-[var(--zj-accent-fg)]"
              >
                AI
              </AvatarFallback>
            </Avatar>
            <div className="rounded-lg bg-[var(--zj-muted)] px-3 py-2">
              <div className="zj-skeleton h-2.5 w-16" />
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex gap-2 border-t border-[var(--zj-border)] p-2.5">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入消息…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button size="sm" onClick={() => void send()} disabled={!input.trim()}>
          <Send className="size-3.5" />
          发送
        </Button>
      </div>
    </motion.div>
  );
}

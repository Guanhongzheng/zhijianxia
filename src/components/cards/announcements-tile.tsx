'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import {
  createNotice,
  deleteNotice,
  updateNotice,
  type Notice,
} from '@/lib/backend/api';
import { formatTime } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';

/**
 * 公告磁贴 —— 红色资讯块，滚动展示公告列表。
 * 管理员可直接在磁贴内新增/编辑/删除。
 */
export function AnnouncementsTile({ isAdmin }: { isAdmin: boolean }) {
  const notices = useAppStore((s) => s.notices);
  const loading = useAppStore((s) => s.noticesLoading);
  const loaded = useAppStore((s) => s.noticesLoaded);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const token = useAuthStore((s) => s.token);
  const lan = useAppStore((s) => s.lan);
  const notify = useAppStore((s) => s.notify);
  const refreshNotices = useAppStore((s) => s.refreshNotices);
  const openCard = useAppStore((s) => s.openCard);

  const [editing, setEditing] = useState<Notice | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Notice | null>(null);

  // 后端恢复在线后自动加载
  useEffect(() => {
    if (backendOnline && !loaded) {
      void refreshNotices();
    }
  }, [backendOnline, loaded, refreshNotices]);

  return (
    <div className="zj-tile zj-tile-news flex min-h-56 h-full flex-col overflow-hidden text-white">
      {/* 磁贴标题 */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
        <Megaphone className="size-4 shrink-0" strokeWidth={1.9} />
        <span className="text-sm font-medium">公告</span>
        <span className="text-[11px] opacity-80">
          {notices.length > 0 ? `${notices.length} 条` : ''}
        </span>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-75"
          >
            <Plus className="size-3" />
            新增
          </button>
        )}
      </div>

      {/* 公告列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5">
        {!backendOnline ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 py-8 text-center">
            <p className="text-sm font-medium">公告需要后端服务支持</p>
            <p className="text-[11px] opacity-85">
              启动后端服务后即可查看更新日志
            </p>
          </div>
        ) : loading || !loaded ? (
          <div className="space-y-1.5 py-1">
            <div className="h-12 animate-pulse rounded bg-white/20" />
            <div className="h-12 animate-pulse rounded bg-white/15" />
            <div className="h-12 animate-pulse rounded bg-white/10" />
          </div>
        ) : notices.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 py-8 text-center">
            <p className="text-sm opacity-90">暂无公告</p>
            {isAdmin && (
              <p className="text-[11px] opacity-75">点击右上角「新增」发布</p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {notices.map((notice, idx) => (
              <motion.div
                key={notice.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(idx * 0.04, 0.2),
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="group relative rounded bg-white/12 p-2.5 transition-colors hover:bg-white/20"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-snug font-medium">
                    {notice.title}
                  </p>
                  {isAdmin && (
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => setEditing(notice)}
                        aria-label="编辑公告"
                        className="rounded p-0.5 transition-opacity hover:opacity-70"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoving(notice)}
                        aria-label="删除公告"
                        className="rounded p-0.5 transition-opacity hover:opacity-70"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed opacity-90">
                  {notice.body}
                </p>
                <p className="mt-1 text-[10px] opacity-70">
                  {notice.authorUid} · {formatTime(notice.createdAt)}
                </p>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 新增 / 编辑弹窗 */}
      <NoticeEditor
        open={creating || editing !== null}
        notice={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={async (title, body) => {
          if (!token) {
            notify('登录状态已失效，请重新登录', 'error');
            return false;
          }
          try {
            if (editing) {
              await updateNotice(lan, token, editing.id, { title, body });
              notify('公告已更新', 'success');
            } else {
              await createNotice(lan, token, { title, body });
              notify('公告已发布', 'success');
            }
            await refreshNotices();
            setCreating(false);
            setEditing(null);
            return true;
          } catch (err) {
            notify(err instanceof Error ? err.message : '操作失败', 'error');
            return false;
          }
        }}
      />

      {/* 删除确认 */}
      <Dialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除公告</DialogTitle>
            <DialogDescription>
              确认删除「{removing?.title}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!token || !removing) return;
                try {
                  await deleteNotice(lan, token, removing.id);
                  notify('公告已删除', 'success');
                  await refreshNotices();
                } catch (err) {
                  notify(
                    err instanceof Error ? err.message : '删除失败',
                    'error',
                  );
                }
                setRemoving(null);
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 公告编辑弹窗（新增与修改共用） */
function NoticeEditor({
  open,
  notice,
  onClose,
  onSubmit,
}: {
  open: boolean;
  notice: Notice | null;
  onClose: () => void;
  onSubmit: (title: string, body: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(notice?.title ?? '');
      setBody(notice?.body ?? '');
    }
  }, [open, notice]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notice ? '修改公告' : '新增公告'}</DialogTitle>
          <DialogDescription>
            公告内容将展示在功能磁贴页的公告磁贴中
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="notice-title"
              className="text-xs font-medium text-[var(--zj-muted-fg)]"
            >
              标题
            </label>
            <Input
              id="notice-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：v1.2.0 新增文本摘要插件"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="notice-body"
              className="text-xs font-medium text-[var(--zj-muted-fg)]"
            >
              正文
            </label>
            <Textarea
              id="notice-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="公告详情…"
              rows={5}
              maxLength={2000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!title.trim() || !body.trim() || saving}
            onClick={async () => {
              setSaving(true);
              await onSubmit(title.trim(), body.trim());
              setSaving(false);
            }}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

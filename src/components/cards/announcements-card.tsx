'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SkeletonNotice } from '@/components/ui/skeleton';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/input';

/** 公告卡片组：普通用户只读，管理员可编辑 */
export function AnnouncementsCard() {
  const notices = useAppStore((s) => s.notices);
  const loading = useAppStore((s) => s.noticesLoading);
  const loaded = useAppStore((s) => s.noticesLoaded);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const token = useAuthStore((s) => s.token);
  const lan = useAppStore((s) => s.lan);
  const notify = useAppStore((s) => s.notify);
  const refreshNotices = useAppStore((s) => s.refreshNotices);

  const [editing, setEditing] = useState<Notice | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Notice | null>(null);

  // 后端恢复在线后自动加载
  useEffect(() => {
    if (backendOnline && !loaded) {
      void refreshNotices();
    }
  }, [backendOnline, loaded, refreshNotices]);

  // 后端离线：不显示骨架屏，直接给出友好提示
  if (!backendOnline) {
    return (
      <div className="zj-card flex flex-col items-center gap-2 px-5 py-8 text-center">
        <Megaphone className="size-5 text-[var(--zj-muted-fg)]" />
        <p className="text-sm">公告需要后端服务支持</p>
        <p className="text-xs text-[var(--zj-muted-fg)]">
          启动后端服务后即可查看更新日志与新增功能公告
        </p>
      </div>
    );
  }

  // 加载中：统一骨架屏
  if (loading || !loaded) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <SkeletonNotice />
        <SkeletonNotice />
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {notices.length === 0 ? (
          <div className="zj-card col-span-full px-5 py-8 text-center">
            <p className="text-sm text-[var(--zj-muted-fg)]">
              暂无公告
              {isAdmin ? '，点击右上角「新增公告」发布第一条' : ''}
            </p>
          </div>
        ) : (
          notices.map((notice) => (
            <motion.article
              key={notice.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="zj-card flex flex-col gap-2 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm leading-snug font-medium">{notice.title}</h4>
                {isAdmin && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setEditing(notice)}
                      aria-label="编辑公告"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRemoving(notice)}
                      aria-label="删除公告"
                      className="text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--zj-muted-fg)]">
                {notice.body}
              </p>
              <div className="mt-auto flex items-center gap-2 pt-1">
                <Badge variant="outline" className="text-[10px]">
                  {notice.authorUid}
                </Badge>
                <span className="text-[11px] text-[var(--zj-muted-fg)]">
                  {formatTime(notice.createdAt)}
                </span>
              </div>
            </motion.article>
          ))
        )}
      </div>

      {/* 管理员操作入口 */}
      {isAdmin && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            新增公告
          </Button>
        </div>
      )}

      {/* 编辑 / 新增弹窗 */}
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
        onOpenChange={(open) => !open && setRemoving(null)}
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
                  notify(err instanceof Error ? err.message : '删除失败', 'error');
                }
                setRemoving(null);
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
            公告内容将展示在功能汇总页的公告卡片组中
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
              const ok = await onSubmit(title.trim(), body.trim());
              setSaving(false);
              if (!ok) return;
            }}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 预装插件 · 本地待办备忘录
 *
 * - 待办增删勾选，数据通过 ctx.storage 持久化（命名空间隔离）
 * - 「AI 智能整理」按钮：调用 ctx.ai.chat 让模型为每条待办补齐分类、优先级与提醒文案
 * - 全部数据留在本机，不上传任何服务器
 */

'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ListTodo, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAiTask } from '../hooks';
import { cx, parseJsonLoose, runAi, uid } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'memo-card',
  name: '本地待办备忘录',
  version: '1.0.0',
  description: '轻量待办清单，支持本地持久化，并可一键让 AI 自动补齐分类、优先级与提醒文案。',
  category: '效率',
  author: '智简匣',
  icon: 'ListTodo',
  preview: '📝',
  tags: ['待办', '效率', 'AI'],
  minCoreVersion: '1.0.0',
  builtin: true,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 数据模型                                                                    */
/* -------------------------------------------------------------------------- */

/** 单条待办 */
export interface MemoItem {
  id: string;
  text: string;
  done: boolean;
  /** AI 生成的分类标签 */
  category?: string;
  /** AI 生成的优先级 */
  priority?: '高' | '中' | '低';
  /** AI 生成的提醒文案 */
  reminder?: string;
  createdAt: number;
}

/** 存储键 */
const STORAGE_KEY = 'memos';

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

/** AI 整理的系统提示词 */
const ORGANIZE_SYSTEM =
  '你是一位效率助手。用户会给你一组待办事项，请为每一条补齐信息，并以 JSON 数组返回。' +
  '每个元素包含三个字段：index（对应输入的序号，从 0 开始）、category（分类标签，如「工作」「生活」「学习」，2-4 个字）、' +
  'priority（优先级，只能是「高」「中」「低」之一）、reminder（一句话提醒文案，20 字以内）。' +
  '只输出 JSON 数组，不要任何解释文字。';

export function MemoCard({ ctx }: PluginComponentProps) {
  const [items, setItems] = useState<MemoItem[]>(() =>
    ctx.storage.get<MemoItem[]>(STORAGE_KEY, []),
  );
  const [draft, setDraft] = useState('');
  const task = useAiTask();

  /** 持久化并更新列表 */
  const commit = useCallback(
    (next: MemoItem[]) => {
      setItems(next);
      ctx.storage.set(STORAGE_KEY, next);
    },
    [ctx],
  );

  /** 新增待办 */
  const addMemo = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const next: MemoItem[] = [
      ...items,
      { id: uid('memo'), text, done: false, createdAt: Date.now() },
    ];
    commit(next);
    setDraft('');
  }, [commit, draft, items]);

  /** 切换完成状态 */
  const toggleMemo = useCallback(
    (id: string) => {
      commit(items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
    },
    [commit, items],
  );

  /** 删除待办 */
  const removeMemo = useCallback(
    (id: string) => {
      commit(items.filter((item) => item.id !== id));
    },
    [commit, items],
  );

  /** 清空已完成的待办 */
  const clearDone = useCallback(() => {
    commit(items.filter((item) => !item.done));
  }, [commit, items]);

  /**
   * AI 智能整理：让模型为未完成的待办补齐分类、优先级与提醒文案。
   */
  const organize = useCallback(async () => {
    const pending = items.filter((item) => !item.done);
    if (pending.length === 0) {
      ctx.notify('没有待整理的待办事项', 'info');
      return;
    }

    const result = await task.run(() =>
      runAi(ctx, {
        system: ORGANIZE_SYSTEM,
        user: pending.map((item, index) => `${index}. ${item.text}`).join('\n'),
        temperature: 0.3,
      }),
    );

    if (!result) {
      ctx.notify('AI 整理失败，请稍后重试', 'error');
      return;
    }

    const parsed = parseJsonLoose<
      Array<{ index?: number; category?: string; priority?: string; reminder?: string }>
    >(result);

    if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
      ctx.notify('AI 返回内容无法解析，原数据保持不变', 'error');
      return;
    }

    const byIndex = new Map<number, (typeof parsed)[number]>();
    parsed.forEach((entry) => {
      if (typeof entry?.index === 'number') byIndex.set(entry.index, entry);
    });

    const next = items.map((item) => {
      const pendingIndex = pending.findIndex((p) => p.id === item.id);
      if (pendingIndex < 0) return item;
      const extra = byIndex.get(pendingIndex);
      if (!extra) return item;
      const priority =
        extra.priority === '高' || extra.priority === '中' || extra.priority === '低'
          ? extra.priority
          : undefined;
      return {
        ...item,
        category: typeof extra.category === 'string' ? extra.category.slice(0, 6) : item.category,
        priority: priority ?? item.priority,
        reminder: typeof extra.reminder === 'string' ? extra.reminder.slice(0, 40) : item.reminder,
      };
    });

    commit(next);
    ctx.notify('AI 整理完成', 'success');
  }, [commit, ctx, items, task]);

  const doneCount = useMemo(() => items.filter((item) => item.done).length, [items]);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-4 w-4" />
            本地待办备忘录
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            共 {items.length} 条 · 已完成 {doneCount} 条 · 数据仅保存在本机
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void organize()} disabled={task.loading}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {task.loading ? '整理中…' : 'AI 整理'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 输入区 */}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMemo();
            }}
            placeholder="添加一条待办，回车确认"
            className="h-9 text-sm"
          />
          <Button size="sm" className="h-9 shrink-0" onClick={addMemo}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* AI 整理中的骨架屏 */}
        {task.loading && (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        )}

        {/* 任务列表 */}
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            还没有待办事项，先添加一条吧
          </div>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18 }}
                  className={cx(
                    'flex items-start gap-2.5 rounded-lg border border-border/50 p-2.5',
                    'bg-card transition-colors',
                    item.done && 'bg-muted/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleMemo(item.id)}
                    className={cx(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px]',
                      'border transition-colors',
                      item.done
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 hover:border-primary',
                    )}
                    aria-label={item.done ? '标记为未完成' : '标记完成'}
                  >
                    {item.done && <Check className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cx(
                        'text-sm leading-snug',
                        item.done && 'text-muted-foreground line-through',
                      )}
                    >
                      {item.text}
                    </p>
                    {(item.category || item.priority || item.reminder) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {item.category && (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            {item.category}
                          </Badge>
                        )}
                        {item.priority && (
                          <Badge
                            variant={item.priority === '高' ? 'destructive' : 'outline'}
                            className="h-5 px-1.5 text-[10px]"
                          >
                            {item.priority}优先
                          </Badge>
                        )}
                        {item.reminder && (
                          <span className="text-[10px] text-muted-foreground">{item.reminder}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeMemo(item.id)}
                    aria-label="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        {doneCount > 0 && (
          <Button size="sm" variant="ghost" className="h-7 w-full text-xs text-muted-foreground" onClick={clearDone}>
            <Check className="mr-1.5 h-3 w-3" />
            清除已完成（{doneCount}）
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default MemoCard;

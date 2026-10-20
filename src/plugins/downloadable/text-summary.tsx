/**
 * 可下载插件 · AI 文本摘要摘录
 *
 * - 粘贴长文本 -> AI 提炼要点 / 生成笔记 / 一句话总结
 * - 历史记录本地持久化（ctx.storage）
 */

'use client';

import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList,
  FileText,
  History,
  NotebookPen,
  Scissors,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAiTask } from '../hooks';
import { cx, formatRelativeTime, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'text-summary',
  name: 'AI 文本摘要摘录',
  version: '1.0.0',
  description: '粘贴长文本，AI 一键提炼要点、生成结构化笔记或一句话总结，历史记录保存在本机。',
  category: '效率',
  author: '智简匣',
  icon: 'Scissors',
  preview: '📝',
  tags: ['摘要', '笔记', 'AI'],
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 数据模型                                                                    */
/* -------------------------------------------------------------------------- */

/** 摘要模式 */
type SummaryMode = 'keypoints' | 'notes' | 'brief';

/** 历史记录条目 */
interface HistoryItem {
  id: string;
  mode: SummaryMode;
  /** 原文前 60 字 */
  preview: string;
  /** 生成结果 */
  result: string;
  at: number;
}

/** 存储键 */
const STORAGE_KEY = 'history';

/** 模式配置 */
const MODES: Array<{ value: SummaryMode; label: string; system: string; icon: typeof ClipboardList }> = [
  {
    value: 'keypoints',
    label: '要点提炼',
    icon: ClipboardList,
    system:
      '你是一位信息提炼助手。请从用户提供的文本中提炼出 3-6 条核心要点，以编号列表输出，每条不超过 30 字。' +
      '直接输出要点，不要额外说明。',
  },
  {
    value: 'notes',
    label: '生成笔记',
    icon: NotebookPen,
    system:
      '你是一位笔记整理助手。请把用户提供的文本整理成结构化笔记，包含「核心观点」「关键细节」「可执行事项」三个小节。' +
      '使用 Markdown 小标题与短列表，直接输出笔记正文。',
  },
  {
    value: 'brief',
    label: '一句话总结',
    icon: FileText,
    system:
      '你是一位摘要助手。请用一句不超过 40 字的中文概括用户文本的主旨。只输出这一句话，不要引号，不要解释。',
  },
];

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export function TextSummaryCard({ ctx }: PluginComponentProps) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<SummaryMode>('keypoints');
  const [history, setHistory] = useState<HistoryItem[]>(() =>
    ctx.storage.get<HistoryItem[]>(STORAGE_KEY, []),
  );
  const task = useAiTask();

  const currentMode = MODES.find((m) => m.value === mode) ?? MODES[0];

  /** 执行摘要 */
  const summarize = useCallback(async () => {
    const text = input.trim();
    if (!text) {
      ctx.notify('请先粘贴需要处理的文本', 'error');
      return;
    }
    const result = await task.run(() =>
      runAi(ctx, {
        system: currentMode.system,
        user: text,
        temperature: 0.4,
      }),
    );
    if (!result) {
      ctx.notify('摘要生成失败，请稍后重试', 'error');
      return;
    }
    const item: HistoryItem = {
      id: `sum_${Date.now()}`,
      mode,
      preview: text.slice(0, 60),
      result,
      at: Date.now(),
    };
    const next = [item, ...history].slice(0, 30);
    setHistory(next);
    ctx.storage.set(STORAGE_KEY, next);
  }, [ctx, currentMode.system, history, input, mode, task]);

  /** 删除某条历史 */
  const removeHistory = useCallback(
    (id: string) => {
      const next = history.filter((item) => item.id !== id);
      setHistory(next);
      ctx.storage.set(STORAGE_KEY, next);
    },
    [ctx, history],
  );

  /** 清空历史 */
  const clearHistory = useCallback(() => {
    setHistory([]);
    ctx.storage.set(STORAGE_KEY, []);
  }, [ctx]);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scissors className="h-4 w-4" />
          AI 文本摘要摘录
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          原文只在本机处理，历史记录共 {history.length} 条
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 模式切换 */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as SummaryMode)}>
          <TabsList className="w-full">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <TabsTrigger key={m.value} value={m.value} className="flex-1 text-xs">
                  <Icon className="mr-1 h-3 w-3" />
                  {m.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {MODES.map((m) => (
            <TabsContent key={m.value} value={m.value} className="mt-2 text-[11px] text-muted-foreground">
              {m.system.slice(0, 38)}…
            </TabsContent>
          ))}
        </Tabs>

        {/* 输入 */}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="把需要提炼的长文本粘贴到这里…"
          className="min-h-32 resize-y text-sm"
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{input.length} 字</span>
          <Button size="sm" className="ml-auto" onClick={() => void summarize()} disabled={task.loading}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {task.loading ? '处理中…' : '开始提炼'}
          </Button>
        </div>

        {/* 结果 */}
        {task.loading ? (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ) : task.error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {task.error}
          </p>
        ) : task.result ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="rounded-lg border border-border/50 bg-muted/30 p-3"
          >
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {task.result}
            </p>
          </motion.div>
        ) : null}

        {/* 历史记录 */}
        {history.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <History className="h-3 w-3" />
                历史记录
              </span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={clearHistory}>
                清空
              </Button>
            </div>
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {history.map((item) => (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.16 }}
                    className="rounded-lg border border-border/50 p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-1.5">
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            {MODES.find((m) => m.value === item.mode)?.label ?? '摘要'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {formatRelativeTime(item.at)}
                          </span>
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">{item.preview}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeHistory(item.id)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="删除记录"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <details className="mt-1.5">
                      <summary
                        className={cx(
                          'cursor-pointer text-[11px] text-primary',
                          'hover:underline',
                        )}
                      >
                        展开结果
                      </summary>
                      <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed">
                        {item.result}
                      </p>
                    </details>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

export default TextSummaryCard;

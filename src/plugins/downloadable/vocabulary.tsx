/**
 * 可下载插件 · AI 生词本
 *
 * - 添加单词 -> AI 生成释义、音标、例句与记忆口诀
 * - 卡片式记忆模式：点击翻面看释义
 * - 全部数据本地存储（ctx.storage）
 */

'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAiTask } from '../hooks';
import { cx, parseJsonLoose, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'vocabulary',
  name: 'AI 生词本',
  version: '1.0.0',
  description: '添加单词即可由 AI 生成释义、例句与记忆口诀，卡片翻面式记忆，全部数据保存在本机。',
  category: '学习',
  author: '智简匣',
  icon: 'BookOpen',
  preview: '📖',
  tags: ['英语', '单词', '记忆', 'AI'],
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 数据模型                                                                    */
/* -------------------------------------------------------------------------- */

/** 单词条目 */
interface WordItem {
  id: string;
  /** 单词 */
  word: string;
  /** 音标 */
  phonetic?: string;
  /** 中文释义 */
  meaning?: string;
  /** 例句 */
  example?: string;
  /** 记忆口诀 */
  mnemonic?: string;
  /** 掌握程度：0 未学 1 模糊 2 掌握 */
  level: 0 | 1 | 2;
  createdAt: number;
}

/** 存储键 */
const STORAGE_KEY = 'words';

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

/** AI 释义生成的系统提示词 */
const DICT_SYSTEM =
  '你是一位英语学习助手。请为用户给出的单词生成学习卡片，并以 JSON 对象返回。' +
  '字段要求：word（原单词）、phonetic（音标，形如 /ˈwɜːrd/，不确定时可留空字符串）、' +
  'meaning（中文释义，20 字以内）、example（一句英文例句，30 词以内）、mnemonic（一句中文记忆口诀或联想，25 字以内）。' +
  '只输出 JSON 对象，不要解释文字。';

export function VocabularyCard({ ctx }: PluginComponentProps) {
  const [words, setWords] = useState<WordItem[]>(() => ctx.storage.get<WordItem[]>(STORAGE_KEY, []));
  const [draft, setDraft] = useState('');
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const task = useAiTask();

  /** 持久化 */
  const commit = useCallback(
    (next: WordItem[]) => {
      setWords(next);
      ctx.storage.set(STORAGE_KEY, next);
    },
    [ctx],
  );

  /** 统计 */
  const stats = useMemo(() => {
    const mastered = words.filter((w) => w.level === 2).length;
    return { total: words.length, mastered };
  }, [words]);

  /** 添加单词并请求 AI 生成卡片 */
  const addWord = useCallback(async () => {
    const word = draft.trim();
    if (!word) {
      ctx.notify('请先输入单词', 'error');
      return;
    }
    if (words.some((w) => w.word.toLowerCase() === word.toLowerCase())) {
      ctx.notify('这个单词已经在生词本里了', 'info');
      return;
    }

    const result = await task.run(() =>
      runAi(ctx, {
        system: DICT_SYSTEM,
        user: word,
        temperature: 0.5,
      }),
    );

    const parsed = result ? parseJsonLoose<Partial<WordItem>>(result) : null;
    const item: WordItem = {
      id: `word_${Date.now()}`,
      word,
      phonetic: typeof parsed?.phonetic === 'string' ? parsed.phonetic : undefined,
      meaning: typeof parsed?.meaning === 'string' ? parsed.meaning : undefined,
      example: typeof parsed?.example === 'string' ? parsed.example : undefined,
      mnemonic: typeof parsed?.mnemonic === 'string' ? parsed.mnemonic : undefined,
      level: 0,
      createdAt: Date.now(),
    };
    commit([item, ...words]);
    setDraft('');

    if (!parsed?.meaning) {
      ctx.notify('单词已保存，但 AI 释义暂不可用', 'info');
    }
  }, [commit, ctx, draft, task, words]);

  /** 更新掌握程度 */
  const setLevel = useCallback(
    (id: string, level: 0 | 1 | 2) => {
      commit(words.map((w) => (w.id === id ? { ...w, level } : w)));
    },
    [commit, words],
  );

  /** 删除单词 */
  const removeWord = useCallback(
    (id: string) => {
      commit(words.filter((w) => w.id !== id));
      if (flippedId === id) setFlippedId(null);
    },
    [commit, flippedId, words],
  );

  /** 切换翻面 */
  const toggleFlip = useCallback((id: string) => {
    setFlippedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" />
            AI 生词本
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            共 {stats.total} 个单词 · 已掌握 {stats.mastered} 个
          </p>
        </div>
        <Badge variant="secondary">本地存储</Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 添加单词 */}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addWord();
            }}
            placeholder="输入英文单词后回车"
            className="h-9 text-sm"
          />
          <Button size="sm" className="h-9 shrink-0" onClick={() => void addWord()} disabled={task.loading}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* AI 生成中 */}
        {task.loading && (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-full" />
          </div>
        )}

        {task.error && !task.loading && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {task.error}
          </p>
        )}

        {/* 单词卡片 */}
        {words.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
            <Sparkles className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">添加第一个单词，开始积累词汇量</p>
          </div>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {words.map((item) => {
                const flipped = flippedId === item.id;
                return (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.18 }}
                  >
                    <div
                      className={cx(
                        'rounded-lg border p-3 transition-colors',
                        flipped ? 'border-primary/50 bg-primary/5' : 'border-border/50 bg-card',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleFlip(item.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{item.word}</span>
                            {item.phonetic && (
                              <span className="truncate text-[0.75rem] text-muted-foreground">
                                {item.phonetic}
                              </span>
                            )}
                          </div>
                          {flipped ? (
                            <div className="mt-1.5 space-y-1.5">
                              {item.meaning && (
                                <p className="text-xs text-foreground/85">{item.meaning}</p>
                              )}
                              {item.example && (
                                <p className="text-[0.75rem] italic text-muted-foreground">{item.example}</p>
                              )}
                              {item.mnemonic && (
                                <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[0.75rem] text-amber-700 dark:text-amber-300">
                                  口诀：{item.mnemonic}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="mt-1 text-[0.75rem] text-muted-foreground">
                              {item.meaning ?? '点击卡片查看释义'}
                            </p>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => removeWord(item.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label="删除单词"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* 掌握程度 */}
                      <div className="mt-2 flex items-center gap-1.5">
                        {(
                          [
                            { value: 0, label: '未学' },
                            { value: 1, label: '模糊' },
                            { value: 2, label: '掌握' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setLevel(item.id, opt.value)}
                            className={cx(
                              'rounded-full border px-2 py-0.5 text-[0.6875rem] transition-colors',
                              item.level === opt.value
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border/60 text-muted-foreground hover:border-primary/50',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => toggleFlip(item.id)}
                          className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground hover:text-primary"
                        >
                          <RotateCcw className="h-3 w-3" />
                          {flipped ? '收起' : '翻面'}
                        </button>
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default VocabularyCard;

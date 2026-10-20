/**
 * 预装插件 · 每日 AI 心情语录卡片
 *
 * 重要约束：本插件**仅作为文本展示**。
 * 严禁调用 ctx.setMode / ctx.setAccent / ctx.applyThemePack，
 * 也严禁以任何方式修改全局主题配色或壁纸。
 * 收藏的语录保存在 ctx.storage（本地），仅影响本插件自身。
 */

'use client';

import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Bookmark, Heart, Quote, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAiTask } from '../hooks';
import { copyToClipboard, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'quote-card',
  name: '每日 AI 心情语录',
  version: '1.0.0',
  description: '由本地 AI 生成一句治愈短句，可复制与收藏，纯文本展示，不影响全局主题。',
  category: '生活',
  author: '智简匣',
  icon: 'Quote',
  preview: '🌿',
  tags: ['语录', '治愈', 'AI'],
  minCoreVersion: '1.0.0',
  builtin: true,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

/** 语录生成的系统提示词 */
const QUOTE_SYSTEM =
  '你是一位温柔的写作者。请生成一句简短、有画面感的治愈系中文短句。' +
  '要求：单句，不超过 30 个字，不使用引号，不署名，不要解释，只输出这一句话本身。';

/** 收藏存储键 */
const STORAGE_KEY = 'favorites';

export function QuoteCard({ ctx }: PluginComponentProps) {
  const task = useAiTask();
  const [favorites, setFavorites] = useState<string[]>(() => ctx.storage.get<string[]>(STORAGE_KEY, []));

  /** 生成一句语录 */
  const generate = useCallback(async () => {
    const text = await task.run(() =>
      runAi(ctx, {
        system: QUOTE_SYSTEM,
        user: '给我一句今天的心情语录。',
        temperature: 0.9,
        maxTokens: 60,
      }),
    );
    if (!text) {
      ctx.notify('语录生成失败，请稍后重试', 'error');
    }
  }, [ctx, task]);

  /** 收藏当前语录 */
  const toggleFavorite = useCallback(() => {
    const current = task.result;
    if (!current) return;
    const exists = favorites.includes(current);
    const next = exists ? favorites.filter((item) => item !== current) : [current, ...favorites];
    setFavorites(next);
    ctx.storage.set(STORAGE_KEY, next);
    ctx.notify(exists ? '已取消收藏' : '已收藏到本机', 'success');
  }, [ctx, favorites, task.result]);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Quote className="h-4 w-4" />
            每日 AI 心情语录
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            纯文本展示 · 已收藏 {favorites.length} 句
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void generate()} disabled={task.loading}>
          {task.loading ? (
            '生成中…'
          ) : (
            <>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              换一句
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 语录主体 */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
          {task.loading ? (
            // 骨架屏占位
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : task.error ? (
            <p className="text-xs text-destructive">{task.error}</p>
          ) : task.result ? (
            <motion.p
              key={task.result}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.22 }}
              className="text-center text-base leading-relaxed text-foreground/90"
            >
              {task.result}
            </motion.p>
          ) : (
            <div className="space-y-2.5">
              <Skeleton className="mx-auto h-4 w-3/5" />
              <Skeleton className="mx-auto h-4 w-2/5" />
            </div>
          )}
        </div>

        {/* 操作 */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void generate()}
            disabled={task.loading}
            className="h-7 text-xs"
          >
            <Sparkles className="mr-1.5 h-3 w-3" />
            换一句
          </Button>
          {task.result && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={async () => {
                  const ok = await copyToClipboard(task.result);
                  ctx.notify(ok ? '语录已复制' : '复制失败', ok ? 'success' : 'error');
                }}
              >
                复制
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={toggleFavorite}
              >
                <Bookmark
                  className="mr-1.5 h-3 w-3"
                  fill={favorites.includes(task.result) ? 'currentColor' : 'none'}
                />
                {favorites.includes(task.result) ? '已收藏' : '收藏'}
              </Button>
            </>
          )}
        </div>

        {/* 收藏列表 */}
        {favorites.length > 0 && (
          <div className="rounded-lg border border-border/50 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Heart className="h-3 w-3" />
              我的收藏
            </p>
            <ul className="space-y-1.5">
              {favorites.map((item) => (
                <li
                  key={item}
                  className="flex items-start justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5"
                >
                  <span className="text-xs leading-relaxed text-foreground/80">{item}</span>
                  <button
                    type="button"
                    className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      const next = favorites.filter((f) => f !== item);
                      setFavorites(next);
                      ctx.storage.set(STORAGE_KEY, next);
                    }}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default QuoteCard;

/**
 * 插件开发模板 —— 复制本文件即可开始开发一个新插件。
 *
 * 使用步骤：
 * 1. 复制为 `src/plugins/downloadable/<your-plugin>.tsx`（或 builtin/ 下的同名文件）
 * 2. 修改 manifest 中的 id / name / version / category / description
 * 3. 实现你的组件，导出 default
 * 4. 若作为「可下载插件」，在 `src/plugins/downloadable/index.ts` 登记；
 *    若作为「预装插件」，在 `src/plugins/builtin/index.ts` 登记
 * 5. 执行 `npm run plugins:build` 打包出 .plugin 文件
 *
 * 关键约束：
 * - 插件**不得**直接 import 全局 zustand store，一切能力通过 ctx 获取
 * - 插件**不得**修改全局主题（除非是主题中心类插件，且必须走 ctx 的写入口）
 * - 所有异步加载场景必须使用骨架屏（@/components/ui/skeleton），禁止转圈 loading
 */

'use client';

import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAiTask } from './hooks';
import { runAi } from './utils';
import type { PluginComponentProps, PluginManifest } from './types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'your-plugin-id', // 全局唯一，kebab-case
  name: '你的插件名称',
  version: '1.0.0', // semver
  description: '一句话说明这个插件做什么。',
  category: '效率', // 用于功能广场分类筛选
  author: '你的名字',
  icon: 'Wand2', // lucide 图标名
  preview: '✨', // 预览缩略图标识
  tags: ['标签1', '标签2'],
  minCoreVersion: '1.0.0', // 最低内核兼容版本
  builtin: false, // 可下载插件填 false
  offline: true, // 是否纯本地（不依赖后端）
};

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export function YourPlugin({ ctx }: PluginComponentProps) {
  const task = useAiTask();
  const [input, setInput] = useState('');

  /** 调用全局 AI 能力（自动按内核配置走本地或后端） */
  const generate = useCallback(async () => {
    const text = await task.run(() =>
      runAi(ctx, {
        system: '你是一个乐于助人的助手。',
        user: input,
        maxTokens: 200,
      }),
    );
    return text;
  }, [ctx, input, task]);

  /** 读取插件私有存储（命名空间自动隔离） */
  const history = ctx.storage.get<string[]>('history', []);

  return (
    <div className="space-y-4">
      {/* 插件头部 */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--zj-accent-soft)] text-[var(--zj-accent)]">
          <Wand2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{manifest.name}</p>
          <p className="text-[11px] text-[var(--zj-muted-fg)]">
            v{manifest.version} · {manifest.category}
          </p>
        </div>
        {ctx.backendOnline ? (
          <Badge variant="success">后端在线</Badge>
        ) : (
          <Badge variant="outline">纯本地</Badge>
        )}
      </div>

      {/* 输入区 */}
      <div className="space-y-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入点什么…"
        />
        <Button
          onClick={() => void generate()}
          disabled={!input.trim() || task.loading}
          className="w-full"
        >
          <Sparkles className="size-3.5" />
          {task.loading ? '生成中…' : '开始生成'}
        </Button>
      </div>

      {/* 加载中：骨架屏（禁止转圈 loading） */}
      {task.loading && (
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {/* 结果 */}
      {task.result && (
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md bg-[var(--zj-muted)] p-3 text-xs leading-relaxed whitespace-pre-wrap"
        >
          {task.result}
        </motion.p>
      )}

      {/* 错误提示：人性化文案，不暴露底层堆栈 */}
      {task.error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {task.error}
        </p>
      )}

      {/* 本地历史 */}
      {history.length > 0 && (
        <div className="text-[11px] text-[var(--zj-muted-fg)]">
          本地已保存 {history.length} 条记录
        </div>
      )}
    </div>
  );
}

export default YourPlugin;

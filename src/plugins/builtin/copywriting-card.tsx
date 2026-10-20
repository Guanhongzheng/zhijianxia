/**
 * 预装插件 · AI 极简文案助手
 *
 * 三种能力：文案生成 / 文字润色 / 内容改写
 * 四种风格：治愈 / 文艺 / 正式 / 简约
 * 基于本地大模型，优先走流式输出，不支持时自动回退为一次性输出。
 */

'use client';

import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAiTask } from '../hooks';
import { copyToClipboard, cx, runAiStream } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'copywriting-card',
  name: 'AI 极简文案助手',
  version: '1.0.0',
  description: '本地大模型驱动的文案生成、润色与改写，支持治愈 / 文艺 / 正式 / 简约四种风格。',
  category: '创作',
  author: '智简匣',
  icon: 'PenLine',
  preview: '✍️',
  tags: ['文案', 'AI', '写作'],
  minCoreVersion: '1.0.0',
  builtin: true,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 常量                                                                        */
/* -------------------------------------------------------------------------- */

/** 三种模式 */
type Mode = 'generate' | 'polish' | 'rewrite';

/** 模式配置 */
const MODES: Array<{ value: Mode; label: string; hint: string; placeholder: string }> = [
  {
    value: 'generate',
    label: '文案生成',
    hint: '描述你想表达的内容与场景，AI 直接产出成稿',
    placeholder: '例如：为一家开在巷子里的深夜面馆写一段朋友圈文案',
  },
  {
    value: 'polish',
    label: '文字润色',
    hint: '粘贴原文，AI 在保持原意的前提下优化表达',
    placeholder: '例如：把这段生硬的自我介绍改得更自然一些',
  },
  {
    value: 'rewrite',
    label: '内容改写',
    hint: '换一种说法重写，适配不同渠道与读者',
    placeholder: '例如：把这封邮件改写成适合发布在社交平台的短文',
  },
];

/** 风格配置 */
const STYLES = [
  { value: 'healing', label: '治愈', desc: '温柔松弛，抚慰人心' },
  { value: 'literary', label: '文艺', desc: '意象细腻，有呼吸感' },
  { value: 'formal', label: '正式', desc: '结构严谨，专业稳重' },
  { value: 'simple', label: '简约', desc: '干净利落，不多余修饰' },
] as const;

/** 各模式的系统提示词 */
const SYSTEM_PROMPTS: Record<Mode, string> = {
  generate:
    '你是一位资深文案写作者。请根据用户描述创作一段完整文案。要求：结构清晰、有画面感，不使用夸张的感叹号堆砌，直接给出成稿正文，不要解释你的创作思路。',
  polish:
    '你是一位文字编辑。请在完全保留原文含义与信息量的前提下优化表达，使语句更通顺、节奏更好。要求：直接输出润色后的完整文本，并保持原有段落结构，不要附加说明。',
  rewrite:
    '你是一位内容编辑。请把用户原文改写成新的表达，保留核心信息与事实，面向更轻松、更易传播的阅读场景。要求：直接输出改写后的完整文本，不要解释改写策略。',
};

/** 风格附加提示 */
const STYLE_PROMPTS: Record<string, string> = {
  healing: '整体语气治愈、温柔、令人放松，多用柔和的意象。',
  literary: '整体语气文艺、有文学质感，注重意象与节奏。',
  formal: '整体语气正式、克制、逻辑清晰，适合正式场合。',
  simple: '整体语气简约、干净、语言精简，去掉一切多余修饰。',
};

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export function CopywritingCard({ ctx }: PluginComponentProps) {
  const [mode, setMode] = useState<Mode>('generate');
  const [style, setStyle] = useState<string>('healing');
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const task = useAiTask();
  const currentMode = MODES.find((m) => m.value === mode) ?? MODES[0];

  /** 执行生成 */
  const generate = useCallback(async () => {
    if (!input.trim()) {
      ctx.notify('请先输入内容', 'error');
      return;
    }
    const system = `${SYSTEM_PROMPTS[mode]}\n${STYLE_PROMPTS[style] ?? ''}`;
    const text = await task.run(() =>
      runAiStream(ctx, { system, user: input }, (chunk) => {
        // 流式增量直接拼接到结果上
        task.setResult(chunk);
      }),
    );
    if (!text) {
      ctx.notify('文案生成失败，请稍后重试', 'error');
    }
  }, [ctx, input, mode, style, task]);

  /** 复制结果 */
  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(task.result);
    ctx.notify(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本', ok ? 'success' : 'error');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }, [ctx, task.result]);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI 极简文案助手
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{currentMode.hint}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 模式切换 */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="w-full">
            {MODES.map((m) => (
              <TabsTrigger key={m.value} value={m.value} className="flex-1 text-xs">
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {MODES.map((m) => (
            <TabsContent key={m.value} value={m.value} className="mt-3 text-xs text-muted-foreground">
              {m.hint}
            </TabsContent>
          ))}
        </Tabs>

        {/* 风格选择 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">风格</span>
          <Select value={style} onValueChange={setStyle}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="选择风格" />
            </SelectTrigger>
            <SelectContent>
              {STYLES.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {STYLES.find((s) => s.value === style)?.desc}
          </span>
        </div>

        {/* 输入区 */}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={currentMode.placeholder}
          className="min-h-24 resize-y text-sm"
        />

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void generate()} disabled={task.loading}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            {task.loading ? '生成中…' : '开始创作'}
          </Button>
          {task.result && !task.loading && (
            <Button size="sm" variant="ghost" onClick={() => void handleCopy()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {copied ? '已复制' : '复制'}
            </Button>
          )}
        </div>

        {/* 输出区 */}
        {task.loading ? (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
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
            className={cx(
              'rounded-lg border border-border/50 bg-muted/30 p-3',
              'whitespace-pre-wrap text-sm leading-relaxed text-foreground/90',
            )}
          >
            {task.result}
          </motion.div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default CopywritingCard;

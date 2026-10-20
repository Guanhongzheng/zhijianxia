/**
 * 可下载插件 · 番茄专注计时器
 *
 * - 25 分钟专注 + 5 分钟休息倒计时，环形进度可视化
 * - 专注时长本地存储（ctx.storage）
 * - 与音乐播放器联动：开始专注时通过 ctx.storage 广播状态，音乐卡片可读取
 * - 「AI 生成专注计划」按钮调用 ctx.ai.chat
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Coffee, ListChecks, Music, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAiTask, useInterval } from '../hooks';
import { formatClock, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'pomodoro',
  name: '番茄专注计时器',
  version: '1.0.0',
  description: '25 分钟专注 + 5 分钟休息的环形计时器，支持 AI 生成专注计划，与音乐播放器联动。',
  category: '效率',
  author: '智简匣',
  icon: 'ListChecks',
  preview: '🍅',
  tags: ['专注', '计时', '效率'],
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 常量                                                                        */
/* -------------------------------------------------------------------------- */

/** 阶段 */
type Phase = 'focus' | 'break';

/** 各阶段默认时长（分钟） */
const DEFAULT_MINUTES: Record<Phase, number> = {
  focus: 25,
  break: 5,
};

/** 存储键 */
const STORAGE_KEY = 'settings';
/** 跨插件联动广播键（音乐播放器监听此键） */
const BROADCAST_KEY = 'shared:pomodoro-state';

/** 广播的专注状态 */
export interface PomodoroBroadcast {
  /** 是否正在专注中 */
  running: boolean;
  /** 当前阶段 */
  phase: Phase;
  /** 时间戳 */
  at: number;
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

/** AI 计划生成的系统提示词 */
const PLAN_SYSTEM =
  '你是一位专注力教练。请根据用户给出的任务，输出一份可执行的专注计划，并以 JSON 数组返回。' +
  '每个元素包含：task（子任务名称，20 字以内）、minutes（预计分钟数，10-45 的整数）、tip（一句执行建议，20 字以内）。' +
  '只输出 JSON 数组，不要解释文字。';

/** 单条计划项 */
interface PlanItem {
  task: string;
  minutes: number;
  tip: string;
}

export function PomodoroCard({ ctx }: PluginComponentProps) {
  const settings = useMemo(
    () =>
      ctx.storage.get<{ focus: number; brk: number }>(STORAGE_KEY, {
        focus: DEFAULT_MINUTES.focus,
        brk: DEFAULT_MINUTES.break,
      }),
    [ctx],
  );

  const [phase, setPhase] = useState<Phase>('focus');
  const [remaining, setRemaining] = useState(settings.focus * 60);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [plan, setPlan] = useState<PlanItem[]>([]);

  const task = useAiTask();
  const audioRef = useRef<{ phase: Phase; running: boolean }>({ phase, running });

  /** 当前阶段的完整秒数 */
  const total = phase === 'focus' ? settings.focus * 60 : settings.brk * 60;

  /** 进度比例（0 ~ 1） */
  const progress = total > 0 ? 1 - remaining / total : 0;

  /** 切换阶段并重置倒计时 */
  const switchPhase = useCallback(
    (next: Phase) => {
      setPhase(next);
      setRemaining(next === 'focus' ? settings.focus * 60 : settings.brk * 60);
      setRunning(false);
    },
    [settings.brk, settings.focus],
  );

  /** 计时器心跳 */
  useInterval(
    () => {
      setRemaining((prev) => {
        if (prev <= 1) {
          // 本轮结束
          if (phase === 'focus') {
            setCompleted((n) => n + 1);
            ctx.notify('专注完成，休息一下吧', 'success');
            setPhase('break');
            setRemaining(settings.brk * 60);
            setRunning(false);
          } else {
            ctx.notify('休息结束，开始下一轮专注', 'success');
            setPhase('focus');
            setRemaining(settings.focus * 60);
            setRunning(false);
          }
          return 0;
        }
        return prev - 1;
      });
    },
    running ? 1000 : null,
  );

  /** 广播专注状态，供音乐播放器联动 */
  useEffect(() => {
    audioRef.current = { phase, running };
    ctx.storage.set(BROADCAST_KEY, { running, phase, at: Date.now() } satisfies PomodoroBroadcast);
  }, [ctx, phase, running]);

  /** 开始 / 暂停 */
  const toggle = useCallback(() => {
    setRunning((prev) => !prev);
  }, []);

  /** 重置当前阶段 */
  const reset = useCallback(() => {
    setRunning(false);
    setRemaining(phase === 'focus' ? settings.focus * 60 : settings.brk * 60);
  }, [phase, settings.brk, settings.focus]);

  /** AI 生成专注计划 */
  const generatePlan = useCallback(async () => {
    const result = await task.run(() =>
      runAi(ctx, {
        system: PLAN_SYSTEM,
        user: '我要完成的任务是：把项目的核心功能写完并自测一遍。请帮我拆解成 3-4 个子任务。',
        temperature: 0.6,
      }),
    );
    if (!result) {
      ctx.notify('专注计划生成失败，请稍后重试', 'error');
      return;
    }
    try {
      const parsed = JSON.parse(result.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim());
      if (Array.isArray(parsed)) {
        setPlan(
          parsed.map((item: Record<string, unknown>) => ({
            task: String(item.task ?? '未命名任务'),
            minutes: Number(item.minutes) || 25,
            tip: String(item.tip ?? ''),
          })),
        );
        ctx.notify('专注计划已生成', 'success');
      }
    } catch {
      ctx.notify('AI 返回内容无法解析', 'error');
    }
  }, [ctx, task]);

  /** 环形进度条 */
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" />
            番茄专注计时器
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {phase === 'focus' ? '专注中' : '休息中'} · 今日已完成 {completed} 轮
          </p>
        </div>
        <Badge variant={phase === 'focus' ? 'default' : 'secondary'}>
          {phase === 'focus' ? '专注' : '休息'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 环形进度 */}
        <div className="flex flex-col items-center">
          <div className="relative h-36 w-36">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                strokeWidth="8"
                className="stroke-muted"
              />
              <motion.circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                stroke="currentColor"
                className={phase === 'focus' ? 'text-primary' : 'text-emerald-500'}
                strokeDasharray={circumference}
                animate={{ strokeDashoffset: circumference * (1 - progress) }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold tabular-nums">{formatClock(remaining)}</span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">
                {phase === 'focus' ? '保持专注' : '放松一下'}
              </span>
            </div>
          </div>

          {/* 控制按钮 */}
          <div className="mt-4 flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={reset} aria-label="重置">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button size="lg" className="px-8" onClick={toggle}>
              {running ? (
                <>
                  <Square className="mr-1.5 h-4 w-4" />
                  暂停
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-4 w-4" />
                  {remaining === total ? '开始' : '继续'}
                </>
              )}
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => switchPhase(phase === 'focus' ? 'break' : 'focus')}
              aria-label="切换阶段"
            >
              <Coffee className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 与音乐播放器联动 */}
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => ctx.openCard('music-player')}
        >
          <Music className="mr-1.5 h-3.5 w-3.5" />
          打开音乐播放器联动
        </Button>

        {/* AI 专注计划 */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">AI 专注计划</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void generatePlan()} disabled={task.loading}>
              <Sparkles className="mr-1 h-3 w-3" />
              {task.loading ? '生成中…' : '生成计划'}
            </Button>
          </div>

          {task.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : plan.length > 0 ? (
            <ul className="space-y-1.5">
              {plan.map((item, index) => (
                <li
                  key={`${item.task}-${index}`}
                  className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/30 p-2.5"
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{item.task}</p>
                    {item.tip && <p className="mt-0.5 text-[10px] text-muted-foreground">{item.tip}</p>}
                  </div>
                  <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                    {item.minutes} 分钟
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border/60 p-3 text-center text-[11px] text-muted-foreground">
              让 AI 帮你把大任务拆成可执行的小步骤
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

export default PomodoroCard;

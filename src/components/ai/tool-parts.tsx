'use client';

/**
 * tool-parts.tsx —— 生成式 UI：把工具调用渲染成对应的结果卡片
 *
 * ## 「生成式 UI」在本项目里的含义
 *
 * AI SDK 的消息 `parts` 里，工具调用是一个 `tool-<name>` part，
 * 带着完整的生命周期状态：`input-available`（参数已到）→
 * `output-available`（结果已回）/ `output-error`（执行失败）。
 *
 * 常规做法是让模型返回一个「组件名 + props」，前端再动态渲染。
 * 本项目走的是更可靠的一条路：**工具名直接对应一个真实的 React 组件**。
 * 好处是
 * - 类型完全确定，模型幻觉出一个不存在的组件名时无处可渲染；
 * - 工具执行与 UI 渲染共用同一份 schema（`shared/ai-tools.json`），
 *   不会出现「模型按 A 格式给参数，界面按 B 格式渲染」的对不齐。
 *
 * 每个卡片都是「所见即所得」的结果展示：
 * 计算器给算式与结果，时间给时钟格式，换算给对照，统计给字数分布，随机数给骰子。
 */

import { useMemo, useState } from 'react';
import {
  Calculator,
  Check,
  ClipboardList,
  Clock,
  Copy,
  Dices,
  Ruler,
  TextCursorInput,
  Wrench,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toolDescriptor } from '@/lib/ai/sdk/tools';
import type { ToolUIPart } from 'ai';

/* -------------------------------------------------------------------------- */
/* 展示用的格式化小工具                                                          */
/* -------------------------------------------------------------------------- */

/** 数值千分位；非有限数原样返回 */
function formatNumber(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  if (Number.isInteger(num)) return num.toLocaleString('zh-CN');
  return num.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
}

/** 键名 → 中文标签（工具输出的字段都是英文 key） */
const FIELD_LABELS: Record<string, string> = {
  expression: '算式',
  result: '结果',
  timezone: '时区',
  iso: 'ISO 时间',
  date: '日期',
  time: '时间',
  weekday: '星期',
  display: '本地时间',
  from: '源单位',
  to: '目标单位',
  value: '原值',
  characters: '字符数',
  charactersNoSpace: '字符数（不含空格）',
  words: '词数',
  lines: '行数',
  paragraphs: '段落数',
  cjk: '中日韩字符',
  latin: '西文词',
  min: '最小值',
  max: '最大值',
  title: '标题',
  period: '周期',
  highlights: '完成事项',
  risks: '风险',
  next: '下周计划',
};

/** 参与「结果高亮」的字段顺序（优先展示） */
const PRIMARY_FIELDS = ['result', 'display', 'date', 'words', 'characters'];

/** 容器 class：所有工具卡片统一走 .zj-card（主题包可全局改） */
const CARD_CLASS = 'zj-card zj-card-soft px-3.5 py-3';

/* -------------------------------------------------------------------------- */
/* 各工具的结果视图                                                             */
/* -------------------------------------------------------------------------- */

type ToolOutput = Record<string, unknown>;

/** 计算器：算式 + 大号结果 */
function CalculatorResult({ output }: { output: ToolOutput }) {
  return (
    <div className="flex items-baseline gap-3">
      <code className="rounded-md bg-[var(--zj-muted-fg)]/10 px-2 py-1 font-mono text-sm text-[var(--zj-muted-fg)]">
        {String(output.expression ?? '')}
      </code>
      <span className="text-2xl font-semibold tabular-nums text-[var(--zj-fg)]">
        {formatNumber(output.result)}
      </span>
    </div>
  );
}

/** 时间：日期 + 时间 + 星期 */
function TimeResult({ output }: { output: ToolOutput }) {
  return (
    <div className="space-y-1">
      <div className="text-lg font-semibold tabular-nums text-[var(--zj-fg)]">
        {String(output.date ?? '')} {String(output.time ?? '')}
        {output.weekday ? (
          <span className="ml-2 text-sm font-normal text-[var(--zj-muted-fg)]">
            {String(output.weekday)}
          </span>
        ) : null}
      </div>
      {output.timezone ? (
        <p className="text-xs text-[var(--zj-muted-fg)]">时区：{String(output.timezone)}</p>
      ) : null}
    </div>
  );
}

/** 单位换算：源值 → 目标值的等式 */
function ConvertResult({ output }: { output: ToolOutput }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="tabular-nums text-[var(--zj-muted-fg)]">
        {formatNumber(output.value)} {String(output.from ?? '')}
      </span>
      <span className="text-[var(--zj-muted-fg)]">→</span>
      <span className="text-xl font-semibold tabular-nums text-[var(--zj-fg)]">
        {formatNumber(output.result)} {String(output.to ?? '')}
      </span>
    </div>
  );
}

/** 文本统计：几个数字块 */
function StatsResult({ output }: { output: ToolOutput }) {
  const items = [
    { label: '字符数', value: output.characters },
    { label: '词数', value: output.words },
    { label: '行数', value: output.lines },
    { label: '段落数', value: output.paragraphs },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-md bg-[var(--zj-muted-fg)]/10 px-2.5 py-2">
          <p className="text-[11px] text-[var(--zj-muted-fg)]">{item.label}</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--zj-fg)]">
            {formatNumber(item.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

/** 随机数：区间 + 结果 */
function RandomResult({ output }: { output: ToolOutput }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[var(--zj-muted-fg)]">
        区间 [{formatNumber(output.min)} , {formatNumber(output.max)}]
      </span>
      <span className="text-2xl font-semibold tabular-nums text-[var(--zj-fg)]">
        {formatNumber(output.result)}
      </span>
    </div>
  );
}

/**
 * 周报：「一句话 → 结构化卡片」的落地形态。
 *
 * 这个视图是整条链路的终点 —— 模型不再吐一段带 markdown 的文本，
 * 而是给出结构，由界面决定怎么排。所以这里除了排版，还提供
 * **复制为 Markdown**：用户真正要的是能粘进日报系统的那份文本。
 */
function ReportSection({
  label,
  items,
  dotClass,
}: {
  label: string;
  items: string[];
  dotClass: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium tracking-wide text-[var(--zj-muted-fg)]">
        {label}（{items.length}）
      </p>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li key={idx} className="flex gap-1.5 text-xs leading-relaxed text-[var(--zj-fg)]">
            <span className={cn('mt-[5px] size-1 shrink-0 rounded-full', dotClass)} />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WeeklyReportResult({ output }: { output: ToolOutput }) {
  const title = String(output.title ?? '');
  const period = String(output.period ?? '');
  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const highlights = asList(output.highlights);
  const risks = asList(output.risks);
  const next = asList(output.next);
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(() => {
    const section = (label: string, items: string[]) =>
      items.length > 0 ? [`## ${label}`, ...items.map((i) => `- ${i}`), ''] : [];
    return [
      `# ${title}`,
      period ? `> ${period}` : '',
      '',
      ...section('本周完成', highlights),
      ...section('风险与阻塞', risks),
      ...section('下周计划', next),
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n')
      .trim();
  }, [title, period, highlights, risks, next]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板在非安全上下文 / 权限被拒时不可用，静默降级即可
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--zj-fg)]">{title}</p>
        {period ? (
          <p className="mt-0.5 text-[11px] text-[var(--zj-muted-fg)]">{period}</p>
        ) : null}
      </div>

      <ReportSection label="本周完成" items={highlights} dotClass="bg-[var(--zj-accent)]" />
      <ReportSection label="风险与阻塞" items={risks} dotClass="bg-amber-500" />
      <ReportSection label="下周计划" items={next} dotClass="bg-[var(--zj-muted-fg)]" />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 zj-surface px-2 py-1 text-[11px] text-[var(--zj-muted-fg)] transition-colors hover:bg-[var(--zj-muted)] hover:text-[var(--zj-fg)]"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制 Markdown'}
        </button>
      </div>
    </div>
  );
}

/** 工具名 → 结果组件 */
const RESULT_VIEWS: Record<string, (props: { output: ToolOutput }) => React.ReactElement> = {
  calculator: CalculatorResult,
  currentTime: TimeResult,
  unitConvert: ConvertResult,
  textStats: StatsResult,
  randomNumber: RandomResult,
  weeklyReport: WeeklyReportResult,
};

/* -------------------------------------------------------------------------- */
/* 兜底视图：把任意字段渲染成键值表                                              */
/* -------------------------------------------------------------------------- */

function GenericResult({ output }: { output: ToolOutput }) {
  const rows = useMemo(
    () =>
      Object.entries(output)
        .filter(([key]) => key !== 'input')
        .sort(([a], [b]) => {
          const ai = PRIMARY_FIELDS.indexOf(a);
          const bi = PRIMARY_FIELDS.indexOf(b);
          if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          return a.localeCompare(b);
        }),
    [output],
  );

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-[var(--zj-muted-fg)]">{FIELD_LABELS[key] ?? key}</dt>
          <dd className="truncate tabular-nums text-[var(--zj-fg)]">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* 主组件                                                                       */
/* -------------------------------------------------------------------------- */

export interface ToolPartViewProps {
  part: ToolUIPart;
}

/**
 * 渲染单个工具 part。
 *
 * 状态语义（AI SDK v7）：
 * - `input-streaming` —— 参数还在流式接收
 * - `input-available` —— 参数齐了，等工具返回
 * - `output-available` —— 有结果，渲染结果卡片
 * - `output-error` —— 工具抛错，显示错误
 */
export function ToolPartView({ part }: ToolPartViewProps) {
  const { state } = part;
  const descriptor = toolDescriptor(part.type.replace(/^tool-/, ''));
  const toolName = part.type.replace(/^tool-/, '');
  const Icon = descriptor ? ICON_MAP[descriptor.icon] : Wrench;

  // 执行中 / 等待结果：显示参数摘要 + 转圈
  if (state === 'input-streaming' || state === 'input-available') {
    const input = (part.input ?? {}) as ToolOutput;
    const summary =
      Object.entries(input)
        .map(([k, v]) => `${FIELD_LABELS[k] ?? k}=${typeof v === 'object' ? '…' : String(v)}`)
        .join('，') || '正在准备参数';

    return (
      <div className={cn(CARD_CLASS, 'flex items-center gap-2.5')}>
        <Loader2 className="size-4 shrink-0 animate-spin text-[var(--zj-muted-fg)]" />
        <Icon className="size-4 shrink-0 text-[var(--zj-muted-fg)]" />
        <span className="truncate text-sm text-[var(--zj-muted-fg)]">
          {descriptor?.description.slice(0, 40) ?? toolName} · {summary}
        </span>
      </div>
    );
  }

  // 工具执行失败
  if (state === 'output-error') {
    return (
      <div className={cn(CARD_CLASS, 'flex items-start gap-2.5 border-[var(--zj-danger)]/40')}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--zj-danger)]" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--zj-fg)]">
            {descriptor?.name ?? toolName} 执行失败
          </p>
          <p className="mt-0.5 break-words text-xs text-[var(--zj-muted-fg)]">
            {String(part.errorText ?? '未知错误')}
          </p>
        </div>
      </div>
    );
  }

  // 有结果：按工具名选专用视图，命中不了则用通用键值表
  const output = (part.output ?? {}) as ToolOutput;
  const View = RESULT_VIEWS[toolName] ?? GenericResult;

  return (
    <div className={CARD_CLASS}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-[var(--zj-accent)]" />
        <span className="text-[11px] font-medium tracking-wide text-[var(--zj-muted-fg)]">
          {descriptor?.name ?? toolName}
        </span>
      </div>
      <View output={output} />
    </div>
  );
}

/** shared/ai-tools.json 里 icon 字段（lucide 名）→ 组件 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Calculator,
  ClipboardList,
  Clock,
  Dices,
  Ruler,
  TextCursorInput,
};
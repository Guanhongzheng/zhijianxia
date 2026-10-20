/**
 * 可下载插件 · 单位换算小工具
 *
 * 自然语言提问 -> AI 识别语义并完成长度 / 重量 / 温度等换算。
 * 同时提供本地确定性换算表，AI 不可用时仍可完成常见换算（纯本地兜底）。
 */

'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Calculator, RefreshCw, Ruler, Sparkles, Thermometer, Weight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAiTask } from '../hooks';
import { cx, formatNumber, parseJsonLoose, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'unit-converter',
  name: '单位换算小工具',
  version: '1.0.0',
  description: '用自然语言提问即可完成长度、重量、温度等单位换算，AI 识别语义，本地兜底换算表应对离线。',
  category: '工具',
  author: '智简匣',
  icon: 'Calculator',
  preview: '🧮',
  tags: ['换算', '工具', 'AI'],
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 本地换算表（AI 不可用时的确定性兜底）                                        */
/* -------------------------------------------------------------------------- */

/** 换算类别 */
type Category = 'length' | 'weight' | 'temperature';

/** 单位定义：相对基准单位的倍率（温度单独处理） */
interface UnitDef {
  /** 单位符号 */
  symbol: string;
  /** 名称 */
  name: string;
  /** 相对于基准单位的倍率 */
  factor: number;
}

/** 各类别的单位表 */
const UNITS: Record<Category, UnitDef[]> = {
  length: [
    { symbol: 'mm', name: '毫米', factor: 0.001 },
    { symbol: 'cm', name: '厘米', factor: 0.01 },
    { symbol: 'm', name: '米', factor: 1 },
    { symbol: 'km', name: '千米', factor: 1000 },
    { symbol: 'inch', name: '英寸', factor: 0.0254 },
    { symbol: 'ft', name: '英尺', factor: 0.3048 },
    { symbol: 'mile', name: '英里', factor: 1609.344 },
    { symbol: '里', name: '市里', factor: 500 },
    { symbol: '尺', name: '市尺', factor: 1 / 3 },
  ],
  weight: [
    { symbol: 'g', name: '克', factor: 0.001 },
    { symbol: 'kg', name: '千克', factor: 1 },
    { symbol: 't', name: '吨', factor: 1000 },
    { symbol: 'mg', name: '毫克', factor: 0.000001 },
    { symbol: 'lb', name: '磅', factor: 0.45359237 },
    { symbol: 'oz', name: '盎司', factor: 0.028349523125 },
    { symbol: '斤', name: '市斤', factor: 0.5 },
    { symbol: '两', name: '市两', factor: 0.05 },
  ],
  temperature: [
    { symbol: 'C', name: '摄氏度', factor: 1 },
    { symbol: 'F', name: '华氏度', factor: 1 },
    { symbol: 'K', name: '开尔文', factor: 1 },
  ],
};

/** 单位符号别名（含中文） */
const SYMBOL_ALIASES: Record<string, { category: Category; symbol: string }> = (() => {
  const map: Record<string, { category: Category; symbol: string }> = {};
  for (const [category, list] of Object.entries(UNITS) as Array<[Category, UnitDef[]]>) {
    for (const unit of list) {
      map[unit.symbol.toLowerCase()] = { category, symbol: unit.symbol };
      map[unit.name] = { category, symbol: unit.symbol };
    }
  }
  // 常见别名
  map['公斤'] = { category: 'weight', symbol: 'kg' };
  map['千克'] = { category: 'weight', symbol: 'kg' };
  map['克'] = { category: 'weight', symbol: 'g' };
  map['米'] = { category: 'length', symbol: 'm' };
  map['厘米'] = { category: 'length', symbol: 'cm' };
  map['毫米'] = { category: 'length', symbol: 'mm' };
  map['公里'] = { category: 'length', symbol: 'km' };
  map['千米'] = { category: 'length', symbol: 'km' };
  map['摄氏度'] = { category: 'temperature', symbol: 'C' };
  map['华氏度'] = { category: 'temperature', symbol: 'F' };
  map['开尔文'] = { category: 'temperature', symbol: 'K' };
  return map;
})();

/**
 * 温度换算（线性倍率无法处理，统一走公式）。
 */
function convertTemperature(value: number, from: string, to: string): number {
  const toCelsius = (v: number, unit: string): number => {
    if (unit === 'F') return ((v - 32) * 5) / 9;
    if (unit === 'K') return v - 273.15;
    return v;
  };
  const fromCelsius = (v: number, unit: string): number => {
    if (unit === 'F') return (v * 9) / 5 + 32;
    if (unit === 'K') return v + 273.15;
    return v;
  };
  return fromCelsius(toCelsius(value, from), to);
}

/**
 * 本地确定性换算。
 * 从自然语言里抽取数字与两个单位。
 */
export function localConvert(
  question: string,
): { ok: true; value: number; from: string; to: string; result: number } | { ok: false; reason: string } {
  const numbers = question.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) {
    return { ok: false, reason: '没有识别到数值' };
  }
  const value = Number.parseFloat(numbers[0]);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: '数值无法解析' };
  }

  // 找到文本中出现的单位符号
  const found: Array<{ category: Category; symbol: string; index: number }> = [];
  for (const [alias, info] of Object.entries(SYMBOL_ALIASES)) {
    const index = question.toLowerCase().indexOf(alias.toLowerCase());
    if (index >= 0) {
      found.push({ ...info, index });
    }
  }
  if (found.length === 0) {
    return { ok: false, reason: '没有识别到单位' };
  }
  // 按出现位置排序，取前两个不同类别的单位
  found.sort((a, b) => a.index - b.index);
  const unique = found.filter(
    (item, i, arr) => arr.findIndex((x) => x.symbol === item.symbol) === i,
  );
  if (unique.length < 2) {
    return { ok: false, reason: '需要两个单位才能换算' };
  }

  const from = unique[0];
  const to = unique[1];
  let result: number;
  if (from.category === 'temperature' && to.category === 'temperature') {
    result = convertTemperature(value, from.symbol, to.symbol);
  } else if (from.category === 'temperature' || to.category === 'temperature') {
    return { ok: false, reason: '温度只能与温度单位互相换算' };
  } else {
    const fromUnit = UNITS[from.category].find((u) => u.symbol === from.symbol);
    const toUnit = UNITS[to.category].find((u) => u.symbol === to.symbol);
    if (!fromUnit || !toUnit) {
      return { ok: false, reason: '单位信息不完整' };
    }
    result = (value * fromUnit.factor) / toUnit.factor;
  }

  return { ok: true, value, from: from.symbol, to: to.symbol, result };
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

/** AI 换算的系统提示词 */
const CONVERT_SYSTEM =
  '你是一位单位换算助手。请分析用户的换算需求，识别数值、源单位与目标单位，完成换算，并以 JSON 对象返回。' +
  '字段要求：value（原数值）、from（源单位符号，使用国际标准符号，如 m、km、kg、g、lb、C、F、K）、' +
  'to（目标单位符号）、result（换算结果数值，保留合理精度）、note（一句换算说明，20 字以内）。' +
  '只输出 JSON 对象，不要解释文字。';

/** 常用示例 */
const EXAMPLES = ['3.5 公里等于多少米', '100 摄氏度等于多少华氏度', '2.5 斤是多少克', '72 英寸是多少厘米'];

export function UnitConverterCard({ ctx }: PluginComponentProps) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<{
    value: number;
    from: string;
    to: string;
    result: number;
    note?: string;
  } | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const task = useAiTask();

  /** 分类图标 */
  const categoryIcon = useMemo(() => {
    const from = result?.from?.toLowerCase() ?? '';
    if (['c', 'f', 'k'].includes(from)) return Thermometer;
    if (['kg', 'g', 't', 'mg', 'lb', 'oz', '斤', '两'].includes(from)) return Weight;
    return Ruler;
  }, [result]);

  /** 执行换算 */
  const convert = useCallback(async () => {
    const text = question.trim();
    if (!text) {
      ctx.notify('请先输入需要换算的内容', 'error');
      return;
    }

    const aiResult = await task.run(() =>
      runAi(ctx, {
        system: CONVERT_SYSTEM,
        user: text,
        temperature: 0.1,
      }),
    );

    if (aiResult) {
      const parsed = parseJsonLoose<{
        value?: number;
        from?: string;
        to?: string;
        result?: number;
        note?: string;
      }>(aiResult);
      if (parsed && typeof parsed.value === 'number' && typeof parsed.result === 'number') {
        setResult({
          value: parsed.value,
          from: String(parsed.from ?? ''),
          to: String(parsed.to ?? ''),
          result: parsed.result,
          note: typeof parsed.note === 'string' ? parsed.note : undefined,
        });
        setUsedFallback(false);
        return;
      }
    }

    // AI 不可用或解析失败 -> 使用本地确定性换算兜底
    const fallback = localConvert(text);
    if (fallback.ok) {
      setResult({
        value: fallback.value,
        from: fallback.from,
        to: fallback.to,
        result: fallback.result,
        note: '由本地换算表计算',
      });
      setUsedFallback(true);
      ctx.notify('AI 暂不可用，已使用本地换算表完成计算', 'info');
    } else {
      setResult(null);
      setUsedFallback(false);
      ctx.notify(`无法完成换算：${fallback.reason}`, 'error');
    }
  }, [ctx, question, task]);

  const Icon = categoryIcon;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4" />
          单位换算小工具
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">用一句话提问，例如「3.5 公里等于多少米」</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 输入 */}
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void convert();
            }}
            placeholder="输入换算需求"
            className="h-9 text-sm"
          />
          <Button size="sm" className="h-9 shrink-0" onClick={() => void convert()} disabled={task.loading}>
            {task.loading ? (
              '换算中…'
            ) : (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                换算
              </>
            )}
          </Button>
        </div>

        {/* 示例 */}
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuestion(example)}
              className="rounded-full border border-border/60 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              {example}
            </button>
          ))}
        </div>

        {/* 结果 */}
        {task.loading ? (
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : result ? (
          <motion.div
            key={`${result.value}-${result.from}-${result.to}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="rounded-lg border border-border/50 bg-muted/30 p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">换算结果</span>
              {usedFallback && (
                <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
                  本地换算
                </Badge>
              )}
            </div>
            <p className="text-lg font-semibold tabular-nums">
              {formatNumber(result.value, 4)}
              <span className="mx-1 text-sm text-muted-foreground">{result.from}</span>
              =
              <span className="mx-1 text-sm text-muted-foreground">{result.to}</span>
              {formatNumber(result.result, 6)}
            </p>
            {result.note && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">{result.note}</p>
            )}
          </motion.div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
            <Sparkles className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">输入问题即可获得换算结果</p>
          </div>
        )}

        {/* 单位速查 */}
        <Tabs defaultValue="length">
          <TabsList className="w-full">
            <TabsTrigger value="length" className="flex-1 text-xs">
              长度
            </TabsTrigger>
            <TabsTrigger value="weight" className="flex-1 text-xs">
              重量
            </TabsTrigger>
            <TabsTrigger value="temperature" className="flex-1 text-xs">
              温度
            </TabsTrigger>
          </TabsList>
          {(['length', 'weight', 'temperature'] as Category[]).map((category) => (
            <TabsContent key={category} value={category} className="mt-2">
              <div className="flex flex-wrap gap-1.5">
                {UNITS[category].map((unit) => (
                  <span
                    key={unit.symbol}
                    className={cx(
                      'rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground',
                    )}
                  >
                    {unit.symbol} · {unit.name}
                  </span>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default UnitConverterCard;

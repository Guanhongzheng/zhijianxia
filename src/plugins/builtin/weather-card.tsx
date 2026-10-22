/**
 * 预装插件 · AI 智能天气随行卡片
 *
 * 特点：
 * - 纯本地运行：天气数据由内置的确定性 mock 生成器产出（同一城市结果稳定）
 * - AI 只负责「根据天气给出穿搭与出行建议」，不负责取数
 * - 页面背景随天气状态动态适配
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CloudSun, Droplets, MapPin, RefreshCw, Sparkles, Wind } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAiTask } from '../hooks';
import { cx, runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'weather-card',
  name: 'AI 智能天气随行',
  version: '1.0.0',
  description: '本地模拟实时天气，并由 AI 结合温湿度与风力给出穿搭与出行建议，背景随天气自适应。',
  category: '生活',
  author: '智简匣',
  icon: 'CloudSun',
  preview: '⛅',
  tags: ['天气', 'AI', '出行'],
  minCoreVersion: '1.0.0',
  builtin: true,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 天气模拟器                                                                  */
/* -------------------------------------------------------------------------- */

/** 天气状态 */
export type WeatherCondition = 'sunny' | 'cloudy' | 'overcast' | 'rain' | 'snow' | 'windy';

/** 模拟天气数据 */
export interface MockWeather {
  condition: WeatherCondition;
  /** 天气中文描述 */
  label: string;
  /** 温度（摄氏度） */
  temperature: number;
  /** 湿度（百分比） */
  humidity: number;
  /** 风力等级 */
  windLevel: number;
  /** 风力描述 */
  windText: string;
}

/** 可选城市 */
const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京', '厦门'];

/** 字符串稳定哈希，保证同一城市永远得到同一份天气 */
function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** 天气状态对应的展示信息 */
const CONDITION_META: Record<WeatherCondition, { label: string; emoji: string; bg: string }> = {
  sunny: { label: '晴', emoji: '☀️', bg: 'from-amber-100 via-orange-50 to-yellow-50' },
  cloudy: { label: '多云', emoji: '⛅', bg: 'from-sky-100 via-blue-50 to-cyan-50' },
  overcast: { label: '阴', emoji: '☁️', bg: 'from-slate-100 via-slate-50 to-zinc-50' },
  rain: { label: '小雨', emoji: '🌧️', bg: 'from-slate-200 via-blue-100 to-indigo-50' },
  snow: { label: '雪', emoji: '❄️', bg: 'from-slate-100 via-sky-50 to-indigo-50' },
  windy: { label: '大风', emoji: '💨', bg: 'from-teal-100 via-cyan-50 to-emerald-50' },
};

const WIND_TEXTS = ['无风', '微风', '和风', '清劲风', '强风'];

/**
 * 依据城市名确定性地生成天气数据。
 * 纯本地计算，无需任何网络请求。
 */
export function mockWeather(city: string, daySalt = 0): MockWeather {
  const seed = hashString(`${city}#${daySalt}`);
  const conditions: WeatherCondition[] = ['sunny', 'cloudy', 'overcast', 'rain', 'snow', 'windy'];
  const condition = conditions[seed % conditions.length];

  // 温度：5 ~ 33 度
  const temperature = 5 + (seed % 29);
  // 湿度：30 ~ 92
  const humidity = 30 + ((seed >> 3) % 63);
  // 风力：0 ~ 4 级
  const windLevel = (seed >> 6) % 5;

  return {
    condition,
    label: CONDITION_META[condition].label,
    temperature,
    humidity,
    windLevel,
    windText: WIND_TEXTS[windLevel] ?? '微风',
  };
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

/** AI 建议的系统提示词 */
const ADVICE_SYSTEM =
  '你是一位贴心的生活助理。请根据用户提供的城市、天气、温度、湿度与风力，给出简洁的穿搭与出行建议。' +
  '输出要求：先用一句话概括体感，再用「穿搭建议」和「出行提醒」两个小标题分点说明，总字数控制在 120 字以内，使用中文。';

export function WeatherCard({ ctx }: PluginComponentProps) {
  const [city, setCity] = useState('杭州');
  const [daySalt, setDaySalt] = useState(() => Math.floor(Date.now() / 86_400_000));
  const advice = useAiTask();

  const weather = useMemo(() => mockWeather(city, daySalt), [city, daySalt]);

  const meta = CONDITION_META[weather.condition];

  /** 请求 AI 生成穿搭与出行建议 */
  const generateAdvice = useCallback(async () => {
    const text = await advice.run(() =>
      runAi(ctx, {
        system: ADVICE_SYSTEM,
        user: `城市：${city}\n天气：${weather.label}\n温度：${weather.temperature}℃\n湿度：${weather.humidity}%\n风力：${weather.windText}（${weather.windLevel} 级）`,
      }),
    );
    if (!text) {
      ctx.notify(advice.error || '天气建议生成失败', 'error');
    }
  }, [advice, ctx, city, weather]);

  // 首次进入自动生成一次
  useEffect(() => {
    void generateAdvice();
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 切换城市 */
  const switchCity = useCallback(
    (next: string) => {
      setCity(next);
      advice.reset();
    },
    [advice],
  );

  return (
    <Card
      className={cx(
        'overflow-hidden border-border/60 shadow-sm transition-colors duration-500',
        'bg-gradient-to-br',
        meta.bg,
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudSun className="h-4 w-4 shrink-0" />
            AI 智能天气随行
          </CardTitle>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {city} · {meta.emoji} {weather.label}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0 bg-background/70">
          离线模拟
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 城市切换 */}
        <div className="flex flex-wrap gap-1.5">
          {CITIES.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={item === city ? 'default' : 'outline'}
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => switchCity(item)}
            >
              {item}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-full px-2 text-xs"
            onClick={() => {
              setDaySalt((n) => n + 1);
              advice.reset();
            }}
            title="刷新天气"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {/* 天气数据 */}
        <motion.div
          key={`${city}-${daySalt}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          className="flex flex-wrap items-center gap-4"
        >
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-semibold tabular-nums">{weather.temperature}</span>
            <span className="text-base text-muted-foreground">℃</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Droplets className="h-3.5 w-3.5" />
              湿度 {weather.humidity}%
            </span>
            <span className="inline-flex items-center gap-1">
              <Wind className="h-3.5 w-3.5" />
              {weather.windText}
            </span>
          </div>
        </motion.div>

        {/* AI 建议 */}
        <div className="rounded-lg border border-border/50 bg-background/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5" />
              穿搭与出行建议
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => void generateAdvice()}
              disabled={advice.loading}
            >
              {advice.loading ? '生成中…' : '重新生成'}
            </Button>
          </div>

          {advice.loading ? (
            // 骨架屏：不用转圈 spinner
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ) : advice.error ? (
            <p className="text-xs text-destructive">{advice.error}</p>
          ) : (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85"
            >
              {advice.result}
            </motion.p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default WeatherCard;

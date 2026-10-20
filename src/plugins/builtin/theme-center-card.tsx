/**
 * 预装插件 · 全局主题中心
 *
 * 这是**唯一**允许写入全局主题的插件：
 * - ctx.setMode('light' | 'dark')    切换明暗模式
 * - ctx.setAccent('#rrggbb')         设置主色调
 * - ctx.applyThemePack(packId)       套用内置主题包
 *
 * 插件自身通过 ctx.theme 只读地获取当前生效值（mode / accent / packId），
 * 主题的实际写入与持久化由内核（src/lib/theme）负责。
 */

'use client';

import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Moon, Palette, Sun, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { usePluginTheme } from '../hooks';
import { cx } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

/* -------------------------------------------------------------------------- */
/* 清单                                                                        */
/* -------------------------------------------------------------------------- */

export const manifest: PluginManifest = {
  id: 'theme-center-card',
  name: '全局主题中心',
  version: '1.0.0',
  description: '统一切换亮暗模式、内置主题包与自定义主色调，主题写入由内核统一处理。',
  category: '设置',
  author: '智简匣',
  icon: 'Palette',
  preview: '🎨',
  tags: ['主题', '外观', '设置'],
  minCoreVersion: '1.0.0',
  builtin: true,
  offline: true,
};

/* -------------------------------------------------------------------------- */
/* 常量                                                                        */
/* -------------------------------------------------------------------------- */

/** 预设主色调 */
const PRESET_ACCENTS = [
  '#0ea5a4',
  '#8b5cf6',
  '#16a34a',
  '#f59e0b',
  '#3b82f6',
  '#ec4899',
  '#ef4444',
  '#64748b',
];

/** 十六进制颜色合法性校验 */
const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export function ThemeCenterCard({ ctx }: PluginComponentProps) {
  const theme = usePluginTheme(ctx);
  const [customAccent, setCustomAccent] = useState('#0ea5a4');
  const [customInput, setCustomInput] = useState('');

  /** 切换明暗模式 */
  const toggleMode = useCallback(
    (mode: 'light' | 'dark') => {
      ctx.setMode(mode);
      ctx.notify(mode === 'dark' ? '已切换到深色模式' : '已切换到浅色模式', 'success');
    },
    [ctx],
  );

  /** 设置主色调 */
  const applyAccent = useCallback(
    (hex: string) => {
      if (!HEX_PATTERN.test(hex)) {
        ctx.notify('颜色格式不正确，请使用 #RRGGBB 格式', 'error');
        return;
      }
      ctx.setAccent(hex);
      ctx.notify('主色调已更新', 'success');
    },
    [ctx],
  );

  /** 套用主题包 */
  const applyPack = useCallback(
    (packId: string) => {
      ctx.applyThemePack(packId);
      ctx.notify('主题包已应用', 'success');
    },
    [ctx],
  );

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-4 w-4" />
          全局主题中心
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          当前：{theme.mode === 'dark' ? '深色' : '浅色'}模式 · 主色 {theme.accent}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 明暗模式 */}
        <section>
          <p className="mb-2 text-xs font-medium text-muted-foreground">显示模式</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={theme.mode === 'light' ? 'default' : 'outline'}
              size="sm"
              className="justify-start"
              onClick={() => toggleMode('light')}
            >
              <Sun className="mr-1.5 h-3.5 w-3.5" />
              浅色
              {theme.mode === 'light' && <Check className="ml-auto h-3.5 w-3.5" />}
            </Button>
            <Button
              variant={theme.mode === 'dark' ? 'default' : 'outline'}
              size="sm"
              className="justify-start"
              onClick={() => toggleMode('dark')}
            >
              <Moon className="mr-1.5 h-3.5 w-3.5" />
              深色
              {theme.mode === 'dark' && <Check className="ml-auto h-3.5 w-3.5" />}
            </Button>
          </div>
        </section>

        {/* 主题包 */}
        <section>
          <p className="mb-2 text-xs font-medium text-muted-foreground">内置主题包</p>
          {theme.packs.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {theme.packs.map((pack) => {
                const active = theme.packId === pack.id;
                return (
                  <motion.button
                    key={pack.id}
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => applyPack(pack.id)}
                    className={cx(
                      'flex items-center gap-2 rounded-lg border p-2 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-border/60 hover:border-primary/50',
                    )}
                  >
                    <span
                      className="h-6 w-6 shrink-0 rounded-full border border-border/40"
                      style={{ background: `linear-gradient(135deg, ${pack.accent}, ${pack.tokens?.secondary ?? pack.accent})` }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{pack.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {pack.description}
                      </span>
                    </span>
                    {active && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
                  </motion.button>
                );
              })}
            </div>
          )}
        </section>

        {/* 自定义主色 */}
        <section>
          <p className="mb-2 text-xs font-medium text-muted-foreground">自定义主色调</p>
          <div className="flex flex-wrap gap-2">
            {PRESET_ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => applyAccent(color)}
                className={cx(
                  'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                  theme.accent.toLowerCase() === color.toLowerCase()
                    ? 'border-foreground'
                    : 'border-transparent',
                )}
                style={{ backgroundColor: color }}
                aria-label={`使用主色 ${color}`}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Input
              type="color"
              value={customAccent}
              onChange={(e) => setCustomAccent(e.target.value)}
              className="h-9 w-14 shrink-0 cursor-pointer p-1"
              aria-label="选择颜色"
            />
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="#0ea5a4"
              className="h-9 flex-1 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() => {
                applyAccent(customInput);
                if (HEX_PATTERN.test(customInput)) setCustomInput('');
              }}
            >
              <Wand2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

export default ThemeCenterCard;

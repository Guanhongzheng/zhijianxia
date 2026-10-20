'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useThemeStore } from '@/store/theme-store';
import { useAppStore } from '@/store/app-store';
import { DENSITY_OPTIONS } from '@/lib/theme/density';
import { cn } from '@/lib/utils';

/**
 * 个性化设置 —— 主题包、亮暗模式、主色调与界面大小。
 * 原「全局主题中心」插件的功能已并入此处。
 */
export function PersonalizationSettings() {
  const packs = useThemeStore((s) => s.packs);
  const activePackId = useThemeStore((s) => s.activePackId);
  const applyThemePack = useThemeStore((s) => s.applyThemePack);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const setAccent = useThemeStore((s) => s.setAccent);
  const density = useThemeStore((s) => s.density);
  const setDensity = useThemeStore((s) => s.setDensity);
  const notify = useAppStore((s) => s.notify);

  const [customColor, setCustomColor] = useState('#4f6bed');

  /** 预设主色调 */
  const PRESET_ACCENTS = [
    '#4f6bed',
    '#0ea5a4',
    '#8b5cf6',
    '#16a34a',
    '#f59e0b',
    '#ec4899',
    '#ef4444',
    '#64748b',
  ];

  return (
    <div className="space-y-5">
      {/* 亮暗模式 */}
      <section className="space-y-2.5">
        <div>
          <p className="text-sm font-medium">外观模式</p>
          <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
            切换全局亮色 / 暗色主题
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: 'light' as const, label: '亮色', icon: Sun },
              { value: 'dark' as const, label: '暗色', icon: Moon },
            ]
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setMode(item.value)}
              className={cn(
                'flex items-center gap-2.5 rounded-md border px-3.5 py-3 text-left transition-colors',
                mode === item.value
                  ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                  : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
              )}
            >
              <item.icon
                className={cn(
                  'size-4 shrink-0',
                  mode === item.value
                    ? 'text-[var(--zj-accent)]'
                    : 'text-[var(--zj-muted-fg)]',
                )}
              />
              <span className="text-sm font-medium">{item.label}</span>
              {mode === item.value && (
                <Check className="ml-auto size-4 text-[var(--zj-accent)]" />
              )}
            </button>
          ))}
        </div>
      </section>

      <Separator />

      {/* 主题包 */}
      <section className="space-y-2.5">
        <div>
          <p className="text-sm font-medium">主题包</p>
          <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
            切换主题包会同时应用配色、圆角、阴影与壁纸
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {packs.map((pack) => {
            const active = pack.id === activePackId;
            const preview = mode === 'dark' ? pack.dark : pack.light;
            return (
              <motion.button
                key={pack.id}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => {
                  applyThemePack(pack.id);
                  notify(`已应用主题包「${pack.name}」`, 'success');
                }}
                className={cn(
                  'overflow-hidden rounded-md border text-left transition-colors',
                  active
                    ? 'border-[var(--zj-accent)]'
                    : 'border-[var(--zj-border)] hover:border-[var(--zj-accent)]',
                )}
              >
                {/* 预览条 */}
                <div
                  className="flex h-14 items-end gap-1 p-2"
                  style={{ backgroundColor: preview.bg }}
                >
                  <span
                    className="size-5 rounded"
                    style={{ backgroundColor: preview.accent }}
                  />
                  <span
                    className="size-5 rounded"
                    style={{
                      backgroundColor: preview.card,
                      border: `1px solid ${preview.border}`,
                    }}
                  />
                  <span
                    className="ml-1 h-2 w-8 rounded-full"
                    style={{ backgroundColor: preview.accent }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-[var(--zj-border)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{pack.name}</p>
                    <p className="text-[10px] text-[var(--zj-muted-fg)]">
                      圆角 {preview.radius}px
                    </p>
                  </div>
                  {active && (
                    <Badge variant="solid" className="shrink-0 text-[10px]">
                      使用中
                    </Badge>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* 自定义主色调 */}
      <section className="space-y-2.5">
        <div>
          <p className="text-sm font-medium">主色调</p>
          <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
            自定义后会自动生成一份属于你的主题包
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_ACCENTS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                setAccent(color);
                notify('主色调已更新', 'success');
              }}
              aria-label={`使用主色调 ${color}`}
              className="size-7 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: color,
                borderColor:
                  color === customColor
                    ? 'var(--zj-fg)'
                    : 'transparent',
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="custom-accent" className="shrink-0 text-xs">
            自定义
          </Label>
          <input
            id="custom-accent"
            type="color"
            value={customColor}
            onChange={(e) => setCustomColor(e.target.value)}
            className="h-8 w-14 cursor-pointer rounded border border-[var(--zj-border)] bg-transparent"
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setAccent(customColor);
              notify('主色调已更新', 'success');
            }}
          >
            应用
          </Button>
        </div>
      </section>

      <Separator />

      {/* 界面大小 */}
      <section className="space-y-2.5">
        <div>
          <p className="text-sm font-medium">界面大小</p>
          <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
            调整全局字号与控件尺寸，设置后立即生效并自动保存
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {DENSITY_OPTIONS.map((opt) => {
            const active = density === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setDensity(opt.value);
                  notify(`界面大小已切换为「${opt.label}」`, 'success');
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 transition-colors',
                  active
                    ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                    : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
                )}
              >
                {/* 尺寸示意 */}
                <span
                  className="flex w-full items-end justify-center gap-0.5"
                  aria-hidden
                >
                  <span
                    className="w-1.5 rounded-sm bg-[var(--zj-accent)]"
                    style={{
                      height: opt.value === 'sm' ? 8 : opt.value === 'md' ? 12 : 16,
                    }}
                  />
                  <span
                    className="w-1.5 rounded-sm bg-[var(--zj-accent)]"
                    style={{
                      height: opt.value === 'sm' ? 12 : opt.value === 'md' ? 16 : 20,
                    }}
                  />
                  <span
                    className="w-1.5 rounded-sm bg-[var(--zj-accent)]"
                    style={{
                      height: opt.value === 'sm' ? 16 : opt.value === 'md' ? 20 : 24,
                    }}
                  />
                </span>
                <span className="text-xs font-medium">{opt.label}</span>
                {active && (
                  <Check className="size-3.5 text-[var(--zj-accent)]" />
                )}
              </button>
            );
          })}
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--zj-muted-fg)]">
          <Monitor className="size-3" />
          当前：{DENSITY_OPTIONS.find((o) => o.value === density)?.desc}
        </p>
      </section>
    </div>
  );
}

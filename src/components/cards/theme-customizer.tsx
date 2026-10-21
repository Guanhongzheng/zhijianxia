'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Image as ImageIcon,
  LayoutPanelTop,
  Palette,
  RotateCcw,
  Shapes,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useThemeStore } from '@/store/theme-store';
import { useAppStore } from '@/store/app-store';
import {
  CARD_STYLES,
  NAV_STYLES,
} from '@/lib/theme/packager';
import type { ThemeCardStyle, ThemeNavStyle } from '@/lib/theme/types';
import { cn } from '@/lib/utils';

/** 卡片风格中文名 */
const CARD_STYLE_LABELS: Record<string, string> = {
  flat: '扁平',
  elevated: '悬浮',
  outline: '描边',
  glass: '毛玻璃',
};

/** 导航栏风格中文名 */
const NAV_STYLE_LABELS: Record<string, string> = {
  flat: '扁平',
  glass: '毛玻璃',
  solid: '实色',
  minimal: '极简',
};

/** 常用图标候选（供品牌图标快速选取） */
const ICON_PRESETS = ['📦', '🖋️', '🌿', '🌙', '🌇', '⬜', '🎨', '🚀', '🧊', '🍃', '⚡', '🔮'];

/**
 * 主题定制 —— 允许用户直接修改当前主题包的
 * 图标（品牌）、卡片风格、导航栏风格、配色与壁纸。
 *
 * 修改后写回本地自定义主题包，可导出为 .theme 分享给其他人。
 */
export function ThemeCustomizer() {
  const packs = useThemeStore((s) => s.packs);
  const activePackId = useThemeStore((s) => s.activePackId);
  const mode = useThemeStore((s) => s.mode);
  const patchActivePack = useThemeStore((s) => s.patchActivePack);
  const setAccent = useThemeStore((s) => s.setAccent);
  const uploadWallpaper = useThemeStore((s) => s.uploadWallpaper);
  const notify = useAppStore((s) => s.notify);

  const pack = packs.find((p) => p.id === activePackId) ?? packs[0];
  const variant = mode === 'dark' ? pack?.dark : pack?.light;

  const [icon, setIcon] = useState(pack?.brand?.icon ?? '');
  const [name, setName] = useState(pack?.brand?.name ?? '');
  const [tagline, setTagline] = useState(pack?.brand?.tagline ?? '');
  const [customIcon, setCustomIcon] = useState('');

  useEffect(() => {
    setIcon(pack?.brand?.icon ?? '');
    setName(pack?.brand?.name ?? '');
    setTagline(pack?.brand?.tagline ?? '');
  }, [pack?.id]);

  if (!pack || !variant) return null;

  const card: ThemeCardStyle = pack.card ?? { style: 'elevated', borderWidth: 1 };
  const nav: ThemeNavStyle = pack.nav ?? { style: 'flat', showIcon: true };

  const commitBrand = (next: Partial<NonNullable<typeof pack.brand>>) => {
    patchActivePack({ brand: { ...pack.brand, ...next } });
  };

  const commitCard = (next: Partial<ThemeCardStyle>) => {
    patchActivePack({ card: { ...card, ...next } });
  };

  const commitNav = (next: Partial<ThemeNavStyle>) => {
    patchActivePack({ nav: { ...nav, ...next } });
  };

  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Palette className="size-3.5 text-[var(--zj-accent)]" />
          主题定制
        </p>
        <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
          直接修改当前主题包的图标、卡片、导航栏、配色与壁纸；
          修改后自动另存为自定义主题包，可导出为 .theme 分享
        </p>
      </div>

      {/* ---- 应用图标 / 名称 ---- */}
      <section className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--zj-fg)]">
          <Shapes className="size-3.5" />
          应用图标与名称
        </p>

        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--zj-accent-soft)] text-2xl">
            {/^https?:\/\//i.test(icon) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="" className="size-8 object-contain" />
            ) : (
              icon || '📦'
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Input
              value={icon}
              onChange={(e) => {
                setIcon(e.target.value);
                commitBrand({ icon: e.target.value });
              }}
              placeholder="图标：emoji 或图片地址"
              className="h-8 text-xs"
            />
            <Input
              value={customIcon}
              onChange={(e) => setCustomIcon(e.target.value)}
              placeholder="或粘贴图片地址 https://…"
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ICON_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setIcon(c);
                commitBrand({ icon: c });
              }}
              className={cn(
                'flex size-8 items-center justify-center rounded-md border text-sm transition-colors',
                icon === c
                  ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                  : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">应用名称</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                commitBrand({ name: e.target.value });
              }}
              placeholder="智简匣"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">副标题</Label>
            <Input
              value={tagline}
              onChange={(e) => {
                setTagline(e.target.value);
                commitBrand({ tagline: e.target.value });
              }}
              placeholder="本地离线 AI 工具箱"
              className="h-8 text-xs"
            />
          </div>
        </div>

        {customIcon && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setIcon(customIcon);
              commitBrand({ icon: customIcon });
              setCustomIcon('');
              notify('已应用自定义图标地址', 'success');
            }}
          >
            使用该图片地址
          </Button>
        )}
      </section>

      <Separator />

      {/* ---- 卡片样式 ---- */}
      <section className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--zj-fg)]">
          <Square className="size-3.5" />
          卡片样式
        </p>
        <div className="grid grid-cols-4 gap-2">
          {CARD_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commitCard({ style: s })}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 transition-colors',
                card.style === s
                  ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                  : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
              )}
            >
              <span
                className="size-6 rounded border"
                style={{
                  borderColor: 'var(--zj-border)',
                  background:
                    s === 'outline'
                      ? 'transparent'
                      : s === 'glass'
                        ? 'color-mix(in srgb, var(--zj-accent) 20%, transparent)'
                        : 'var(--zj-card)',
                  boxShadow:
                    s === 'elevated' ? 'var(--zj-shadow)' : 'none',
                }}
              />
              <span className="text-[0.6875rem]">{CARD_STYLE_LABELS[s]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.75rem] text-[var(--zj-muted-fg)]">边框宽度</span>
          {[0, 1, 2].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => commitCard({ borderWidth: w })}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[0.6875rem] transition-colors',
                (card.borderWidth ?? 1) === w
                  ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                  : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
              )}
            >
              {w}px
            </button>
          ))}
          <button
            type="button"
            onClick={() => commitCard({ accentBar: !card.accentBar })}
            className={cn(
              'ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.6875rem] transition-colors',
              card.accentBar
                ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
            )}
          >
            {card.accentBar && <Check className="size-3 text-[var(--zj-accent)]" />}
            顶部强调条
          </button>
        </div>
      </section>

      <Separator />

      {/* ---- 导航栏样式 ---- */}
      <section className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--zj-fg)]">
          <LayoutPanelTop className="size-3.5" />
          导航栏样式
        </p>
        <div className="grid grid-cols-4 gap-2">
          {NAV_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commitNav({ style: s })}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 transition-colors',
                nav.style === s
                  ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                  : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
              )}
            >
              <span
                className="h-4 w-8 rounded border"
                style={{
                  borderColor: 'var(--zj-border)',
                  background:
                    s === 'minimal'
                      ? 'transparent'
                      : s === 'glass'
                        ? 'color-mix(in srgb, var(--zj-accent) 18%, transparent)'
                        : s === 'solid'
                          ? 'var(--zj-accent-soft)'
                          : 'var(--zj-card)',
                }}
              />
              <span className="text-[0.6875rem]">{NAV_STYLE_LABELS[s]}</span>
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-[0.75rem] text-[var(--zj-muted-fg)]">
          <input
            type="checkbox"
            checked={nav.showIcon !== false}
            onChange={(e) => commitNav({ showIcon: e.target.checked })}
            className="size-3.5 accent-[var(--zj-accent)]"
          />
          在导航栏显示应用图标
        </label>
      </section>

      <Separator />

      {/* ---- 配色与壁纸 ---- */}
      <section className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--zj-fg)]">
          <Palette className="size-3.5" />
          配色与壁纸
        </p>

        <div className="space-y-1.5">
          <Label className="text-xs">主色（{mode === 'dark' ? '暗色' : '亮色'}模式）</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={variant.accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-8 w-12 cursor-pointer rounded-md border border-[var(--zj-border)] bg-transparent"
            />
            <Input
              defaultValue={variant.accent}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
                  setAccent(v);
                }
              }}
              className="h-8 text-xs"
            />
            <Badge variant="outline" className="text-[0.6875rem]">
              {variant.accent}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => wallpaperInputRef.current?.click()}
          >
            <ImageIcon className="size-3" />
            上传壁纸图片
          </Button>
          <input
            ref={wallpaperInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadWallpaper(mode, file);
              e.target.value = '';
            }}
          />
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              patchActivePack({
                wallpaper: { ...(pack.wallpaper ?? {}), [mode]: { kind: 'none', veil: 1 } },
              });
              notify('已清除当前模式壁纸', 'info');
            }}
          >
            <RotateCcw className="size-3" />
            清除壁纸
          </Button>
        </div>
      </section>

      {/* 实时预览 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="zj-card p-3"
      >
        <p className="mb-2 text-[0.6875rem] text-[var(--zj-muted-fg)]">实时预览</p>
        <div
          className="rounded-md border p-3"
          style={{
            borderColor: variant.border,
            background: variant.bg,
            color: variant.fg,
          }}
        >
          <div
            className="mb-2 flex items-center gap-2 rounded-md px-2 py-1.5"
            style={{ background: variant.card, border: `1px solid ${variant.border}` }}
          >
            <span className="text-sm">{icon || '📦'}</span>
            <span className="text-xs font-medium">{name || '智简匣'}</span>
          </div>
          <div
            className="rounded-md px-2.5 py-2 text-[0.6875rem]"
            style={{
              background: variant.card,
              border: `${card.borderWidth ?? 1}px solid ${variant.border}`,
              borderRadius: `${variant.radius}px`,
              boxShadow:
                card.style === 'elevated'
                  ? '0 1px 2px rgb(16 20 30 / 0.06)'
                  : 'none',
            }}
          >
            {tagline || '本地离线 AI 工具箱'}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

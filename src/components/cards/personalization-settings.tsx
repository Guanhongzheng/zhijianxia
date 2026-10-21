'use client';

import { useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Download,
  Monitor,
  Moon,
  Store,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useThemeStore } from '@/store/theme-store';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { DENSITY_OPTIONS } from '@/lib/theme/density';
import { RADIUS_OPTIONS } from '@/lib/theme/radius';
import {
  readThemePackageFile,
  themePackOf,
  downloadThemePackage,
  createThemePackage,
} from '@/lib/theme/packager';
import { uploadRegistryTheme } from '@/lib/backend/registry';
import { cacheTheme, removeCachedTheme } from '@/lib/registry-cache';
import { cn } from '@/lib/utils';

/**
 * 个性化设置 —— 主题包、亮暗模式与界面大小。
 *
 * 主题包在**外部制作**为 .theme 文件，用户在此处：
 * - 导入本地 .theme 文件
 * - 从局域网广场下载主题包
 * - 或把已有主题包导出/上传分享
 */
export function PersonalizationSettings() {
  const packs = useThemeStore((s) => s.packs);
  const activePackId = useThemeStore((s) => s.activePackId);
  const applyThemePack = useThemeStore((s) => s.applyThemePack);
  const saveCustomPack = useThemeStore((s) => s.saveCustomPack);
  const removeCustomPack = useThemeStore((s) => s.removeCustomPack);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const density = useThemeStore((s) => s.density);
  const setDensity = useThemeStore((s) => s.setDensity);
  const radius = useThemeStore((s) => s.radius);
  const setRadius = useThemeStore((s) => s.setRadius);

  const notify = useAppStore((s) => s.notify);
  const lan = useAppStore((s) => s.lan);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const fileRef = useRef<HTMLInputElement>(null);

  /** 导入本地 .theme 文件 */
  const handleImport = async (file: File) => {
    const result = await readThemePackageFile(file);
    if (!result.ok) {
      notify(result.error, 'error');
      return;
    }
    const pack = themePackOf(result.value);
    saveCustomPack(pack);
    cacheTheme(pack);
    applyThemePack(pack.id);
    notify(`主题包「${pack.name}」已导入并应用`, 'success');
  };

  /** 上传当前主题包到广场 */
  const handleUpload = async (packId: string) => {
    if (!token || !isAdmin) {
      notify('仅管理员可上传主题包到广场', 'error');
      return;
    }
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;
    try {
      await uploadRegistryTheme(lan, token, pack);
      notify(`主题包「${pack.name}」已上传到广场`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : '上传失败', 'error');
    }
  };

  /** 导出主题包为 .theme 文件 */
  const handleExport = (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;
    const ok = downloadThemePackage(
      createThemePackage(pack, {
        description: `由 ${pack.name} 导出的主题包`,
      }),
    );
    notify(ok ? '主题包已导出' : '导出失败', ok ? 'success' : 'error');
  };

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

      {/* 主题 */}
      <section className="space-y-2.5">
        <div>
          <p className="text-sm font-medium">主题</p>
          <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
            主题为 .theme 文件，可在外部制作后导入，也可从广场下载
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".theme,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = '';
            }}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-3" />
            导入 .theme
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              useAppStore.getState().openCard('marketplace');
            }}
          >
            <Store className="size-3" />
            去广场下载
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {packs.map((pack) => {
            const active = pack.id === activePackId;
            const preview = mode === 'dark' ? pack.dark : pack.light;
            return (
              <motion.div
                key={pack.id}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'overflow-hidden rounded-md border transition-colors',
                  active
                    ? 'border-[var(--zj-accent)]'
                    : 'border-[var(--zj-border)] hover:border-[var(--zj-accent)]',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    applyThemePack(pack.id);
                    notify(`已应用主题包「${pack.name}」`, 'success');
                  }}
                  className="block w-full text-left"
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
                      <p className="text-[0.6875rem] text-[var(--zj-muted-fg)]">
                        {pack.category ?? '综合'}
                      </p>
                    </div>
                    {active && (
                      <Badge variant="solid" className="shrink-0 text-[0.6875rem]">
                        使用中
                      </Badge>
                    )}
                  </div>
                </button>

                {/* 主题包操作 */}
                {!pack.builtin && (
                  <div className="flex items-center gap-1 border-t border-[var(--zj-border)] px-2 py-1.5">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-[0.6875rem]"
                      onClick={() => handleExport(pack.id)}
                      title="导出为 .theme 文件"
                    >
                      <Download className="size-3" />
                      导出
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-[0.6875rem]"
                        onClick={() => void handleUpload(pack.id)}
                        title="上传到局域网广场"
                      >
                        <Upload className="size-3" />
                        上传
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="ml-auto text-[0.6875rem] text-red-500 hover:bg-red-500/10"
                      onClick={() => {
                        removeCustomPack(pack.id);
                        removeCachedTheme(pack.id);
                        notify(`主题包「${pack.name}」已删除`, 'info');
                      }}
                      title="删除主题包"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* 圆角（全局设置，不绑定主题包） */}
      <section className="space-y-2.5">
        <div>
          <p className="text-sm font-medium">圆角</p>
          <p className="mt-0.5 text-xs text-[var(--zj-muted-fg)]">
            全局圆角大小，独立于主题包 —— 切换主题时保持不变
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {RADIUS_OPTIONS.map((opt) => {
            const active = radius === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setRadius(opt.value);
                  notify(`圆角已切换为「${opt.label}」`, 'success');
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 transition-colors',
                  active
                    ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)]'
                    : 'border-[var(--zj-border)] hover:bg-[var(--zj-muted)]',
                )}
              >
                {/* 圆角示意 */}
                <span
                  className="size-6 border-2 border-[var(--zj-accent)]"
                  style={{ borderRadius: `${opt.value / 2}px` }}
                  aria-hidden
                />
                <span className="text-xs font-medium">{opt.label}</span>
                {active && <Check className="size-3.5 text-[var(--zj-accent)]" />}
              </button>
            );
          })}
        </div>
        <p className="flex items-center gap-1.5 text-[0.75rem] text-[var(--zj-muted-fg)]">
          <Monitor className="size-3" />
          当前：{RADIUS_OPTIONS.find((o) => o.value === radius)?.desc ??
            `${radius}px`}
        </p>
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
        <p className="flex items-center gap-1.5 text-[0.75rem] text-[var(--zj-muted-fg)]">
          <Monitor className="size-3" />
          当前：{DENSITY_OPTIONS.find((o) => o.value === density)?.desc}
        </p>
      </section>
    </div>
  );
}

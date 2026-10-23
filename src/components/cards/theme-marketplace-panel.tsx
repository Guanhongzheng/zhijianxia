'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Download,
  Info,
  LayoutGrid,
  Palette,
  PanelTop,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { useThemeStore } from '@/store/theme-store';
import { THEME_CATEGORIES } from '@/lib/theme/categories';
import { BUILTIN_THEME_PACKS } from '@/lib/theme/types';
import {
  readThemePackageFile,
  themePackOf,
  downloadThemePackage,
  createThemePackage,
} from '@/lib/theme/packager';
import { uploadRegistryTheme } from '@/lib/backend/registry';
import {
  fetchPlazaThemes,
  fetchPlazaThemeFile,
  plazaCoverUrl,
  deletePlazaTheme,
  type PlazaTheme,
} from '@/lib/backend/theme-plaza';
import { cacheTheme, removeCachedTheme } from '@/lib/registry-cache';
import { cn } from '@/lib/utils';

/** 分类 id -> 图标 */
const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  all: LayoutGrid,
  综合: Sparkles,
  配色: Palette,
  卡片: Square,
  导航栏: PanelTop,
  壁纸: LayoutGrid,
  图标: Shapes,
};

/**
 * 功能广场 · 主题分类页
 *
 * 与「插件」分类页平行：主题包同样存放在局域网仓库，
 * **下载后才可离线使用**（下载副本写入 LocalStorage 缓存）。
 */
export function ThemeMarketplacePanel() {
  const notify = useAppStore((s) => s.notify);
  const lan = useAppStore((s) => s.lan);
  const backendOnline = useAppStore((s) => s.backendOnline);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const packs = useThemeStore((s) => s.packs);
  const activePackId = useThemeStore((s) => s.activePackId);
  const applyThemePack = useThemeStore((s) => s.applyThemePack);
  const saveCustomPack = useThemeStore((s) => s.saveCustomPack);
  const removeCustomPack = useThemeStore((s) => s.removeCustomPack);
  const mode = useThemeStore((s) => s.mode);

  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [plazaThemes, setPlazaThemes] = useState<PlazaTheme[]>([]);
  const [plazaLoading, setPlazaLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlazaTheme | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * 拉取主题广场的列表
   *
   * 走**公开浏览通道**（/api/themes）而不是 registry 管理通道 ——
   * 浏览主题目录不该要求登录，否则未登录的用户看到的广场永远是空的。
   */
  useEffect(() => {
    if (!backendOnline) {
      setPlazaThemes([]);
      return;
    }
    let cancelled = false;
    setPlazaLoading(true);
    void fetchPlazaThemes(lan)
      .then((list) => {
        if (!cancelled) setPlazaThemes(list.items);
      })
      .catch(() => {
        if (!cancelled) setPlazaThemes([]);
      })
      .finally(() => {
        if (!cancelled) setPlazaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backendOnline, lan]);

  /** 已下载到本地（可离线）的主题 id */
  const downloadedIds = useMemo(
    () => new Set(packs.filter((p) => !p.builtin).map((p) => p.id)),
    [packs],
  );

  /** 内置（默认）主题 id —— 广场里不展示，避免与已应用的内置主题重复 */
  const builtinIds = useMemo(
    () => new Set(BUILTIN_THEME_PACKS.map((p) => p.id)),
    [],
  );

  /** 按分类与关键词过滤仓库主题 */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return plazaThemes.filter((t) => {
      // 默认/内置主题不在广场中出现
      if (builtinIds.has(t.slug)) return false;
      if (category !== 'all' && t.category !== category) return false;
      if (!kw) return true;
      return (
        t.name.toLowerCase().includes(kw) ||
        t.description.toLowerCase().includes(kw) ||
        t.tags.some((tag) => tag.toLowerCase().includes(kw))
      );
    });
  }, [plazaThemes, category, keyword, builtinIds]);

  /** 仓库中被隐藏的默认/内置主题数量 */
  const hiddenBuiltinCount = useMemo(
    () => plazaThemes.filter((t) => builtinIds.has(t.slug)).length,
    [plazaThemes, builtinIds],
  );

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

  /** 从广场下载主题包并应用 */
  const handleDownload = async (item: PlazaTheme) => {
    setDownloading(item.slug);
    try {
      // 后端已把文件夹制主题转成 .theme 单文件信封（含亮/暗双变体、
      // 卡片风格、毛玻璃参数、壁纸绝对地址），前端直接解析即可。
      const raw = await fetchPlazaThemeFile(lan, item.slug);
      const pack = themePackOf(raw);
      const next = {
        ...pack,
        id: pack.id || item.slug,
        name: pack.name || item.name,
        builtin: false,
        category: item.category,
      };
      saveCustomPack(next);
      cacheTheme(next);
      applyThemePack(next.id);
      notify(`主题包「${next.name}」已下载并应用`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : '主题包下载失败', 'error');
    } finally {
      setDownloading(null);
    }
  };

  /** 导出已下载的主题包为 .theme 文件 */
  const handleExport = (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;
    const ok = downloadThemePackage(
      createThemePackage(pack, {
        description: `由 ${pack.name} 导出的主题包`,
        category: pack.category,
      }),
    );
    notify(ok ? '主题包已导出' : '导出失败', ok ? 'success' : 'error');
  };

  /** 上传主题包到广场 */
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

  /** 从广场删除主题包 */
  const handleDeleteRemote = async (item: PlazaTheme) => {
    if (!token || !isAdmin) return;
    try {
      await deletePlazaTheme(lan, token, item.slug);
      setPlazaThemes((prev) => prev.filter((t) => t.slug !== item.slug));
      notify(`主题包「${item.name}」已从广场删除`, 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索与导入 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <LayoutGrid className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--zj-muted-fg)]" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索主题名称、简介或标签…"
            className="pl-9"
          />
        </div>
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
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" />
          导入主题包
        </Button>
      </div>

      {/* 主题分类筛选 */}
      <div className="zj-hide-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {THEME_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.id] ?? Sparkles;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors',
                category === cat.id
                  ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)] text-[var(--zj-fg)]'
                  : 'border-[var(--zj-border)] text-[var(--zj-muted-fg)] hover:bg-[var(--zj-muted)]',
              )}
            >
              <Icon className="size-3" />
              {cat.name}
            </button>
          );
        })}
      </div>

      {/* 主题列表（局域网仓库） */}
      {plazaLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-md" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="zj-card flex flex-col items-center gap-2 px-5 py-10 text-center">
          <Palette className="size-5 text-[var(--zj-muted-fg)]" />
          <p className="text-sm text-[var(--zj-muted-fg)]">
            {backendOnline
              ? hiddenBuiltinCount > 0
                ? '默认主题已内置，无需下载；暂无可安装的主题包'
                : '没有找到匹配的主题包'
              : '后端服务未开启，无法浏览主题包'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {filtered.map((item, idx) => {
              const downloaded = downloadedIds.has(item.slug);
              const active = activePackId === item.slug;
              const cover = plazaCoverUrl(lan, item);
              return (
                <motion.article
                  key={item.slug}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{
                    duration: 0.2,
                    delay: Math.min(idx * 0.03, 0.2),
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="zj-card flex flex-col gap-2.5 p-4"
                >
                  <div className="flex items-start gap-3">
                    {cover ? (
                      <img
                        src={cover}
                        alt={item.name}
                        loading="lazy"
                        className="size-10 shrink-0 rounded-xl object-cover"
                        onError={(e) => {
                          // 封面加载失败时退回色块占位
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--zj-accent-soft)] text-xl">
                        🎨
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h4 className="truncate text-sm font-medium">{item.name}</h4>
                        <Badge variant="outline" className="shrink-0 text-[0.6875rem]">
                          {item.category}
                        </Badge>
                        {downloaded && (
                          <Badge variant="success" className="shrink-0 text-[0.6875rem]">
                            可离线
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[0.75rem] text-[var(--zj-muted-fg)]">
                        v{item.version} · {item.author || '未知作者'}
                      </p>
                    </div>
                  </div>

                  <p className="line-clamp-2 text-xs leading-relaxed text-[var(--zj-muted-fg)]">
                    {item.description}
                  </p>

                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.tags.map((t) => (
                        <Badge key={t} variant="outline" className="text-[0.6875rem]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setDetail(item)}
                    >
                      <Info className="size-3" />
                      详情
                    </Button>

                    <div className="flex items-center gap-1.5">
                      {downloaded && (
                        <>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleExport(item.slug)}
                            title="导出主题包"
                          >
                            <Upload className="size-3 rotate-180" />
                            导出
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => void handleUpload(item.slug)}
                              title="上传到局域网广场"
                            >
                              <Upload className="size-3" />
                              上传
                            </Button>
                          )}
                        </>
                      )}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-red-500 hover:bg-red-500/10"
                          onClick={() => void handleDeleteRemote(item)}
                          title="从广场删除"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      )}
                      <Button
                        size="xs"
                        disabled={downloading === item.slug}
                        onClick={() => void handleDownload(item)}
                      >
                        {downloading === item.slug ? (
                          <Skeleton className="size-3" />
                        ) : downloaded ? (
                          <Check className="size-3" />
                        ) : (
                          <Download className="size-3" />
                        )}
                        {downloading === item.slug
                          ? '下载中…'
                          : downloaded
                            ? active
                              ? '使用中'
                              : '已下载'
                            : '下载'}
                      </Button>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* 已下载到本地的自定义主题包 */}
      {packs.filter((p) => !p.builtin).length > 0 && (
        <section className="space-y-2">
          <p className="text-xs text-[var(--zj-muted-fg)]">
            本地已下载的主题包（可离线使用）
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {packs
              .filter((p) => !p.builtin)
              .map((pack) => {
                const preview = mode === 'dark' ? pack.dark : pack.light;
                const active = pack.id === activePackId;
                return (
                  <div
                    key={pack.id}
                    className={cn(
                      'overflow-hidden rounded-md border',
                      active
                        ? 'border-[var(--zj-accent)]'
                        : 'border-[var(--zj-border)]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => applyThemePack(pack.id)}
                      className="block w-full text-left"
                    >
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
                    <div className="flex items-center gap-1 border-t border-[var(--zj-border)] px-2 py-1.5">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-[0.6875rem]"
                        onClick={() => handleExport(pack.id)}
                      >
                        <Upload className="size-3 rotate-180" />
                        导出
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-[0.6875rem]"
                          onClick={() => void handleUpload(pack.id)}
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
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* 主题详情弹窗 */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.coverUrl ? (
                <img
                  src={plazaCoverUrl(lan, detail)}
                  alt={detail.name}
                  className="size-7 rounded-md object-cover"
                />
              ) : (
                <span className="text-xl">🎨</span>
              )}
              {detail?.name}
            </DialogTitle>
            <DialogDescription>{detail?.description}</DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <InfoRow label="版本" value={`v${detail.version}`} />
                <InfoRow label="分类" value={detail.category} />
                <InfoRow label="作者" value={detail.author || '未知'} />
                <InfoRow
                  label="状态"
                  value={downloadedIds.has(detail.slug) ? '已下载（可离线）' : '未下载'}
                />
              </div>

              {detail.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {detail.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="rounded-md border border-[var(--zj-border)] p-3 text-[0.75rem] leading-relaxed text-[var(--zj-muted-fg)]">
                主题包可定制应用图标、卡片风格、导航栏风格、配色与壁纸。
                下载后写入本地缓存，离线也能切换使用。
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              关闭
            </Button>
            {detail && (
              <Button
                onClick={() => {
                  void handleDownload(detail);
                  setDetail(null);
                }}
              >
                <Download className="size-3.5" />
                {downloadedIds.has(detail.slug) ? '重新下载并应用' : '下载并应用'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--zj-border)] px-2.5 py-2">
      <p className="text-[0.6875rem] text-[var(--zj-muted-fg)]">{label}</p>
      <p className="mt-0.5 text-xs">{value}</p>
    </div>
  );
}

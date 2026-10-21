'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Download,
  Info,
  Package,
  Palette,
  Search,
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
import { usePluginStore } from '@/store/plugin-store';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { ThemeMarketplacePanel } from '@/components/cards/theme-marketplace-panel';
import {
  MARKETPLACE_ENTRIES,
  MARKETPLACE_CATEGORIES,
  type MarketplaceEntry,
} from '@/plugins';
import {
  fetchRegistryPlugins,
  uploadRegistryPlugin,
  type RegistryPlugin,
} from '@/lib/backend/registry';
import { hasCachedPluginPackage } from '@/lib/registry-cache';

/** 广场的两大分类：插件与主题 */
const MARKETPLACE_TABS = [
  { id: 'plugin' as const, name: '插件', icon: Package },
  { id: 'theme' as const, name: '主题', icon: Palette },
];

/** 功能广场：插件市场 */
export function MarketplacePanel() {
  const [tab, setTab] = useState<'plugin' | 'theme'>('plugin');

  return (
    <div className="space-y-4">
      {/* 插件 / 主题 分类切换 */}
      <div className="flex gap-1.5 rounded-md bg-[var(--zj-muted)] p-1">
        {MARKETPLACE_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-[var(--zj-card)] text-[var(--zj-fg)] shadow-sm'
                  : 'text-[var(--zj-muted-fg)] hover:text-[var(--zj-fg)]'
              }`}
            >
              <Icon className="size-3.5" />
              {t.name}
            </button>
          );
        })}
      </div>

      {tab === 'plugin' ? (
        <PluginMarketplace />
      ) : (
        <ThemeMarketplacePanel />
      )}
    </div>
  );
}

/** 插件市场列表 */
function PluginMarketplace() {
  const installed = usePluginStore((s) => s.installed);
  const installing = usePluginStore((s) => s.importing);
  const install = usePluginStore((s) => s.install);
  const uninstall = usePluginStore((s) => s.uninstall);
  const exportPackage = usePluginStore((s) => s.exportPackage);
  const importPackageFile = usePluginStore((s) => s.importPackageFile);
  const notify = useAppStore((s) => s.notify);

  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [detail, setDetail] = useState<MarketplaceEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- 后端仓库 ----
  const backendOnline = useAppStore((s) => s.backendOnline);
  const lan = useAppStore((s) => s.lan);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const downloadFromRegistry = usePluginStore((s) => s.downloadFromRegistry);
  const uploadToRegistry = usePluginStore((s) => s.uploadToRegistry);
  const downloading = usePluginStore((s) => s.downloading);

  const [registryPlugins, setRegistryPlugins] = useState<RegistryPlugin[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  /** 已缓存到本地（下载过）的插件 id */
  const [cachedIds, setCachedIds] = useState<string[]>([]);

  /** 拉取后端仓库的插件包列表 */
  const loadRegistry = useMemo(() => {
    let cancelled = false;
    const run = async () => {
      if (!backendOnline || !token) {
        setRegistryPlugins([]);
        return;
      }
      setRegistryLoading(true);
      try {
        const list = await fetchRegistryPlugins(lan, token);
        if (!cancelled) setRegistryPlugins(list);
      } catch {
        if (!cancelled) setRegistryPlugins([]);
      } finally {
        if (!cancelled) setRegistryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [backendOnline, lan, token]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  /** 检查哪些插件已缓存到本地（可离线使用） */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = await Promise.all(
        registryPlugins.map(async (p) =>
          (await hasCachedPluginPackage(p.id)) ? p.id : null,
        ),
      );
      if (!cancelled) {
        setCachedIds(ids.filter((x): x is string => x !== null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [registryPlugins, installed]);

  /** 后端仓库中的插件 id 集合 */
  const registryIds = useMemo(
    () => new Set(registryPlugins.map((p) => p.id)),
    [registryPlugins],
  );

  /**
   * 合并本地静态条目与后端仓库条目（按 id 去重，**后端优先**）。
   * 后端仓库是权威来源：包放在后端后，插件需要先下载才能离线使用，
   * 因此仓库里的条目一律以「下载」呈现，而不是随应用打包的「安装」。
   */
  const allEntries = useMemo(() => {
    const map = new Map<string, MarketplaceEntry>();
    for (const e of MARKETPLACE_ENTRIES) map.set(e.id, e);
    for (const r of registryPlugins) {
      map.set(r.id, {
        id: r.id,
        name: r.name,
        version: r.version,
        description: r.description,
        category: r.category,
        author: r.author,
        icon: 'Package',
        preview: r.preview,
        tags: r.tags,
        builtin: r.builtin,
        offline: r.offline,
        sizeKB: r.sizeKB,
        minCoreVersion: r.minCoreVersion,
        installed: false,
      });
    }
    return Array.from(map.values());
  }, [registryPlugins]);

  const entries = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return allEntries.filter((entry) => {
      const matchCat = category === 'all' || entry.category === category;
      if (!matchCat) return false;
      if (!kw) return true;
      return (
        entry.name.toLowerCase().includes(kw) ||
        entry.description.toLowerCase().includes(kw) ||
        entry.tags.some((t) => t.toLowerCase().includes(kw))
      );
    });
  }, [keyword, category, allEntries]);

  const handleImport = async (file: File) => {
    await importPackageFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {/* 搜索与筛选 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--zj-muted-fg)]" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索插件名称、简介或标签…"
            className="pl-9"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".plugin,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />
        <Button
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={!!installing}
        >
          {installing ? (
            <Skeleton className="size-4" />
          ) : (
            <Upload className="size-3.5" />
          )}
          导入插件
        </Button>
      </div>

      {/* 分类筛选 */}
      <div className="zj-hide-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {MARKETPLACE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs transition-colors ${
              category === cat.id
                ? 'border-[var(--zj-accent)] bg-[var(--zj-accent-soft)] text-[var(--zj-fg)]'
                : 'border-[var(--zj-border)] text-[var(--zj-muted-fg)] hover:bg-[var(--zj-muted)]'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* 插件列表 */}
      {registryLoading ? (
        /* 拉取局域网仓库期间：骨架屏 */
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="zj-card flex flex-col gap-2.5 p-4"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="size-10 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-2.5 w-2/3" />
                </div>
              </div>
              <Skeleton className="h-2.5 w-full" />
              <Skeleton className="h-2.5 w-4/5" />
              <div className="flex justify-end gap-2 pt-1">
                <Skeleton className="h-6 w-14 rounded-md" />
                <Skeleton className="h-6 w-16 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="zj-card flex flex-col items-center gap-2 px-5 py-10 text-center">
          <Package className="size-5 text-[var(--zj-muted-fg)]" />
          <p className="text-sm text-[var(--zj-muted-fg)]">
            没有找到匹配的插件
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map((entry, idx) => {
            const isInstalled = installed.includes(entry.id);
            return (
              <motion.article
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(idx * 0.03, 0.2),
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="zj-card flex flex-col gap-2.5 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--zj-accent-soft)] text-xl">
                    {entry.preview}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h4 className="truncate text-sm font-medium">{entry.name}</h4>
                      {entry.builtin && (
                        <Badge variant="outline" className="shrink-0 text-[0.6875rem]">
                          预装
                        </Badge>
                      )}
                      {cachedIds.includes(entry.id) && (
                        <Badge variant="success" className="shrink-0 text-[0.6875rem]">
                          可离线
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[0.75rem] text-[var(--zj-muted-fg)]">
                      v{entry.version} · {entry.category} · {entry.sizeKB} KB
                    </p>
                  </div>
                </div>

                <p className="line-clamp-2 text-xs leading-relaxed text-[var(--zj-muted-fg)]">
                  {entry.description}
                </p>

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setDetail(entry)}
                  >
                    <Info className="size-3" />
                    详情
                  </Button>

                  <div className="flex items-center gap-1.5">
                    {isInstalled && (
                      <>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void exportPackage(entry.id)}
                          title="导出插件包"
                        >
                          <Upload className="size-3 rotate-180" />
                          导出
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void uploadToRegistry(entry.id)}
                            title="上传到局域网广场"
                          >
                            <Upload className="size-3" />
                            上传
                          </Button>
                        )}
                        {!entry.builtin && (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-red-500 hover:bg-red-500/10"
                            onClick={() => void uninstall(entry.id)}
                          >
                            <Trash2 className="size-3" />
                            卸载
                          </Button>
                        )}
                      </>
                    )}
                    {!isInstalled && (
                      <Button
                        size="xs"
                        disabled={downloading === entry.id}
                        onClick={() => {
                          // 仓库里的插件需要先下载（下载后才可离线使用）；
                          // 随应用打包的插件直接安装即可
                          if (registryIds.has(entry.id)) {
                            void downloadFromRegistry(entry.id).then(() => {
                              void loadRegistry();
                            });
                          } else {
                            void install(entry.id);
                          }
                        }}
                      >
                        <Download className="size-3" />
                        {downloading === entry.id
                          ? '下载中…'
                          : registryIds.has(entry.id)
                            ? '下载'
                            : '安装'}
                      </Button>
                    )}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      {/* 插件详情弹窗 */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">{detail?.preview}</span>
              {detail?.name}
            </DialogTitle>
            <DialogDescription>{detail?.description}</DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <InfoRow label="版本" value={`v${detail.version}`} />
                <InfoRow label="分类" value={detail.category} />
                <InfoRow label="作者" value={detail.author} />
                <InfoRow label="体积" value={`${detail.sizeKB} KB`} />
                <InfoRow
                  label="依赖后端"
                  value={detail.offline ? '否（纯本地）' : '是'}
                />
                <InfoRow label="内核要求" value={`≥ ${detail.minCoreVersion}`} />
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
                插件与内核完全解耦，可独立打包导出为 .plugin 文件分享给他人导入使用。
                导入时会校验版本与内核兼容性，不兼容的插件将被拒绝加载。
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              关闭
            </Button>
            {detail && !installed.includes(detail.id) && (
              <Button
                onClick={async () => {
                  await install(detail.id);
                  setDetail(null);
                }}
              >
                <Download className="size-3.5" />
                立即安装
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

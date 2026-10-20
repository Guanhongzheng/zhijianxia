/**
 * 智简匣 · 功能广场内置清单数据
 *
 * 提供 6 个可下载插件 + 5 个预装插件的元信息，
 * 供「功能广场」页面做分类筛选、搜索与展示。
 *
 * 这里只存放「展示用的元信息」与「下载体积估算」，
 * 插件的真实实现位于 builtin/ 与 downloadable/ 目录。
 */

import { builtinPluginModules } from './builtin';
import { downloadablePluginModules } from './downloadable';
import type { PluginManifest } from './types';

/* -------------------------------------------------------------------------- */
/* 类型                                                                        */
/* -------------------------------------------------------------------------- */

/** 广场条目 */
export interface MarketplaceEntry {
  /** 插件 id */
  id: string;
  /** 插件名称 */
  name: string;
  /** 版本 */
  version: string;
  /** 描述 */
  description: string;
  /** 分类 */
  category: string;
  /** 作者 */
  author: string;
  /** lucide 图标名 */
  icon: string;
  /** 预览标识（emoji） */
  preview: string;
  /** 标签 */
  tags: string[];
  /** 是否预装 */
  builtin: boolean;
  /** 是否纯本地 */
  offline: boolean;
  /** 下载体积（KB，预估值） */
  sizeKB: number;
  /** 最低内核版本 */
  minCoreVersion: string;
  /** 是否已安装（由内核在渲染时覆盖） */
  installed: boolean;
}

/* -------------------------------------------------------------------------- */
/* 分类                                                                        */
/* -------------------------------------------------------------------------- */

/** 广场全部分类 */
export const MARKETPLACE_CATEGORIES = [
  { id: 'all', name: '全部', icon: 'LayoutGrid' },
  { id: '效率', name: '效率', icon: 'Zap' },
  { id: '创作', name: '创作', icon: 'PenLine' },
  { id: '生活', name: '生活', icon: 'Coffee' },
  { id: '学习', name: '学习', icon: 'GraduationCap' },
  { id: '工具', name: '工具', icon: 'Wrench' },
  { id: '设置', name: '设置', icon: 'Settings' },
] as const;

/* -------------------------------------------------------------------------- */
/* 体积估算表                                                                  */
/* -------------------------------------------------------------------------- */

/** 各插件的预估体积（KB） */
const SIZE_TABLE: Record<string, number> = {
  'weather-card': 8,
  'copywriting-card': 11,
  'memo-card': 9,
  'quote-card': 7,
  'theme-center-card': 8,
  pomodoro: 12,
  'music-player': 15,
  'text-summary': 10,
  'recipe-assistant': 11,
  'unit-converter': 12,
  vocabulary: 11,
};

/* -------------------------------------------------------------------------- */
/* 清单生成                                                                    */
/* -------------------------------------------------------------------------- */

/** 把插件清单转换为广场条目 */
function toEntry(manifest: PluginManifest, builtin: boolean): MarketplaceEntry {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    category: manifest.category,
    author: manifest.author ?? '智简匣',
    icon: manifest.icon ?? 'Puzzle',
    preview: manifest.preview ?? '🧩',
    tags: manifest.tags ?? [],
    builtin,
    offline: manifest.offline ?? true,
    sizeKB: SIZE_TABLE[manifest.id] ?? 10,
    minCoreVersion: manifest.minCoreVersion ?? '1.0.0',
    installed: builtin,
  };
}

/** 5 个预装插件的元信息 */
export const BUILTIN_ENTRIES: MarketplaceEntry[] = builtinPluginModules.map((m) =>
  toEntry(m.manifest, true),
);

/** 6 个可下载插件的元信息 */
export const DOWNLOADABLE_ENTRIES: MarketplaceEntry[] = downloadablePluginModules.map((m) =>
  toEntry(m.manifest, false),
);

/** 广场全部条目 */
export const MARKETPLACE_ENTRIES: MarketplaceEntry[] = [
  ...DOWNLOADABLE_ENTRIES,
  ...BUILTIN_ENTRIES,
];

/* -------------------------------------------------------------------------- */
/* 查询接口                                                                    */
/* -------------------------------------------------------------------------- */

/** 按 id 查找条目 */
export function findMarketplaceEntry(id: string): MarketplaceEntry | undefined {
  return MARKETPLACE_ENTRIES.find((entry) => entry.id === id);
}

/** 列出可下载条目 */
export function listDownloadable(): MarketplaceEntry[] {
  return DOWNLOADABLE_ENTRIES;
}

/** 列出预装条目 */
export function listBuiltin(): MarketplaceEntry[] {
  return BUILTIN_ENTRIES;
}

/** 筛选参数 */
export interface MarketplaceFilter {
  /** 分类，'all' 表示不限 */
  category?: string;
  /** 关键词，匹配名称 / 描述 / 标签 */
  keyword?: string;
  /** 是否只显示已安装 */
  installedOnly?: boolean;
}

/** 按条件筛选广场条目 */
export function filterMarketplace(filter: MarketplaceFilter = {}): MarketplaceEntry[] {
  const { category = 'all', keyword = '', installedOnly = false } = filter;
  const kw = keyword.trim().toLowerCase();

  return MARKETPLACE_ENTRIES.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (installedOnly && !entry.installed) return false;
    if (!kw) return true;
    return (
      entry.name.toLowerCase().includes(kw) ||
      entry.description.toLowerCase().includes(kw) ||
      entry.tags.some((tag) => tag.toLowerCase().includes(kw))
    );
  });
}

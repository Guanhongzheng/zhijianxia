/**
 * lib/backend/theme-plaza.ts —— 主题广场的浏览通道
 *
 * ## 与 registry 通道的分工
 *
 * - `/api/registry/themes*`：**管理**通道（需登录）。上传、删除、列出仓库主题包。
 * - `/api/themes*`：**浏览**通道（公开）。读主题目录、拿封面与预览图、下载与导出。
 *
 * 浏览是公开的 —— 主题是一份「目录」，局域网里任何人打开应用都该能看到
 * 有哪些主题可选，而不该被「先登录」挡住。
 *
 * 两个通道的数据同源：都来自后端的 `server/packages/themes/` 目录。
 */

import { backendBaseUrl, backendFetch, type LanConfig } from './client';
import type { ThemePackage } from '@/lib/theme/packager';

/** 主题列表项 */
export interface PlazaTheme {
  /** 唯一 ID（= 文件夹名） */
  slug: string;
  name: string;
  author: string;
  description: string;
  /** 协议版本：v1 | v2 */
  protocol: string;
  version: string;
  category: string;
  tags: string[];
  /** 主色调是亮还是暗（作者声明优先，未声明则按背景色亮度推断） */
  scheme: 'dark' | 'light';
  /** 封面图 URL（相对后端基址；无封面时为空串） */
  coverUrl: string;
  /** 目录内所有文件的字节总和 */
  fileSize: number;
  /** 目录 mtime（毫秒时间戳） */
  updatedAt: number;
}

/** 主题详情（多了预览图列表） */
export interface PlazaThemeDetail extends PlazaTheme {
  /** 预览图 URL 列表 */
  previews: string[];
}

export interface PlazaThemeList {
  items: PlazaTheme[];
  total: number;
  page: number;
}

export interface PlazaThemeQuery {
  q?: string;
  protocol?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

/** 拼出带查询串的 URL */
function themesUrl(cfg: LanConfig, query: PlazaThemeQuery = {}): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.protocol && query.protocol !== 'all') params.set('protocol', query.protocol);
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return `/api/themes${qs ? `?${qs}` : ''}`;
}

/** 拉取主题列表 */
export async function fetchPlazaThemes(
  cfg: LanConfig,
  query: PlazaThemeQuery = {},
): Promise<PlazaThemeList> {
  const res = await backendFetch<PlazaThemeList>(cfg, themesUrl(cfg, query));
  return {
    items: res.items ?? [],
    total: res.total ?? 0,
    page: res.page ?? 1,
  };
}

/** 拉取单个主题详情 */
export async function fetchPlazaTheme(
  cfg: LanConfig,
  slug: string,
): Promise<PlazaThemeDetail> {
  const res = await backendFetch<PlazaThemeDetail>(
    cfg,
    `/api/themes/${encodeURIComponent(slug)}`,
  );
  return res;
}

/** 封面图的完整 URL（跨端口访问时需要补全后端基址） */
export function plazaCoverUrl(cfg: LanConfig, theme: Pick<PlazaTheme, 'coverUrl'>): string {
  if (!theme.coverUrl) return '';
  if (/^https?:\/\//i.test(theme.coverUrl)) return theme.coverUrl;
  return `${backendBaseUrl(cfg)}${theme.coverUrl}`;
}

/** 预览图的完整 URL */
export function plazaPreviewUrl(cfg: LanConfig, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${backendBaseUrl(cfg)}${path}`;
}

/**
 * 下载主题的 .theme 文件内容（单文件信封制，可直接被「导入 .theme」识别）。
 *
 * 返回的是信封原文 —— 调用方用 `themePackOf()` 转成 ThemePack 并应用。
 */
export async function fetchPlazaThemeFile(
  cfg: LanConfig,
  slug: string,
): Promise<ThemePackage> {
  const res = await backendFetch<ThemePackage>(
    cfg,
    `/api/themes/${encodeURIComponent(slug)}/theme-file`,
  );
  if (!res || typeof res !== 'object' || !res.manifest || !res.pack) {
    throw new Error('后端返回的主题包内容为空');
  }
  return res;
}

/** 整个主题文件夹的 zip 下载地址（供 <a download> 使用） */
export function plazaZipUrl(cfg: LanConfig, slug: string): string {
  return `${backendBaseUrl(cfg)}/api/themes/${encodeURIComponent(slug)}/download`;
}

/**
 * 删除主题（管理员）
 *
 * 浏览通道也提供删除 —— 仓库里的主题是**文件夹制**，
 * 而 registry 的删除端点只处理 .theme 单文件，管不到文件夹。
 */
export async function deletePlazaTheme(
  cfg: LanConfig,
  token: string,
  slug: string,
): Promise<void> {
  await backendFetch(cfg, `/api/themes/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

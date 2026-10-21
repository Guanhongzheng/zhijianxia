/**
 * 主题包分类 —— 功能广场中「主题」分类页的筛选维度。
 *
 * 一个主题包通常以某一维度见长（主打配色 / 卡片风格 / 导航栏风格 / 壁纸 / 图标），
 * 因此广场里的主题分类既包含「综合」（全维度定制），
 * 也包含单一维度的细分类，方便用户按需挑选。
 *
 * 与后端 `server/src/routes/registry-validate.js` 的 THEME_CATEGORIES 保持一致。
 */

/** 全部主题分类（含「全部」筛选项） */
export const THEME_CATEGORIES = [
  { id: 'all', name: '全部', icon: 'LayoutGrid' },
  { id: '综合', name: '综合', icon: 'Sparkles' },
  { id: '配色', name: '配色', icon: 'Palette' },
  { id: '卡片', name: '卡片', icon: 'Square' },
  { id: '导航栏', name: '导航栏', icon: 'PanelTop' },
  { id: '壁纸', name: '壁纸', icon: 'Image' },
  { id: '图标', name: '图标', icon: 'Shapes' },
] as const;

/** 主题分类 id 列表 */
export type ThemeCategoryId = (typeof THEME_CATEGORIES)[number]['id'];

/** 合法的后端分类值（不含「全部」） */
export const THEME_CATEGORY_VALUES = [
  '综合',
  '配色',
  '卡片',
  '导航栏',
  '壁纸',
  '图标',
] as const;

/** 归一化主题分类：非法值回落到「综合」 */
export function normalizeThemeCategory(value: unknown): string {
  if (typeof value !== 'string') return '综合';
  const v = value.trim();
  return (THEME_CATEGORY_VALUES as readonly string[]).includes(v) ? v : '综合';
}

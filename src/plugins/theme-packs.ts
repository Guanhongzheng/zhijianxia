/**
 * 智简匣 · 插件主题包定义
 *
 * 主题包是「内核提供、插件只读引用」的静态数据：
 * - 主题中心插件通过 ctx.applyThemePack(id) 请求内核套用
 * - 插件自身通过 ctx.theme.packs 读取清单，通过 ctx.theme.accent / mode 感知当前生效值
 *
 * 这里只保存纯数据，真正的写入由内核（src/lib/theme）完成。
 */

/** 与 types.ts 中的 ThemePack 保持一致的结构 */
export interface ThemePackDefinition {
  id: string;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  /** 主色 */
  accent: string;
  /** 强调色（用于渐变 / 高亮） */
  secondary: string;
  /** 附加设计 token */
  tokens: Record<string, string>;
}

/** 内置主题包清单 */
export const THEME_PACKS: ThemePackDefinition[] = [
  {
    id: 'aurora',
    name: '极光',
    description: '青绿渐变，清爽通透',
    mode: 'light',
    accent: '#0ea5a4',
    secondary: '#22d3ee',
    tokens: { ring: '#0ea5a4', surface: '#f0fdfa' },
  },
  {
    id: 'dusk',
    name: '暮色',
    description: '紫粉夜色，安静专注',
    mode: 'dark',
    accent: '#8b5cf6',
    secondary: '#ec4899',
    tokens: { ring: '#8b5cf6', surface: '#1e1b2e' },
  },
  {
    id: 'meadow',
    name: '原野',
    description: '草木绿意，自然放松',
    mode: 'light',
    accent: '#16a34a',
    secondary: '#84cc16',
    tokens: { ring: '#16a34a', surface: '#f7fee7' },
  },
  {
    id: 'ember',
    name: '暖阳',
    description: '琥珀暖调，温和护眼',
    mode: 'light',
    accent: '#f59e0b',
    secondary: '#fb923c',
    tokens: { ring: '#f59e0b', surface: '#fffbeb' },
  },
  {
    id: 'midnight',
    name: '深海',
    description: '深蓝夜色，低调沉稳',
    mode: 'dark',
    accent: '#3b82f6',
    secondary: '#6366f1',
    tokens: { ring: '#3b82f6', surface: '#0f172a' },
  },
];

/** 按 id 查找主题包 */
export function findThemePack(id: string): ThemePackDefinition | undefined {
  return THEME_PACKS.find((pack) => pack.id === id);
}

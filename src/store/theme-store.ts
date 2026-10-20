'use client';

import { create } from 'zustand';
import {
  ACTIVE_THEME_KEY,
  BUILTIN_THEME_PACKS,
  SHADOW_PRESETS,
  THEME_MODE_KEY,
  THEME_STORAGE_KEY,
  type ThemePack,
  type ThemeVariant,
  type WallpaperRef,
} from '@/lib/theme/types';
import { readLocal, writeLocal } from '@/lib/utils';
import { getWallpaperBlob, idbSet, saveWallpaperBlob } from '@/lib/storage/idb';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  /** 全部主题包（内置 + 自定义） */
  packs: ThemePack[];
  /** 当前主题包 ID */
  activePackId: string;
  /** 当前亮/暗模式 */
  mode: ThemeMode;
  /** 主题包是否加载完成（加载期间显示骨架屏） */
  loading: boolean;
  /** 当前壁纸的 objectURL（用户自定义壁纸从 IndexedDB 读取后生成） */
  wallpaperUrl: string | null;

  init: () => Promise<void>;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setAccent: (hex: string) => void;
  applyThemePack: (id: string) => void;
  saveCustomPack: (pack: ThemePack) => void;
  removeCustomPack: (id: string) => void;
  resetPacks: () => void;
  setWallpaper: (mode: ThemeMode, ref: WallpaperRef) => Promise<void>;
  uploadWallpaper: (mode: ThemeMode, file: File) => Promise<void>;
  /** 内部：把指定主题包的壁纸应用到 DOM */
  applyWallpaperFor: (pack: ThemePack, mode: ThemeMode) => Promise<void>;
}

/** 计算主题包 CSS 变量 */
function buildCssVars(pack: ThemePack, mode: ThemeMode) {
  const v: ThemeVariant = mode === 'dark' ? pack.dark : pack.light;
  const shadow = SHADOW_PRESETS[v.shadow];
  const root = document.documentElement;
  const set = (k: string, val: string) => root.style.setProperty(k, val);

  set('--zj-accent', v.accent);
  set('--zj-accent-soft', v.accentSoft);
  set('--zj-card', v.card);
  set('--zj-bg', v.bg);
  set('--zj-fg', v.fg);
  set('--zj-muted-fg', v.mutedFg);
  set('--zj-border', v.border);
  set('--zj-radius', `${v.radius}px`);
  set('--zj-shadow', shadow[mode]);
  set('--zj-shadow-sm', v.shadow === 0 ? 'none' : shadow[mode]);
  set('--zj-muted', `color-mix(in srgb, ${v.fg} 6%, transparent)`);

  // 主色前景色：按主色亮度自动选黑/白，保证对比度
  const fg = pickForeground(v.accent);
  set('--zj-accent-fg', fg);
}

/** 根据背景色亮度选择黑或白文字 */
function pickForeground(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#ffffff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // 相对亮度近似
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#101216' : '#ffffff';
}

/** 应用壁纸 */
function applyWallpaper(pack: ThemePack, mode: ThemeMode, url: string | null) {
  const root = document.documentElement;
  const ref = pack.wallpaper?.[mode];
  if (!ref || ref.kind === 'none') {
    root.style.setProperty('--zj-wallpaper', 'none');
    root.style.setProperty('--zj-wallpaper-veil', '1');
    return;
  }
  if (ref.kind === 'gradient' && ref.gradient) {
    root.style.setProperty('--zj-wallpaper', ref.gradient);
  } else if (ref.kind === 'builtin' && ref.url) {
    root.style.setProperty('--zj-wallpaper', `url("${ref.url}")`);
  } else if (ref.kind === 'user' && url) {
    root.style.setProperty('--zj-wallpaper', `url("${url}")`);
  }
  root.style.setProperty('--zj-wallpaper-veil', String(ref.veil ?? 0.85));
}

/** 读取用户自定义壁纸的 objectURL */
async function resolveWallpaperUrl(pack: ThemePack, mode: ThemeMode): Promise<string | null> {
  const ref = pack.wallpaper?.[mode];
  if (!ref || ref.kind !== 'user' || !ref.storageKey) return null;
  const blob = await getWallpaperBlob(ref.storageKey);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  packs: BUILTIN_THEME_PACKS,
  activePackId: 'ink-default',
  mode: 'light',
  loading: true,
  wallpaperUrl: null,

  /** 初始化：读取 LocalStorage 中的主题包与当前选择 */
  init: async () => {
    const custom = readLocal<ThemePack[]>(THEME_STORAGE_KEY, []);
    const packs = [...BUILTIN_THEME_PACKS, ...custom.filter((p) => !p.builtin)];
    const activePackId = readLocal<string>(ACTIVE_THEME_KEY, 'ink-default');
    const mode = readLocal<ThemeMode>(THEME_MODE_KEY, 'light');
    const safePackId = packs.some((p) => p.id === activePackId)
      ? activePackId
      : packs[0].id;

    set({ packs, activePackId: safePackId, mode });

    const pack = packs.find((p) => p.id === safePackId) ?? packs[0];
    buildCssVars(pack, mode);
    const url = await resolveWallpaperUrl(pack, mode);
    set({ wallpaperUrl: url });
    applyWallpaper(pack, mode, url);

    // 同步 <html> 的 dark class
    document.documentElement.classList.toggle('dark', mode === 'dark');
    set({ loading: false });
  },

  setMode: (mode) => {
    const { packs, activePackId } = get();
    const pack = packs.find((p) => p.id === activePackId) ?? packs[0];
    writeLocal(THEME_MODE_KEY, mode);
    document.documentElement.classList.toggle('dark', mode === 'dark');
    buildCssVars(pack, mode);
    void (async () => {
      const url = await resolveWallpaperUrl(pack, mode);
      set({ wallpaperUrl: url, mode });
      applyWallpaper(pack, mode, url);
    })();
  },

  toggleMode: () => {
    get().setMode(get().mode === 'dark' ? 'light' : 'dark');
  },

  /** 自定义主色：写回当前主题包（内置包则派生为自定义副本） */
  setAccent: (hex) => {
    const { packs, activePackId, mode } = get();
    const idx = packs.findIndex((p) => p.id === activePackId);
    if (idx < 0) return;

    const base = packs[idx];
    const next: ThemePack = base.builtin
      ? {
          ...base,
          id: `custom-${Date.now()}`,
          builtin: false,
          name: `${base.name} · 自定义`,
          light: { ...base.light },
          dark: { ...base.dark },
          createdAt: Date.now(),
        }
      : { ...base, light: { ...base.light }, dark: { ...base.dark } };

    const variant = mode === 'dark' ? next.dark : next.light;
    variant.accent = hex;
    variant.accentSoft = `color-mix(in srgb, ${hex} 14%, transparent)`;

    const nextPacks =
      base.builtin
        ? [...packs.slice(0, idx + 1), next, ...packs.slice(idx + 1)]
        : packs.map((p, i) => (i === idx ? next : p));

    writeLocal(THEME_STORAGE_KEY, nextPacks.filter((p) => !p.builtin));
    writeLocal(ACTIVE_THEME_KEY, next.id);
    set({ packs: nextPacks, activePackId: next.id });
    buildCssVars(next, mode);
  },

  /** 切换主题包：全局配色、卡片样式、壁纸一起切换 */
  applyThemePack: (id) => {
    const { packs, mode } = get();
    const pack = packs.find((p) => p.id === id);
    if (!pack) return;
    writeLocal(ACTIVE_THEME_KEY, id);
    set({ activePackId: id });
    buildCssVars(pack, mode);
    void (async () => {
      const url = await resolveWallpaperUrl(pack, mode);
      set({ wallpaperUrl: url });
      applyWallpaper(pack, mode, url);
    })();
  },

  /** 保存自定义主题包 */
  saveCustomPack: (pack) => {
    const { packs } = get();
    const next = [...packs.filter((p) => p.id !== pack.id), { ...pack, builtin: false }];
    writeLocal(THEME_STORAGE_KEY, next.filter((p) => !p.builtin));
    set({ packs: next });
  },

  /** 删除自定义主题包 */
  removeCustomPack: (id) => {
    const { packs, activePackId } = get();
    const next = packs.filter((p) => p.id !== id);
    writeLocal(THEME_STORAGE_KEY, next.filter((p) => !p.builtin));
    set({ packs: next });
    if (activePackId === id) {
      get().applyThemePack(next[0].id);
    }
  },

  /** 重置主题包：清空自定义，恢复内置 */
  resetPacks: () => {
    writeLocal(THEME_STORAGE_KEY, []);
    writeLocal(ACTIVE_THEME_KEY, 'ink-default');
    set({ packs: BUILTIN_THEME_PACKS });
    get().applyThemePack('ink-default');
  },

  /** 设置指定模式的壁纸（内置渐变 / 内置图片） */
  setWallpaper: async (mode, ref) => {
    const { packs, activePackId } = get();
    const idx = packs.findIndex((p) => p.id === activePackId);
    if (idx < 0) return;
    const base = packs[idx];
    const next: ThemePack = {
      ...base,
      builtin: false,
      id: base.builtin ? `custom-${Date.now()}` : base.id,
      name: base.builtin ? `${base.name} · 自定义` : base.name,
      light: { ...base.light },
      dark: { ...base.dark },
      wallpaper: { ...(base.wallpaper ?? {}) },
      createdAt: Date.now(),
    };
    next.wallpaper = { ...(next.wallpaper ?? {}), [mode]: ref };
    const nextPacks =
      base.builtin
        ? [...packs.slice(0, idx + 1), next, ...packs.slice(idx + 1)]
        : packs.map((p, i) => (i === idx ? next : p));
    writeLocal(THEME_STORAGE_KEY, nextPacks.filter((p) => !p.builtin));
    writeLocal(ACTIVE_THEME_KEY, next.id);
    set({ packs: nextPacks, activePackId: next.id });
    await get().applyWallpaperFor(next, mode);
  },

  /** 上传自定义壁纸图片（存 IndexedDB） */
  uploadWallpaper: async (mode, file) => {
    const key = `wallpaper-${Date.now()}-${file.name}`;
    await saveWallpaperBlob(key, file);
    await get().setWallpaper(mode, { kind: 'user', storageKey: key, veil: 0.85 });
  },

  /** 内部：应用壁纸到 DOM */
  applyWallpaperFor: async (pack, mode) => {
    const url = await resolveWallpaperUrl(pack, mode);
    set({ wallpaperUrl: url });
    applyWallpaper(pack, mode, url);
  },
}));

/** 供插件读取当前主题快照 */
export function readThemeSnapshot() {
  const { packs, activePackId, mode } = useThemeStore.getState();
  const pack = packs.find((p) => p.id === activePackId) ?? packs[0];
  const variant = mode === 'dark' ? pack.dark : pack.light;
  return {
    mode,
    accent: variant.accent,
    packId: pack.id,
    packs,
    tokens: {
      bg: variant.bg,
      card: variant.card,
      fg: variant.fg,
      accent: variant.accent,
      accentSoft: variant.accentSoft,
      border: variant.border,
      mutedFg: variant.mutedFg,
      radius: `${variant.radius}px`,
    },
  };
}

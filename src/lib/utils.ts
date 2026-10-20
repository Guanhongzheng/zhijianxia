import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并 Tailwind 类名，后者覆盖前者的同类属性 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 生成短随机 ID（用于本地临时标识） */
export function shortId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 格式化时间戳为「刚刚 / x分钟前 / MM-DD HH:mm」 */
export function formatTime(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 读取 localStorage（SSR 安全） */
export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 写入 localStorage（SSR 安全，失败静默） */
export function writeLocal<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存储配额不足时忽略 */
  }
}

/** 延时工具 */
export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 生成头像底色（依据标识散列到固定调色板）。
 * 参数可能缺失（接口异常、字段改名等），此处做纵深防御：
 * 任何非法输入都退回默认色，绝不抛错导致整页白屏。
 */
export function avatarColor(seed?: string | null): string {
  const palette = [
    '#4f6bed',
    '#12a594',
    '#e5484d',
    '#f76b15',
    '#8e4ec6',
    '#0091ff',
    '#e93d82',
    '#3f9e4a',
  ];
  const text = typeof seed === 'string' ? seed : '';
  if (!text) return palette[0];
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

/** 轻量错误归一化：把未知异常转为可读中文文案 */
export function friendlyError(err: unknown): string {
  if (err instanceof Error) {
    if (/fetch|network|Failed to fetch/i.test(err.message)) {
      return '网络连接失败，请检查后端服务是否已启动';
    }
    return err.message || '操作失败，请稍后重试';
  }
  if (typeof err === 'string') return err;
  return '操作失败，请稍后重试';
}

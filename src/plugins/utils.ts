/**
 * 智简匣 · 插件共享工具
 *
 * 说明：这里刻意不依赖 @/lib/utils，避免与主框架的工具函数耦合，
 * 插件内部自行处理类名合并与零散小工具。
 */

import type { PluginAIRequest, PluginContext } from './types';

/** 合并类名（过滤空值） */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** 生成短随机 id（不依赖 crypto.randomUUID，兼容旧浏览器） */
export function uid(prefix = 'id'): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

/** 延时（毫秒） */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 数值裁剪 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** 数字格式化：最多保留 digits 位小数并去掉多余的 0 */
export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  const fixed = value.toFixed(digits);
  return fixed.replace(/\.?0+$/, '');
}

/** 秒 -> mm:ss */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 时间戳 -> 相对时间描述 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 从 AI 输出中宽松地提取 JSON。
 * 优先解析整段文本，失败后截取第一个平衡的 {} 或 [] 片段再试。
 */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  // 去掉 ```json 包裹
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

  const candidates: string[] = [fenced];

  const start = fenced.search(/[[{]/);
  if (start >= 0) {
    const open = fenced[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < fenced.length; i += 1) {
      const ch = fenced[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          candidates.push(fenced.slice(start, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  return null;
}

/** 复制文本到剪贴板（浏览器环境） */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 忽略：降级处理 */
  }
  return false;
}

/** 判断是否为空白字符串 */
export function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim().length === 0;
}

/* -------------------------------------------------------------------------- */
/* AI 调用助手                                                                  */
/* -------------------------------------------------------------------------- */

/** AI 调用选项 */
export interface AiRunOptions {
  /** 系统提示词 */
  system?: string;
  /** 用户输入 */
  user: string;
  /** 温度 */
  temperature?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
}

/**
 * 统一的 AI 调用入口。
 *
 * ⚠️ 这里曾**不检查 `ctx.ai.available` 就直接调用** ——
 * 于是「模型还没加载」时用户点按钮只会看到一句笼统的失败提示，
 * 不知道该去设置里加载模型、启动后端还是先登录。
 * 现在不可用时直接抛出内核给出的**可执行**原因。
 *
 * @returns 模型输出的纯文本
 */
export async function runAi(ctx: PluginContext, options: AiRunOptions): Promise<string> {
  // 内核给出的原因比插件自己猜得准（它知道是未加载 / 未启动 / 未登录）
  if (!ctx.ai.available) {
    throw new Error(ctx.ai.unavailableReason || '当前 AI 能力不可用');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: options.user });

  const request: PluginAIRequest = {
    messages,
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens,
  };

  const response = await ctx.ai.chat(request);
  const text = (response?.text ?? '').trim();
  // 模型可能返回空串（例如只吐了模板标记），此时给出明确原因而非让插件显示空白
  if (!text) {
    throw new Error('模型没有返回任何内容，请换个说法再试一次');
  }
  return text;
}

/**
 * 统一的流式 AI 调用入口（若调度器不支持流式则回退为一次性返回整段文本）。
 * @param onChunk 每收到一段增量文本时回调
 */
export async function runAiStream(
  ctx: PluginContext,
  options: AiRunOptions,
  onChunk: (chunk: string) => void,
): Promise<string> {
  if (!ctx.ai.available) {
    throw new Error(ctx.ai.unavailableReason || '当前 AI 能力不可用');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: options.user });

  if (typeof ctx.ai.streamChat === 'function') {
    let full = '';
    const iterable = ctx.ai.streamChat({
      messages,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens,
    });
    for await (const chunk of iterable) {
      if (!chunk) continue;
      full += chunk;
      onChunk(chunk);
    }
    return full.trim();
  }

  const response = await ctx.ai.chat({ messages, temperature: options.temperature ?? 0.7 });
  const text = (response?.text ?? '').trim();
  if (text) onChunk(text);
  return text;
}

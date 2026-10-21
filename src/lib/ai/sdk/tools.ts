/**
 * AI SDK 工具定义层
 *
 * ## 设计要点
 *
 * 工具是「模型能调用、内核能执行、前端能渲染」的三方契约，因此定义必须**前后端共享**：
 *
 * - 前端（`src/lib/ai/sdk/tools.ts`）用 zod 描述参数，并在**浏览器内**执行工具，
 *   这样本地模式下（模型跑在 WebGPU/WASM）也能用上工具，不必依赖后端。
 * - 后端（`server/src/routes/ai-stream.js`）复用同一份 schema，把工具描述随请求
 *   透传给外部模型，并在**服务端**执行（外部 API 模式下工具由后端跑更稳）。
 *
 * 为避免前后端各写一份导致漂移，**工具描述（name/description/parameters）**
 * 放在 `shared/ai-tools.json`，前后端都读它；只有「怎么执行」的部分各自实现。
 *
 * ## 为什么用 zod
 *
 * AI SDK 的 `tool()` 需要 schema 来做参数校验与 JSON Schema 转换。
 * zod 4 同时被前后端支持，且能被 AI SDK 识别为第一方 schema。
 */

import { z } from 'zod';
import { tool } from 'ai';
import toolCatalog from '../../../../shared/ai-tools.json';

/**
 * 工具清单（来自 shared/ai-tools.json —— 前后端唯一数据源）。
 *
 * 这里的 JSON 只承载「描述」，不承载「行为」：
 * - 前端据此渲染工具卡片、生成 UI
 * - 后端据此告知外部模型有哪些工具可用
 */
export interface ToolDescriptor {
  /** 工具名（模型调用时使用） */
  name: string;
  /** 给模型看的说明 */
  description: string;
  /** 参数的 JSON Schema */
  parameters: Record<string, unknown>;
  /** 归类，用于前端分组展示 */
  group: string;
  /** 图标名（lucide） */
  icon: string;
}

export const AI_TOOLS: ToolDescriptor[] =
  toolCatalog.tools as ToolDescriptor[];

/** 按名字取工具描述 */
export function toolDescriptor(name: string): ToolDescriptor | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

/* -------------------------------------------------------------------------- */
/* 参数 schema                                                                */
/* -------------------------------------------------------------------------- */

/** 计算器：表达式求值 */
export const calculatorSchema = z.object({
  expression: z
    .string()
    .describe('要计算的数学表达式，例如 (12+8)*3.5。只允许数字与 + - * / % ^ ( ) . 空格'),
});

/** 当前时间 */
export const currentTimeSchema = z.object({
  timezone: z
    .string()
    .optional()
    .describe('IANA 时区名，例如 Asia/Shanghai。留空则使用本机时区'),
});

/** 单位换算 */
export const unitConvertSchema = z.object({
  value: z.number().describe('要换算的数值'),
  from: z.string().describe('源单位，如 km / m / cm / kg / g / lb / celsius / fahrenheit'),
  to: z.string().describe('目标单位，同上'),
});

/** 文本统计 */
export const textStatsSchema = z.object({
  text: z.string().describe('要统计的文本'),
});

/** 随机数 */
export const randomNumberSchema = z.object({
  min: z.number().int().describe('最小值（含）'),
  max: z.number().int().describe('最大值（含）'),
});

/* -------------------------------------------------------------------------- */
/* 工具执行体（浏览器内）                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 安全的表达式求值。
 *
 * 不用 `eval` / `new Function` —— 那等于把任意代码执行能力交给模型输出。
 * 这里用「词法切分 + 递归下降」实现，只认数字与四则运算，
 * 遇到任何其它字符直接抛错。
 */
export function evaluateExpression(expression: string): number {
  const src = expression.replace(/\s+/g, '');
  if (!src) throw new Error('表达式为空');
  if (!/^[0-9+\-*/%^().]+$/.test(src)) {
    throw new Error('表达式含有非法字符，只允许数字与 + - * / % ^ ( ) .');
  }

  let pos = 0;

  const peek = () => src[pos];
  const eat = (ch: string) => {
    if (src[pos] === ch) {
      pos += 1;
      return true;
    }
    return false;
  };

  /** 解析一元前缀（负号） */
  function parseUnary(): number {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parsePower();
  }

  /** 幂运算（右结合） */
  function parsePower(): number {
    const base = parsePrimary();
    if (eat('^')) return Math.pow(base, parseUnary());
    return base;
  }

  function parsePrimary(): number {
    if (eat('(')) {
      const value = parseExpression();
      if (!eat(')')) throw new Error('括号不匹配');
      return value;
    }
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos += 1;
    if (start === pos) throw new Error('表达式格式错误');
    const num = Number(src.slice(start, pos));
    if (!Number.isFinite(num)) throw new Error('表达式含有非法数字');
    return num;
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      if (eat('*')) value *= parseUnary();
      else if (eat('/')) {
        const rhs = parseUnary();
        if (rhs === 0) throw new Error('除数不能为 0');
        value /= rhs;
      } else if (eat('%')) {
        const rhs = parseUnary();
        if (rhs === 0) throw new Error('取模的除数不能为 0');
        value %= rhs;
      } else return value;
    }
  }

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      if (eat('+')) value += parseTerm();
      else if (eat('-')) value -= parseTerm();
      else return value;
    }
  }

  const result = parseExpression();
  if (pos !== src.length) throw new Error('表达式格式错误');
  return result;
}

/** 单位换算表：以「米」或「摄氏度」为基准 */
const LENGTH_TO_METER: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  inch: 0.0254,
  ft: 0.3048,
  mile: 1609.344,
};

const WEIGHT_TO_KG: Record<string, number> = {
  mg: 0.000001,
  g: 0.001,
  kg: 1,
  t: 1000,
  oz: 0.028349523125,
  lb: 0.45359237,
};

/** 换算结果 */
export interface UnitConvertResult {
  value: number;
  from: string;
  to: string;
  result: number;
}

/** 执行单位换算 */
export function convertUnit(
  value: number,
  from: string,
  to: string,
): UnitConvertResult {
  const f = from.trim().toLowerCase();
  const t = to.trim().toLowerCase();
  if (f === t) return { value, from, to, result: value };

  // 长度
  if (f in LENGTH_TO_METER && t in LENGTH_TO_METER) {
    return {
      value,
      from,
      to,
      result: (value * LENGTH_TO_METER[f]) / LENGTH_TO_METER[t],
    };
  }
  // 重量
  if (f in WEIGHT_TO_KG && t in WEIGHT_TO_KG) {
    return {
      value,
      from,
      to,
      result: (value * WEIGHT_TO_KG[f]) / WEIGHT_TO_KG[t],
    };
  }
  // 温度（特殊公式，不走线性比例）
  const isTemp = (u: string) =>
    u === 'celsius' || u === 'c' || u === 'fahrenheit' || u === 'f';
  if (isTemp(f) && isTemp(t)) {
    const celsius = f === 'c' || f === 'celsius' ? value : (value - 32) * (5 / 9);
    const result =
      t === 'c' || t === 'celsius' ? celsius : celsius * (9 / 5) + 32;
    return { value, from, to, result };
  }

  throw new Error(`暂不支持 ${from} → ${to} 的换算`);
}

/** 文本统计结果 */
export interface TextStatsResult {
  characters: number;
  charactersNoSpace: number;
  words: number;
  lines: number;
  paragraphs: number;
}

/** 统计文本 */
export function computeTextStats(text: string): TextStatsResult {
  const characters = Array.from(text).length;
  const charactersNoSpace = Array.from(text.replace(/\s/g, '')).length;
  // 中英文混排：英文按空白切词，中文按字计
  const words =
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .reduce((acc, token) => {
        const cjk = Array.from(token).filter(
          (ch) => /[一-龥]/.test(ch),
        ).length;
        const latin = token.replace(/[一-龥]/g, ' ').trim();
        return acc + cjk + (latin ? latin.split(/\s+/).length : 0);
      }, 0) || 0;
  const lines = text ? text.split(/\r?\n/).length : 0;
  const paragraphs = text.trim()
    ? text.trim().split(/\n\s*\n/).filter(Boolean).length
    : 0;
  return { characters, charactersNoSpace, words, lines, paragraphs };
}

/* -------------------------------------------------------------------------- */
/* AI SDK 工具集                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 浏览器内执行的工具集。
 *
 * 通过 `tool({ description, inputSchema, execute })` 声明：
 * - `inputSchema` 用 zod，AI SDK 会自动转成 JSON Schema 发给模型
 * - `execute` 在浏览器里跑，天然满足「本地优先、离线可用」
 */
export const browserTools = {
  calculator: tool({
    description:
      '计算一个数学表达式并返回结果。支持 + - * / % ^ 与括号，' +
      '例如 (12+8)*3.5。需要算数时优先使用本工具。',
    inputSchema: calculatorSchema,
    execute: async ({ expression }) => {
      const result = evaluateExpression(expression);
      return { expression, result };
    },
  }),

  currentTime: tool({
    description: '获取当前日期与时间。可选传入 IANA 时区名。',
    inputSchema: currentTimeSchema,
    execute: async ({ timezone }) => {
      const now = new Date();
      const iso = timezone
        ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: timezone,
            dateStyle: 'full',
            timeStyle: 'medium',
          }).format(now)
        : now.toLocaleString('zh-CN');
      return {
        iso: now.toISOString(),
        timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        display: iso,
      };
    },
  }),

  unitConvert: tool({
    description:
      '换算单位。支持长度（mm/cm/m/km/inch/ft/mile）、重量（mg/g/kg/t/oz/lb）、' +
      '温度（celsius/fahrenheit）。',
    inputSchema: unitConvertSchema,
    execute: async ({ value, from, to }) => convertUnit(value, from, to),
  }),

  textStats: tool({
    description: '统计一段文本的字符数、词数、行数与段落数。',
    inputSchema: textStatsSchema,
    execute: async ({ text }) => computeTextStats(text),
  }),

  randomNumber: tool({
    description: '在给定闭区间内生成一个随机整数。',
    inputSchema: randomNumberSchema,
    execute: async ({ min, max }) => {
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      return { min: lo, max: hi, result: lo + Math.floor(Math.random() * (hi - lo + 1)) };
    },
  }),
};

/** 工具名 → 执行器，供动态分发 */
export type BrowserToolName = keyof typeof browserTools;

/** 判断某个工具名是否由浏览器执行 */
export function isBrowserTool(name: string): name is BrowserToolName {
  return name in browserTools;
}

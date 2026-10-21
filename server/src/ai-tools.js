'use strict';

/**
 * ai-tools.js —— 后端工具执行器
 *
 * 工具的「描述」在 shared/ai-tools.json（前后端唯一数据源），
 * 本文件只负责「怎么执行」，与前端 src/lib/ai/sdk/tools.ts 保持同名同语义。
 *
 * 为什么后端也要执行一遍：
 *   外部模型（OpenAI / Claude / Gemini）的原生 function calling
 *   由模型服务端驱动，需要在同一侧连续完成「模型请求工具 → 执行 → 回灌 → 继续生成」，
 *   所以后端必须有执行器；前端的同款实现用于**浏览器内本地推理**路径。
 */

const crypto = require('node:crypto');

/* ------------------------------------------------------------------ *
 * 安全表达式求值（不用 eval / new Function）
 * ------------------------------------------------------------------ */

const ALLOWED_CHARS = /^[0-9+\-*/%^().\s]+$/;

/**
 * 递归下降解析器求值数学表达式
 * @param {string} expression
 * @returns {number}
 */
function evaluateExpression(expression) {
  const src = String(expression || '').trim();
  if (!src) throw new Error('表达式为空');
  if (src.length > 200) throw new Error('表达式过长');
  if (!ALLOWED_CHARS.test(src)) throw new Error('表达式包含非法字符');

  let pos = 0;

  const skipSpace = () => {
    while (pos < src.length && /\s/.test(src[pos])) pos += 1;
  };

  const parseExpression = () => {
    let value = parseTerm();
    for (;;) {
      skipSpace();
      const ch = src[pos];
      if (ch === '+' || ch === '-') {
        pos += 1;
        const right = parseTerm();
        value = ch === '+' ? value + right : value - right;
      } else {
        return value;
      }
    }
  };

  const parseTerm = () => {
    let value = parsePower();
    for (;;) {
      skipSpace();
      const ch = src[pos];
      if (ch === '*' || ch === '/' || ch === '%') {
        pos += 1;
        const right = parsePower();
        if ((ch === '/' || ch === '%') && right === 0) throw new Error('除数不能为 0');
        value = ch === '*' ? value * right : ch === '/' ? value / right : value % right;
      } else {
        return value;
      }
    }
  };

  const parsePower = () => {
    const base = parseUnary();
    skipSpace();
    if (src[pos] === '^') {
      pos += 1;
      const exponent = parsePower();
      return Math.pow(base, exponent);
    }
    return base;
  };

  const parseUnary = () => {
    skipSpace();
    const ch = src[pos];
    if (ch === '-') {
      pos += 1;
      return -parseUnary();
    }
    if (ch === '+') {
      pos += 1;
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = () => {
    skipSpace();
    if (src[pos] === '(') {
      pos += 1;
      const value = parseExpression();
      skipSpace();
      if (src[pos] !== ')') throw new Error('括号不匹配');
      pos += 1;
      return value;
    }
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos += 1;
    if (start === pos) throw new Error('表达式格式错误');
    const num = Number(src.slice(start, pos));
    if (!Number.isFinite(num)) throw new Error('表达式格式错误');
    return num;
  };

  const result = parseExpression();
  skipSpace();
  if (pos !== src.length) throw new Error('表达式格式错误');
  if (!Number.isFinite(result)) throw new Error('计算结果不是有限数');
  return result;
}

/* ------------------------------------------------------------------ *
 * 单位换算
 * ------------------------------------------------------------------ */

const LENGTH_TO_METER = {
  mm: 0.001, cm: 0.01, m: 1, km: 1000,
  inch: 0.0254, ft: 0.3048, mile: 1609.344,
};
const WEIGHT_TO_KG = {
  mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237,
};

function normalizeUnit(unit) {
  return String(unit || '').trim().toLowerCase().replace(/°|度/g, '');
}

/**
 * 单位换算
 * @param {number} value
 * @param {string} from
 * @param {string} to
 */
function convertUnit(value, from, to) {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error('数值不合法');

  const isTemp = (u) => u === 'celsius' || u === 'c' || u === 'fahrenheit' || u === 'f';
  if (isTemp(f) || isTemp(t)) {
    if (!isTemp(f) || !isTemp(t)) throw new Error('温度只能与温度互换');
    const celsius = f === 'c' || f === 'celsius' ? num : ((num - 32) * 5) / 9;
    const out = t === 'c' || t === 'celsius' ? celsius : celsius * 1.8 + 32;
    return { from: f, to: t, value: num, result: Math.round(out * 1e6) / 1e6 };
  }

  const lengthF = LENGTH_TO_METER[f];
  const lengthT = LENGTH_TO_METER[t];
  if (lengthF && lengthT) {
    return { from: f, to: t, value: num, result: Math.round((num * lengthF) / lengthT * 1e6) / 1e6 };
  }

  const weightF = WEIGHT_TO_KG[f];
  const weightT = WEIGHT_TO_KG[t];
  if (weightF && weightT) {
    return { from: f, to: t, value: num, result: Math.round((num * weightF) / weightT * 1e6) / 1e6 };
  }

  throw new Error(`暂不支持 ${from} → ${to} 的换算`);
}

/* ------------------------------------------------------------------ *
 * 文本统计
 * ------------------------------------------------------------------ */

/**
 * 中英文混排词数统计：CJK 按字计，其余按空白分词
 */
function computeTextStats(text) {
  const raw = String(text ?? '');
  const characters = Array.from(raw).length;
  const cjk = (raw.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const nonCjk = raw
    .replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  const words = cjk + nonCjk;
  const lines = raw === '' ? 0 : raw.split(/\r\n|\r|\n/).length;
  const paragraphs = raw.trim() === '' ? 0 : raw.trim().split(/\n\s*\n/).filter((p) => p.trim()).length;
  return {
    characters,
    charactersNoSpace: Array.from(raw.replace(/\s/g, '')).length,
    words,
    lines,
    paragraphs,
    cjk,
    latin: nonCjk,
  };
}

/* ------------------------------------------------------------------ *
 * 分发
 * ------------------------------------------------------------------ */

/**
 * 执行一个工具
 * @param {string} name 工具名
 * @param {object} input 入参
 * @returns {Promise<object>} 工具输出（会回灌给模型）
 */
async function executeTool(name, input) {
  switch (name) {
    case 'calculator': {
      const expression = String(input?.expression ?? '');
      return { expression, result: evaluateExpression(expression) };
    }
    case 'currentTime': {
      const timezone = String(input?.timezone ?? '').trim();
      const now = new Date();
      let parts;
      try {
        parts = new Intl.DateTimeFormat('zh-CN', {
          timeZone: timezone || undefined,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).formatToParts(now);
      } catch {
        throw new Error(`无法识别的时区：${timezone}`);
      }
      const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
      return {
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        iso: now.toISOString(),
        date: `${pick('year')}-${pick('month')}-${pick('day')}`,
        time: `${pick('hour')}:${pick('minute')}:${pick('second')}`,
        weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now),
      };
    }
    case 'unitConvert':
      return convertUnit(input?.value, input?.from, input?.to);
    case 'textStats':
      return computeTextStats(input?.text);
    case 'randomNumber': {
      let min = Math.trunc(Number(input?.min));
      let max = Math.trunc(Number(input?.max));
      if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('随机区间不合法');
      if (min > max) [min, max] = [max, min];
      if (max - min > 1e9) throw new Error('随机区间过大');
      // 工具应当可复现：入参相同时借助名称盐给出一致结果由调用方决定，
      // 这里只保证区间与整数语义正确。
      return { min, max, result: crypto.randomInt(min, max + 1) };
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

module.exports = {
  executeTool,
  evaluateExpression,
  convertUnit,
  computeTextStats,
};
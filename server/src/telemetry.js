'use strict';

/**
 * telemetry.js —— 错误与性能事件的归一化、汇总与 Sentry 转发
 *
 * 为什么自建而不是直接上 `@sentry/browser`：
 *   1. 本项目是「本地离线优先」的局域网工具，把每次点击都发到第三方云端与定位冲突；
 *   2. SDK 会给首屏加 ~200 KB（gzip 后 ~60 KB），而我们需要的功能只有
 *      「收错误 + 收 Web Vitals + 能看汇总」三件；
 *   3. 真要接 Sentry 时不需要 SDK —— Sentry 的 Store API 就是一个 HTTP POST，
 *      配好 DSN 即可转发（见 forwardToSentry）。
 *
 * 隐私边界：
 *   - 不采集用户 id、昵称、消息内容；
 *   - message 会截断到 500 字，context 序列化后截断到 1000 字；
 *   - 请求路径里的数字段统一替换为 `:id`，避免把用户 id 带进来。
 */

const crypto = require('node:crypto');

/** 合法级别（未知值一律按 error 处理，宁可多记也不丢） */
const LEVELS = new Set(['error', 'warn', 'info', 'metric']);

/** 各字段的长度上限 */
const LIMITS = { name: 64, message: 500, context: 1000, path: 200 };

function truncate(value, max) {
  const str = String(value);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/**
 * 把请求路径里的动态段抹掉：`/api/themes/abyss-glass/cover` → `/api/themes/:id/cover`
 * 目的是聚合（否则每个主题一个 key），顺带避免把用户 id 写进日志。
 */
function normalizePath(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  const path = raw.split('?')[0].split('#')[0];
  return truncate(
    path
      .split('/')
      .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(seg) ? ':id' : seg))
      .join('/'),
    LIMITS.path,
  );
}

/**
 * 归一化单条事件。
 * @param {unknown} raw 客户端上报的原始对象
 * @returns {{ok:true, event:object} | {ok:false, reason:string}}
 */
function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: '事件必须是对象' };
  }

  const level = typeof raw.level === 'string' && LEVELS.has(raw.level) ? raw.level : 'error';
  const name = typeof raw.name === 'string' && raw.name.trim() ? truncate(raw.name.trim(), LIMITS.name) : 'unknown';
  const message = typeof raw.message === 'string' ? truncate(raw.message.trim(), LIMITS.message) : '';

  // 指标事件可以没有 message，但必须有可解析的数值
  let value;
  if (level === 'metric') {
    const num = Number(raw.value);
    if (!Number.isFinite(num)) return { ok: false, reason: '指标事件缺少有效 value' };
    value = num;
  } else if (!message) {
    return { ok: false, reason: '错误事件缺少 message' };
  }

  let context = null;
  if (raw.context !== undefined && raw.context !== null) {
    try {
      context = truncate(JSON.stringify(raw.context), LIMITS.context);
    } catch {
      // 循环引用等无法序列化的情况：丢掉 context 也要保住主事件
      context = null;
    }
  }

  return {
    ok: true,
    event: {
      level,
      name,
      message,
      ...(value !== undefined ? { value } : {}),
      context,
      path: normalizePath(raw.path),
      ts: Number.isFinite(Number(raw.ts)) ? Number(raw.ts) : Date.now(),
    },
  };
}

/**
 * 汇总事件列表。
 * @param {{level:string,name:string,message:string,value?:number}[]} events
 * @returns {{total:number, byLevel:Record<string,number>, topMessages:{message:string,count:number}[], metrics:Record<string,{count:number,p50:number,p95:number,max:number}>}}
 */
function summarize(events) {
  const list = Array.isArray(events) ? events : [];
  const byLevel = {};
  const messageCount = new Map();
  const metrics = {};

  for (const event of list) {
    byLevel[event.level] = (byLevel[event.level] ?? 0) + 1;

    if (event.level === 'metric') {
      const key = event.name || 'unknown';
      (metrics[key] ??= []).push(Number(event.value) || 0);
    } else if (event.message) {
      messageCount.set(event.message, (messageCount.get(event.message) ?? 0) + 1);
    }
  }

  /**
   * 最近秩法（nearest-rank）取分位数。
   *
   * 早先用 `floor((n-1) * p)`：3 个样本时 p95 会落到第 2 个值，
   * 比 max 还小 —— 明明是「95 分位」却看不到最差的那次，等于把尾部延迟藏起来。
   * 最近秩法在 n=3、p=0.95 时取第 3 个值（= max），符合直觉。
   */
  const percentile = (sorted, p) => {
    if (sorted.length === 0) return 0;
    const rank = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
  };

  const metricStats = {};
  for (const [name, values] of Object.entries(metrics)) {
    const sorted = [...values].sort((a, b) => a - b);
    metricStats[name] = {
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted[sorted.length - 1],
    };
  }

  const topMessages = [...messageCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  return { total: list.length, byLevel, topMessages, metrics: metricStats };
}

/**
 * 解析 Sentry DSN：`https://<key>@<host>/<projectId>`
 * @returns {{endpoint:string, key:string} | null} 无法解析时返回 null（调用方降级为只存本地）
 */
function parseDsn(dsn) {
  if (typeof dsn !== 'string' || !dsn.trim()) return null;
  try {
    const url = new URL(dsn.trim());
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, '');
    if (!key || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      key,
    };
  } catch {
    return null;
  }
}

/**
 * 用 Sentry 的 Store API 转发一条错误事件（无需 SDK）。
 *
 * 只在配置了 SENTRY_DSN 时调用；转发失败不影响本地记录。
 * @returns {Promise<boolean>} 是否成功
 */
async function forwardToSentry(event, dsn) {
  const parsed = parseDsn(dsn);
  if (!parsed) return false;

  const payload = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date(event.ts ?? Date.now()).toISOString(),
    platform: 'javascript',
    level: event.level === 'warn' ? 'warning' : event.level,
    logger: 'zhijianxia',
    message: { formatted: event.message || event.name },
    tags: { source: 'zhijianxia-web', path: event.path },
    extra: event.context ? { context: event.context } : undefined,
  };

  try {
    const res = await fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=zhijianxia/1.0`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { LEVELS, normalizeEvent, summarize, normalizePath, parseDsn, forwardToSentry };

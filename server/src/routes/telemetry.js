'use strict';

/**
 * telemetry.js（路由）—— 前端错误 / 性能事件的接收与查看
 *
 * POST   /api/telemetry          上报（免鉴权：崩在登录前的错误最需要被看到）
 * GET    /api/telemetry/summary  汇总（需管理员）
 * DELETE /api/telemetry          清空（需管理员）
 *
 * 免鉴权端点必须有防线，这里是三层：
 *   1. 批量上限 50 条 / 次；
 *   2. 内存级限流（同 IP 每分钟 60 次请求、1200 条事件）；
 *   3. 字段白名单 + 长度截断（见 telemetry.js 的 normalizeEvent）。
 *
 * 为什么不做 CSRF / 来源校验：局域网工具没有跨站攻击面，且伪造遥测对攻击者
 * 没有收益；真正要防的是「无意刷爆磁盘」，靠上面三层足够。
 */

const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { run, all } = require('../db');
const { normalizeEvent, summarize, forwardToSentry } = require('../telemetry');

const router = express.Router();

/** 单次上报的事件上限 */
const MAX_BATCH = 50;
/** 限流窗口 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_EVENTS_PER_WINDOW = 1200;

/** ip → { count, events, resetAt } */
const buckets = new Map();

/** @returns {{ok:true}|{ok:false, reason:string}} */
function checkRate(ip, eventCount) {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, events: eventCount, resetAt: now + WINDOW_MS });
    return { ok: true };
  }

  bucket.count += 1;
  bucket.events += eventCount;

  if (bucket.count > MAX_REQUESTS_PER_WINDOW || bucket.events > MAX_EVENTS_PER_WINDOW) {
    return { ok: false, reason: '上报过于频繁，请稍后再试' };
  }
  return { ok: true };
}

/** 每 5 分钟清一次过期桶，避免 Map 无限增长 */
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(ip);
  }
}, 5 * 60_000).unref();

router.post('/telemetry', express.text({ type: ['text/plain'], limit: '256kb' }), (req, res) => {
  // sendBeacon 只能发 text/plain（见前端 flush 的注释），这里统一成对象
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: '请求体不是合法的 JSON' });
    }
  }

  const events = body?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events 必须是非空数组' });
  }
  if (events.length > MAX_BATCH) {
    return res.status(400).json({ error: `单次最多上报 ${MAX_BATCH} 条事件` });
  }

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const rate = checkRate(ip, events.length);
  if (!rate.ok) return res.status(429).json({ error: rate.reason });

  const accepted = [];
  const rejected = [];
  for (const raw of events) {
    const result = normalizeEvent(raw);
    if (result.ok) accepted.push(result.event);
    else rejected.push(result.reason);
  }

  for (const event of accepted) {
    run(
      `INSERT INTO telemetry_events (ts, level, name, message, value, context, path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.ts,
      event.level,
      event.name,
      event.message,
      event.value ?? null,
      event.context,
      event.path,
    );
  }

  // Sentry 转发：只在配了 DSN 且是 error 时做，失败不影响接收结果
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    for (const event of accepted.filter((e) => e.level === 'error').slice(0, 5)) {
      void forwardToSentry(event, dsn).catch(() => {});
    }
  }

  return res.json({ accepted: accepted.length, rejected: rejected.length });
});

router.get('/telemetry/summary', requireAuth, requireAdmin, (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);
  const since = Date.now() - hours * 3600_000;

  const rows = all(
    `SELECT level, name, message, value FROM telemetry_events
     WHERE ts >= ? ORDER BY ts DESC LIMIT 20000`,
    since,
  );

  res.json({
    hours,
    since,
    ...summarize(rows),
    sentryEnabled: Boolean(process.env.SENTRY_DSN),
  });
});

router.delete('/telemetry', requireAuth, requireAdmin, (req, res) => {
  run('DELETE FROM telemetry_events');
  res.json({ ok: true });
});

module.exports = router;

'use strict';

/**
 * routes/ai-proxy.js —— 外部 OpenAI 兼容接口转发
 *
 * POST /api/ai/chat     转发聊天请求到外部 /chat/completions
 * GET  /api/ai/config   读取后端 AI 配置（不含 Key）
 * PUT  /api/ai/config   修改后端 AI 配置（仅管理员，可写入 Key）
 *
 * 安全约定：
 *   - API Key 使用 aes-256-gcm 加密后存入 settings 表
 *   - 加密密钥来自环境变量 API_ENC_KEY，缺省时自动生成并落到 server/data/.key
 *   - Key 绝不返回给前端，只返回 hasKey 布尔值
 */

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getSetting, setSetting, deleteSetting, DATA_DIR } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

/** settings 表中的键名 */
const KEY_BASE = 'ai_api_base';
const KEY_SECRET = 'ai_api_key';
const KEY_MODEL = 'ai_model';
const KEY_TIMEOUT = 'ai_timeout';
const KEY_TEMPERATURE = 'ai_temperature';

/** 加密后密文前缀，便于识别 */
const ENC_PREFIX = 'enc:v1:';

/** 加密密钥文件路径 */
const KEY_FILE = path.join(DATA_DIR, '.key');

/** 默认配置 */
const DEFAULTS = {
  base: '',
  model: 'gpt-4o-mini',
  timeout: 30000,
  temperature: 0.7,
};

let cachedEncKey = null;

/**
 * 获取加密密钥：优先环境变量 API_ENC_KEY，否则读写 server/data/.key
 * @returns {Buffer} 32 字节密钥
 */
function getEncryptionKey() {
  if (cachedEncKey) return cachedEncKey;

  const fromEnv = process.env.API_ENC_KEY;
  if (fromEnv) {
    // 任意长度口令统一用 sha256 派生为 32 字节
    cachedEncKey = crypto.createHash('sha256').update(String(fromEnv)).digest();
    return cachedEncKey;
  }

  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) {
      cachedEncKey = buf;
      return cachedEncKey;
    }
  }

  // 首次运行：自动生成并落盘
  const key = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('base64'), { mode: 0o600 });
  cachedEncKey = key;
  return cachedEncKey;
}

/**
 * 加密明文
 * @param {string} plain
 * @returns {string} enc:v1:iv:tag:cipher
 */
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/**
 * 解密密文
 * @param {string} stored
 * @returns {string|null} 解密失败返回 null
 */
function decryptSecret(stored) {
  if (!stored || !String(stored).startsWith(ENC_PREFIX)) return null;
  const parts = String(stored).slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 读取当前生效配置
 * @returns {{base:string, key:string|null, model:string, timeout:number, temperature:number, hasKey:boolean}}
 */
function readConfig() {
  const base = (getSetting(KEY_BASE) || DEFAULTS.base).trim();
  const model = (getSetting(KEY_MODEL) || DEFAULTS.model).trim();
  const timeout = Math.max(1000, Number(getSetting(KEY_TIMEOUT) || DEFAULTS.timeout) || DEFAULTS.timeout);
  const temperature = Number(getSetting(KEY_TEMPERATURE) ?? DEFAULTS.temperature);
  const rawSecret = getSetting(KEY_SECRET) || '';
  const key = rawSecret ? decryptSecret(rawSecret) : null;

  return {
    base,
    key,
    model,
    timeout,
    temperature: Number.isFinite(temperature) ? temperature : DEFAULTS.temperature,
    hasKey: !!key,
  };
}

/**
 * 把 base 地址规整成 .../chat/completions 完整地址
 * @param {string} base
 * @returns {string}
 */
function buildEndpoint(base) {
  let url = String(base || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (/\/chat\/completions$/i.test(url)) return url;
  return `${url}/chat/completions`;
}

/**
 * GET /api/ai/config —— 读取配置（不含 Key） —— 需要登录
 */
router.get('/config', requireAuth, (req, res) => {
  const cfg = readConfig();
  return res.json({
    base: cfg.base,
    model: cfg.model,
    timeout: cfg.timeout,
    temperature: cfg.temperature,
    hasKey: cfg.hasKey, // 只暴露是否已配置，绝不返回 Key
  });
});

/**
 * PUT /api/ai/config —— 修改配置 —— 需要管理员
 * body: { base?, model?, timeout?, temperature?, apiKey? }
 */
router.put('/config', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};

  if (body.base !== undefined) {
    const base = String(body.base).trim();
    if (base && !/^https?:\/\//i.test(base) && !/^[\w.-]+\.[a-z]{2,}/i.test(base)) {
      return res.status(400).json({ error: 'API 地址格式不正确，需以 http:// 或 https:// 开头' });
    }
    setSetting(KEY_BASE, base);
  }
  if (body.model !== undefined) {
    const model = String(body.model).trim();
    if (!model) return res.status(400).json({ error: '模型名称不能为空' });
    setSetting(KEY_MODEL, model);
  }
  if (body.timeout !== undefined) {
    const timeout = Number(body.timeout);
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) {
      return res.status(400).json({ error: '超时时间需在 1000 ~ 600000 毫秒之间' });
    }
    setSetting(KEY_TIMEOUT, String(Math.floor(timeout)));
  }
  if (body.temperature !== undefined) {
    const temperature = Number(body.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      return res.status(400).json({ error: '温度需在 0 ~ 2 之间' });
    }
    setSetting(KEY_TEMPERATURE, String(temperature));
  }
  if (body.apiKey !== undefined) {
    const apiKey = String(body.apiKey).trim();
    if (!apiKey) {
      deleteSetting(KEY_SECRET); // 传空字符串表示清除 Key
    } else {
      setSetting(KEY_SECRET, encryptSecret(apiKey));
    }
  }

  const cfg = readConfig();
  return res.json({
    base: cfg.base,
    model: cfg.model,
    timeout: cfg.timeout,
    temperature: cfg.temperature,
    hasKey: cfg.hasKey,
  });
});

/**
 * POST /api/ai/chat —— 转发到外部 OpenAI 兼容接口 —— 需要登录
 * body: { messages:[{role,content}], model?, temperature?, stream? }
 */
router.post('/chat', requireAuth, async (req, res) => {
  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (!messages.length) {
    return res.status(400).json({ error: '请提供 messages 数组' });
  }
  const invalid = messages.find(
    (m) => !m || typeof m !== 'object' || !('role' in m) || typeof m.content !== 'string'
  );
  if (invalid) {
    return res.status(400).json({ error: 'messages 格式错误，每项需包含 role 与字符串 content' });
  }

  const cfg = readConfig();
  if (!cfg.base) {
    return res.status(400).json({ error: '后端尚未配置 AI 接口地址，请先在设置中填写 API 地址' });
  }
  if (!cfg.hasKey) {
    return res.status(400).json({ error: '后端尚未配置 AI 接口密钥，请先在设置中填写 API Key' });
  }

  const endpoint = buildEndpoint(cfg.base);
  const model = String(body.model || cfg.model).trim();
  const temperature = body.temperature !== undefined ? Number(body.temperature) : cfg.temperature;
  const timeout = cfg.timeout;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number.isFinite(temperature) ? temperature : DEFAULTS.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }

    if (!upstream.ok) {
      const upstreamMsg = payload?.error?.message || text.slice(0, 200) || upstream.statusText;
      return res.status(502).json({ error: `外部 AI 接口返回错误：${upstreamMsg}` });
    }

    const content = payload?.choices?.[0]?.message?.content ?? '';
    return res.json({
      content,
      model: payload?.model || model,
      usage: payload?.usage || null,
      finishReason: payload?.choices?.[0]?.finish_reason || null,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: `外部 AI 接口请求超时（${timeout}ms）` });
    }
    return res.status(502).json({ error: `无法连接外部 AI 接口：${err?.message || '网络错误'}` });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
// 导出内部方法，便于测试
module.exports.encryptSecret = encryptSecret;
module.exports.decryptSecret = decryptSecret;
module.exports.buildEndpoint = buildEndpoint;

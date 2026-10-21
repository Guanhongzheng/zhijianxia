'use strict';

/**
 * routes/ai-proxy.js —— 外部 AI 接口转发（多服务商 · 多能力）
 *
 * POST /api/ai/chat     转发聊天请求（支持 chat / vision 等文本类能力）
 * POST /api/ai/image    图像生成
 * POST /api/ai/speech   语音转文字 / 文字转语音
 * GET  /api/ai/config   读取后端 AI 配置（不含 Key）
 * PUT  /api/ai/config   修改后端 AI 配置（仅管理员，可写入 Key）
 *
 * 能力（capability）与协议（protocol）：
 *   能力决定「用哪个分类的配置」，协议决定「请求怎么发、响应怎么解析」。
 *   服务商清单来自 shared/api-providers.json（前后端唯一数据源），读不到时
 *   由 providers.js 兜底，保证后端不会崩溃。
 *
 * 安全约定：
 *   - API Key 使用 aes-256-gcm 加密后存入 settings 表，每个能力一把独立 Key
 *   - 加密密钥来自环境变量 API_ENC_KEY，缺省时自动生成并落到 server/data/.key
 *   - Key 绝不返回给前端，只返回 hasKey 布尔值
 */

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getSetting, setSetting, deleteSetting, DATA_DIR } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const {
  catalog,
  CAPABILITY_IDS,
  DEFAULT_CAPABILITY,
  getProvider,
  providerSupports,
  defaultModelFor,
  isValidCapability,
  capabilityName,
} = require('../providers');

const router = express.Router();

/** settings 表中的键名（chat 沿用历史键名，其余能力按 ai_cap_xxx / ai_key_xxx 存） */
const KEY_BASE = 'ai_api_base';
const KEY_SECRET = 'ai_api_key';
const KEY_MODEL = 'ai_model';
const KEY_TIMEOUT = 'ai_timeout';
const KEY_TEMPERATURE = 'ai_temperature';

/** 非 chat 能力的配置键前缀，例如 ai_cap_vision / ai_key_vision */
const CAP_CONFIG_PREFIX = 'ai_cap_';
const CAP_SECRET_PREFIX = 'ai_key_';

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

/** Claude 的 max_tokens 为必填项 */
const ANTHROPIC_MAX_TOKENS = 2048;

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
 * 把 base 规整成「协议头 + 无尾部斜杠 + 不含具体接口路径」的形式
 * @param {string} base
 * @returns {string}
 */
function normalizeBase(base) {
  let url = String(base || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/**
 * 读取当前生效的 chat 主配置（向后兼容的老逻辑）
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
 * 读取某项能力在 ai_cap_xxx 中保存的结构化配置
 * @param {string} capability
 * @returns {{provider:string, protocol:string, base:string, model:string}|null}
 */
function readCapRecord(capability) {
  const raw = getSetting(CAP_CONFIG_PREFIX + capability);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      provider: String(parsed.provider || ''),
      protocol: String(parsed.protocol || ''),
      base: String(parsed.base || ''),
      model: String(parsed.model || ''),
    };
  } catch {
    return null;
  }
}

/**
 * 写入某项能力的结构化配置
 * @param {string} capability
 * @param {{provider?:string, protocol?:string, base?:string, model?:string}} patch
 */
function writeCapRecord(capability, patch) {
  const merged = { ...(readCapRecord(capability) || { provider: '', protocol: '', base: '', model: '' }) };
  for (const field of ['provider', 'protocol', 'base', 'model']) {
    if (patch[field] !== undefined) merged[field] = String(patch[field]);
  }
  setSetting(CAP_CONFIG_PREFIX + capability, JSON.stringify(merged));
}

/**
 * 读取某项能力的完整运行配置（含解密后的 Key，仅服务端内部使用）
 *
 * chat 沿用历史键（ai_api_base / ai_model / ai_api_key），
 * provider 与 protocol 额外存在 ai_cap_chat 里；其余能力全部走 ai_cap_xxx。
 *
 * @param {string} capability
 * @returns {{capability:string, provider:string, protocol:string, base:string, model:string, key:string|null, hasKey:boolean, configured:boolean}}
 */
function readCapabilityConfig(capability) {
  const cap = isValidCapability(capability) ? capability : DEFAULT_CAPABILITY;

  if (cap === DEFAULT_CAPABILITY) {
    const legacy = readConfig();
    const record = readCapRecord(cap) || {};
    const provider = record.provider || 'openai';
    return {
      capability: cap,
      provider,
      protocol: record.protocol || getProvider(provider)?.protocol || 'openai',
      base: legacy.base,
      model: legacy.model,
      key: legacy.key,
      hasKey: legacy.hasKey,
      // 未填地址即视为未配置，保持历史行为
      configured: !!legacy.base,
    };
  }

  const record = readCapRecord(cap) || { provider: '', protocol: '', base: '', model: '' };
  const provider = record.provider;
  const meta = getProvider(provider);
  const rawSecret = getSetting(CAP_SECRET_PREFIX + cap) || '';
  const key = rawSecret ? decryptSecret(rawSecret) : null;
  // base 留空时回落到清单里的官方地址，省去用户手工填写
  const base = record.base || meta?.baseUrl || '';

  return {
    capability: cap,
    provider,
    protocol: record.protocol || meta?.protocol || 'openai',
    base,
    model: record.model || defaultModelFor(provider, cap),
    key,
    hasKey: !!key,
    configured: !!provider && !!base,
  };
}

/**
 * 生成对外可见的能力配置（只暴露 hasKey，绝不暴露 Key 本身）
 * @param {string} capability
 * @returns {{provider:string, protocol:string, base:string, model:string, hasKey:boolean}}
 */
function publicCapabilityConfig(capability) {
  const cfg = readCapabilityConfig(capability);
  return {
    provider: cfg.provider,
    protocol: cfg.protocol,
    base: cfg.base,
    model: cfg.model,
    hasKey: cfg.hasKey,
  };
}

/**
 * 组装全部能力的配置映射
 * @returns {Record<string, object>}
 */
function allCapabilityConfigs() {
  const result = {};
  for (const id of CAPABILITY_IDS) result[id] = publicCapabilityConfig(id);
  return result;
}

/**
 * 按协议构造完整请求地址
 *
 * 向后兼容：单参数调用 buildEndpoint(base) 仍返回 base + /chat/completions，
 * 这是前端契约测试脚本 scripts/contract-test.mjs 依赖的语义。
 *
 * @param {string} base 接口根地址
 * @param {string} [protocol] openai / anthropic / gemini / stability，缺省 openai
 * @param {string} [model] gemini 与 stability 需要把模型写进路径
 * @param {string} [kind] openai 协议下的具体动作：chat / image / transcribe / synthesize
 * @returns {string}
 */
function buildEndpoint(base, protocol, model, kind) {
  const url = normalizeBase(base);
  if (!url) return '';

  const proto = String(protocol || 'openai').toLowerCase();
  const action = String(kind || 'chat').toLowerCase();

  // Claude：固定 /messages，模型放在请求体里
  if (proto === 'anthropic') return `${url}/messages`;

  // Gemini：模型写进路径，形如 .../models/gemini-1.5-pro:generateContent
  if (proto === 'gemini') {
    const name = String(model || '').trim();
    return name ? `${url}/models/${name}:generateContent` : url;
  }

  // Stability：形如 .../stable-image/stable-image-core/text-to-image
  if (proto === 'stability') {
    const name = String(model || '').trim();
    return name ? `${url}/${name}/text-to-image` : url;
  }

  // OpenAI 兼容（openai / 智谱 GLM / DeepSeek / 通义千问 VL 共用）
  if (action === 'image') return `${url}/images/generations`;
  if (action === 'transcribe') return `${url}/audio/transcriptions`;
  if (action === 'synthesize') return `${url}/audio/speech`;
  if (/\/chat\/completions$/i.test(url)) return url; // 已含完整路径则不重复拼接
  return `${url}/chat/completions`;
}

/**
 * 按协议拼装鉴权头
 * @param {string} protocol
 * @param {string} key
 * @returns {Record<string,string>}
 */
function buildAuthHeaders(protocol, key) {
  switch (String(protocol || 'openai').toLowerCase()) {
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      };
    case 'gemini':
      return {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      };
    case 'stability':
      // multipart 的 Content-Type 必须留给 fetch 自行生成带 boundary 的头
      return { Authorization: `Bearer ${key}`, Accept: 'image/*' };
    default:
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      };
  }
}

/**
 * 按协议把 OpenAI 风格的 messages 转成上游请求体
 * @param {string} protocol
 * @param {{model:string, messages:{role:string,content:string}[], temperature:number}} input
 * @returns {{body:object, protocol:string}} protocol 为空串表示该协议不支持文本对话
 */
function buildChatPayload(protocol, { model, messages, temperature }) {
  switch (String(protocol || 'openai').toLowerCase()) {
    case 'anthropic': {
      // system 消息要单独提到顶层，且 max_tokens 必填
      const systemChunks = [];
      const rest = [];
      for (const m of messages) {
        if (m.role === 'system') systemChunks.push(m.content);
        else rest.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
      }
      const body = {
        model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: rest,
      };
      if (systemChunks.length) body.system = systemChunks.join('\n\n');
      return { body, protocol: 'anthropic' };
    }

    case 'gemini': {
      // assistant 映射为 model；system 提到顶层 systemInstruction
      const systemChunks = [];
      const contents = [];
      for (const m of messages) {
        if (m.role === 'system') {
          systemChunks.push(m.content);
          continue;
        }
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
      const body = { contents };
      body.generationConfig = {
        temperature: Number.isFinite(temperature) ? temperature : DEFAULTS.temperature,
      };
      if (systemChunks.length) {
        body.systemInstruction = { parts: [{ text: systemChunks.join('\n\n') }] };
      }
      return { body, protocol: 'gemini' };
    }

    case 'stability':
      // Stability 只做图像生成，不支持文本对话
      return { body: null, protocol: '' };

    default:
      return {
        body: {
          model,
          messages,
          temperature: Number.isFinite(temperature) ? temperature : DEFAULTS.temperature,
          stream: false,
        },
        protocol: 'openai',
      };
  }
}

/**
 * 按协议解析文本响应
 * @param {string} protocol
 * @param {object} payload 上游 JSON
 * @param {string} fallbackModel 请求时使用的模型名
 * @returns {{content:string, model:string, usage:object|null, finishReason:string|null}}
 */
function parseChatResponse(protocol, payload, fallbackModel) {
  switch (String(protocol || 'openai').toLowerCase()) {
    case 'anthropic': {
      const blocks = Array.isArray(payload?.content) ? payload.content : [];
      const first = blocks.find((b) => b && b.type === 'text');
      return {
        content: first?.text ?? '',
        model: payload?.model || fallbackModel,
        usage: payload?.usage || null,
        finishReason: payload?.stop_reason || null,
      };
    }

    case 'gemini': {
      const parts = payload?.candidates?.[0]?.content?.parts;
      return {
        content: Array.isArray(parts) ? (parts[0]?.text ?? '') : '',
        model: payload?.modelVersion || fallbackModel,
        usage: payload?.usageMetadata || null,
        finishReason: payload?.candidates?.[0]?.finishReason || null,
      };
    }

    default:
      return {
        content: payload?.choices?.[0]?.message?.content ?? '',
        model: payload?.model || fallbackModel,
        usage: payload?.usage || null,
        finishReason: payload?.choices?.[0]?.finish_reason || null,
      };
  }
}

/**
 * 发起带超时的上游请求
 * @param {string} endpoint
 * @param {object} init fetch 配置
 * @param {number} timeout 毫秒
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(endpoint, init, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从上游错误响应里提取人类可读信息
 * @param {Response} upstream
 * @param {string} text 已读出的响应体文本
 * @returns {string}
 */
function upstreamErrorMessage(upstream, text) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return (
    parsed?.error?.message ||
    parsed?.message ||
    (text || '').slice(0, 200) ||
    upstream.statusText ||
    '未知错误'
  );
}

/**
 * 校验并解析请求里的 capability 字段
 * @param {*} raw
 * @returns {{ok:true, value:string}|{ok:false, message:string}}
 */
function parseCapabilityField(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: DEFAULT_CAPABILITY };
  }
  const value = String(raw).trim();
  if (!isValidCapability(value)) {
    return { ok: false, message: `不支持的能力分类：${value}（可选：${CAPABILITY_IDS.join('、')}）` };
  }
  return { ok: true, value };
}

/**
 * 检查某能力的配置是否可以直接发起请求
 * @param {object} cfg readCapabilityConfig 的结果
 * @returns {string|null} 有问题时返回中文提示，否则 null
 */
function checkCapabilityReady(cfg) {
  if (!cfg.configured || !cfg.base) {
    if (cfg.capability === DEFAULT_CAPABILITY) {
      return '后端尚未配置 AI 接口地址，请先在设置中填写 API 地址';
    }
    return `后端尚未配置「${capabilityName(cfg.capability)}」能力的服务商与接口地址，请先在设置中完成配置`;
  }
  if (!cfg.hasKey) {
    if (cfg.capability === DEFAULT_CAPABILITY) {
      return '后端尚未配置 AI 接口密钥，请先在设置中填写 API Key';
    }
    return `后端尚未配置「${capabilityName(cfg.capability)}」能力的 API Key，请先在设置中填写`;
  }
  if (!cfg.model) {
    return `请先为「${capabilityName(cfg.capability)}」能力选择模型`;
  }
  return null;
}

/**
 * 校验 base 地址
 * @param {string} base
 * @returns {string|null} 非法时返回中文提示
 */
function validateBase(base) {
  if (!base) return null; // 空串表示清空 / 回落默认值
  if (!/^https?:\/\//i.test(base) && !/^[\w.-]+\.[a-z]{2,}/i.test(base)) {
    return 'API 地址格式不正确，需以 http:// 或 https:// 开头';
  }
  return null;
}

/**
 * GET /api/ai/config —— 读取配置（不含 Key） —— 需要登录
 *
 * 返回结构 = 历史字段（base/model/timeout/temperature/hasKey）
 *          + capabilities（按能力分类的运行配置）
 *          + catalog（共享服务商清单，前端直接渲染选择器）
 */
router.get('/config', requireAuth, (req, res) => {
  const cfg = readConfig();
  return res.json({
    // —— 历史字段，原样保留，前端现有代码依赖 ——
    base: cfg.base,
    model: cfg.model,
    timeout: cfg.timeout,
    temperature: cfg.temperature,
    hasKey: cfg.hasKey, // 只暴露是否已配置，绝不返回 Key
    // —— 新增：分能力配置 ——
    capabilities: allCapabilityConfigs(),
    // —— 新增：共享服务商清单 ——
    catalog,
  });
});

/**
 * PUT /api/ai/config —— 修改配置 —— 需要管理员
 *
 * body（不带 capability，更新 chat 主配置，保持历史行为）：
 *   { base?, model?, timeout?, temperature?, apiKey? }
 * body（带 capability，只更新该能力分类，互不影响）：
 *   { capability, provider?, protocol?, base?, model?, apiKey? }
 */
router.put('/config', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const cap = parseCapabilityField(body.capability);
  if (!cap.ok) {
    return res.status(400).json({ error: cap.message });
  }
  const capability = cap.value;

  // ===== 分支一：带 capability 且非 chat —— 只写该能力的配置，互不影响 =====
  // 说明：capability 传 'chat' 时走下面的分支二，因为 chat 的 base/model/apiKey
  // 使用的是历史键名，这里必须保持与前端现有逻辑一致。
  if (capability !== DEFAULT_CAPABILITY) {
    const providerId = String(body.provider || '').trim();
    if (providerId) {
      const provider = getProvider(providerId);
      if (!provider) {
        return res.status(400).json({ error: `未知的服务商：${providerId}，请从清单中选择` });
      }
      if (!providerSupports(providerId, capability)) {
        return res.status(400).json({
          error: `服务商「${provider.name}」不支持「${capabilityName(capability)}」能力，请另选服务商`,
        });
      }
    }

    if (body.base !== undefined) {
      const base = String(body.base).trim();
      const err = validateBase(base);
      if (err) return res.status(400).json({ error: err });
      writeCapRecord(capability, { base });
    }
    if (body.model !== undefined) {
      const model = String(body.model).trim();
      if (!model) return res.status(400).json({ error: '模型名称不能为空' });
      writeCapRecord(capability, { model });
    }
    if (body.provider !== undefined) {
      // 换服务商时同步协议与默认地址，避免出现「新服务商 + 旧地址」的错配
      const provider = getProvider(String(body.provider).trim());
      if (!provider) {
        return res.status(400).json({ error: `未知的服务商：${body.provider}，请从清单中选择` });
      }
      const patch = { provider: provider.id, protocol: provider.protocol };
      if (body.protocol !== undefined) {
        patch.protocol = String(body.protocol).trim() || provider.protocol;
      }
      // 原先没填过地址时，落到新服务商的官方地址
      if (!readCapRecord(capability)?.base) patch.base = provider.baseUrl;
      writeCapRecord(capability, patch);
    } else if (body.protocol !== undefined) {
      const protocol = String(body.protocol).trim();
      if (!protocol) return res.status(400).json({ error: '协议不能为空' });
      writeCapRecord(capability, { protocol });
    }
    if (body.apiKey !== undefined) {
      const apiKey = String(body.apiKey).trim();
      const secretKey = CAP_SECRET_PREFIX + capability;
      if (!apiKey) deleteSetting(secretKey); // 传空字符串表示清除 Key
      else setSetting(secretKey, encryptSecret(apiKey));
    }

    const cfg = readConfig();
    return res.json({
      base: cfg.base,
      model: cfg.model,
      timeout: cfg.timeout,
      temperature: cfg.temperature,
      hasKey: cfg.hasKey,
      capabilities: allCapabilityConfigs(),
      catalog,
    });
  }

  // ===== 分支二：不带 capability —— 更新 chat 主配置（历史行为） =====
  if (body.base !== undefined) {
    const base = String(body.base).trim();
    const err = validateBase(base);
    if (err) return res.status(400).json({ error: err });
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
  // chat 也记录一份 provider / protocol，便于前端展示与后续切换服务商
  if (body.provider !== undefined || body.protocol !== undefined) {
    const providerId = String(body.provider || '').trim();
    if (providerId) {
      const provider = getProvider(providerId);
      if (!provider) {
        return res.status(400).json({ error: `未知的服务商：${providerId}，请从清单中选择` });
      }
      if (!providerSupports(providerId, DEFAULT_CAPABILITY)) {
        return res.status(400).json({
          error: `服务商「${provider.name}」不支持「${capabilityName(DEFAULT_CAPABILITY)}」能力，请另选服务商`,
        });
      }
      writeCapRecord(DEFAULT_CAPABILITY, { provider: provider.id, protocol: provider.protocol });
    }
    if (body.protocol !== undefined) {
      writeCapRecord(DEFAULT_CAPABILITY, { protocol: String(body.protocol).trim() });
    }
  }

  const cfg = readConfig();
  return res.json({
    base: cfg.base,
    model: cfg.model,
    timeout: cfg.timeout,
    temperature: cfg.temperature,
    hasKey: cfg.hasKey,
    capabilities: allCapabilityConfigs(),
    catalog,
  });
});

/**
 * POST /api/ai/chat —— 转发文本请求 —— 需要登录
 * body: { messages:[{role,content}], capability?, model?, temperature?, stream? }
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

  const cap = parseCapabilityField(body.capability);
  if (!cap.ok) return res.status(400).json({ error: cap.message });

  const cfg = readCapabilityConfig(cap.value);
  const notReady = checkCapabilityReady(cfg);
  if (notReady) return res.status(400).json({ error: notReady });

  // 模型名要独立保存：gemini / anthropic 的请求体里不一定带 model 字段
  // （gemini 把模型写进 URL 路径），不能从 body.model 反推
  const model = String(body.model || cfg.model).trim();
  const built = buildChatPayload(cfg.protocol, {
    model,
    messages,
    temperature: body.temperature !== undefined ? Number(body.temperature) : readConfig().temperature,
  });
  if (!built.body) {
    return res.status(400).json({
      error: `当前服务商不支持文本对话能力，请在设置中更换「${capabilityName(cfg.capability)}」的服务商`,
    });
  }

  const endpoint = buildEndpoint(cfg.base, built.protocol, model, 'chat');
  const timeout = readConfig().timeout;

  try {
    const upstream = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: buildAuthHeaders(built.protocol, cfg.key),
        body: JSON.stringify(built.body),
      },
      timeout
    );

    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }

    if (!upstream.ok) {
      return res.status(502).json({ error: `外部 AI 接口返回错误：${upstreamErrorMessage(upstream, text)}` });
    }

    const parsed = parseChatResponse(built.protocol, payload, model);
    return res.json({
      // —— 历史字段：content / model / usage / finishReason 形状保持不变 ——
      content: parsed.content,
      model: parsed.model,
      usage: parsed.usage,
      finishReason: parsed.finishReason,
      // —— 新增：回显本次实际使用的能力与服务商，便于前端排查 ——
      capability: cfg.capability,
      provider: cfg.provider,
      protocol: built.protocol,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: `外部 AI 接口请求超时（${timeout}ms）` });
    }
    return res.status(502).json({ error: `无法连接外部 AI 接口：${err?.message || '网络错误'}` });
  }
});

/**
 * POST /api/ai/image —— 图像生成 —— 需要登录
 * body: { prompt, capability?, model?, size? }
 * 返回: { image: 'data:image/png;base64,...', model, provider }
 */
router.post('/image', requireAuth, async (req, res) => {
  const body = req.body || {};
  const prompt = String(body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ error: '请提供图像描述 prompt' });
  }

  const cap = parseCapabilityField(body.capability || 'image');
  if (!cap.ok) return res.status(400).json({ error: cap.message });
  if (cap.value !== 'image') {
    return res.status(400).json({ error: '图像生成接口的 capability 必须是 image' });
  }

  const cfg = readCapabilityConfig('image');
  const notReady = checkCapabilityReady(cfg);
  if (notReady) return res.status(400).json({ error: notReady });

  const model = String(body.model || cfg.model).trim();
  if (!model) return res.status(400).json({ error: '请先为「图像生成」能力选择模型' });

  const size = String(body.size || '').trim();
  if (size && !/^\d{2,4}x\d{2,4}$/i.test(size)) {
    return res.status(400).json({ error: '图片尺寸格式不正确，应形如 1024x1024' });
  }

  const timeout = readConfig().timeout;
  const providerName = getProvider(cfg.provider)?.name || cfg.provider;

  try {
    // ===== Stability：multipart 上传，响应是二进制 PNG =====
    if (cfg.protocol === 'stability') {
      const endpoint = buildEndpoint(cfg.base, 'stability', model, 'image');
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('model', model);
      form.append('output_format', 'png');

      const upstream = await fetchWithTimeout(
        endpoint,
        { method: 'POST', headers: buildAuthHeaders('stability', cfg.key), body: form },
        timeout
      );

      if (!upstream.ok) {
        const text = await upstream.text();
        return res.status(502).json({ error: `图像生成接口返回错误：${upstreamErrorMessage(upstream, text)}` });
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (!buffer.length) {
        return res.status(502).json({ error: '图像生成接口返回了空数据，请稍后重试' });
      }
      return res.json({
        image: `data:image/png;base64,${buffer.toString('base64')}`,
        model,
        provider: cfg.provider,
        providerName,
      });
    }

    // ===== OpenAI 兼容：/images/generations，响应是 JSON =====
    const endpoint = buildEndpoint(cfg.base, 'openai', model, 'image');
    const payload = { model, prompt, n: 1 };
    if (size) payload.size = size;

    const upstream = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: buildAuthHeaders('openai', cfg.key),
        body: JSON.stringify(payload),
      },
      timeout
    );

    const text = await upstream.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!upstream.ok) {
      return res.status(502).json({ error: `图像生成接口返回错误：${upstreamErrorMessage(upstream, text)}` });
    }

    const b64 = parsed?.data?.[0]?.b64_json;
    if (b64) {
      return res.json({
        image: `data:image/png;base64,${b64}`,
        model: model,
        provider: cfg.provider,
        providerName,
      });
    }

    const url = parsed?.data?.[0]?.url;
    if (url) {
      // 有些服务商只返回图片链接，这里下载后转成 dataURL 保持返回结构一致
      try {
        const imgRes = await fetchWithTimeout(url, { method: 'GET' }, timeout);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const mime = imgRes.headers.get('content-type') || 'image/png';
          return res.json({
            image: `data:${mime};base64,${buf.toString('base64')}`,
            model,
            provider: cfg.provider,
            providerName,
          });
        }
      } catch {
        // 下载失败时退回原始链接
      }
      return res.json({ image: url, model, provider: cfg.provider, providerName });
    }

    return res.status(502).json({ error: '图像生成接口未返回图片数据，请检查所选模型是否支持图像生成' });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: `图像生成接口请求超时（${timeout}ms）` });
    }
    return res.status(502).json({ error: `无法连接图像生成接口：${err?.message || '网络错误'}` });
  }
});

/**
 * POST /api/ai/speech —— 语音转文字 / 文字转语音 —— 需要登录
 * body: { action:'transcribe'|'synthesize', capability?, model?, audio?, text?, voice?, format? }
 * 返回: transcribe -> { text, model }；synthesize -> { audio:'data:audio/mpeg;base64,...', model }
 */
router.post('/speech', requireAuth, async (req, res) => {
  const body = req.body || {};
  const action = String(body.action || '').trim().toLowerCase();
  if (action !== 'transcribe' && action !== 'synthesize') {
    return res.status(400).json({ error: 'action 只能是 transcribe（转文字）或 synthesize（转语音）' });
  }

  const cap = parseCapabilityField(body.capability || 'speech');
  if (!cap.ok) return res.status(400).json({ error: cap.message });
  if (cap.value !== 'speech') {
    return res.status(400).json({ error: '语音接口的 capability 必须是 speech' });
  }

  const cfg = readCapabilityConfig('speech');
  const notReady = checkCapabilityReady(cfg);
  if (notReady) return res.status(400).json({ error: notReady });

  if (cfg.protocol !== 'openai') {
    return res.status(400).json({
      error: '当前服务商的语音能力暂不支持，请选择 OpenAI 兼容的服务商（如 OpenAI API）',
    });
  }

  const timeout = readConfig().timeout;

  try {
    // ===== 语音转文字：multipart 上传音频 =====
    if (action === 'transcribe') {
      const audioRaw = String(body.audio || '').trim();
      if (!audioRaw) {
        return res.status(400).json({ error: '语音转文字需要提供 audio 字段（base64 编码的音频）' });
      }
      const model = String(body.model || cfg.model).trim();

      // 兼容 dataURL 与纯 base64 两种写法
      const match = /^data:([^;,]+)?;base64,(.*)$/is.exec(audioRaw);
      const mime = match?.[1] || 'audio/mpeg';
      const base64Part = match?.[2] ?? audioRaw;
      let buffer;
      try {
        buffer = Buffer.from(base64Part, 'base64');
      } catch {
        return res.status(400).json({ error: 'audio 字段不是合法的 base64 编码' });
      }
      if (!buffer.length) {
        return res.status(400).json({ error: 'audio 字段解码后为空，请检查音频内容' });
      }

      const ext = mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'mp3';
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mime }), `audio.${ext}`);
      form.append('model', model);
      if (body.format) form.append('response_format', String(body.format).trim());
      if (body.language) form.append('language', String(body.language).trim());

      const upstream = await fetchWithTimeout(
        buildEndpoint(cfg.base, 'openai', model, 'transcribe'),
        { method: 'POST', headers: buildAuthHeaders('openai', cfg.key), body: form },
        timeout
      );

      const text = await upstream.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (!upstream.ok) {
        return res.status(502).json({ error: `语音转文字接口返回错误：${upstreamErrorMessage(upstream, text)}` });
      }
      return res.json({
        text: parsed?.text ?? text,
        model: parsed?.model || model,
        capability: 'speech',
        provider: cfg.provider,
      });
    }

    // ===== 文字转语音：响应是二进制音频 =====
    const input = String(body.text || '').trim();
    if (!input) {
      return res.status(400).json({ error: '文字转语音需要提供 text 字段' });
    }
    if (input.length > 4000) {
      return res.status(400).json({ error: '单次文字转语音的文本请控制在 4000 字以内' });
    }
    const model = String(body.model || cfg.model).trim();
    const voice = String(body.voice || '').trim() || 'alloy';

    const upstream = await fetchWithTimeout(
      buildEndpoint(cfg.base, 'openai', model, 'synthesize'),
      {
        method: 'POST',
        headers: buildAuthHeaders('openai', cfg.key),
        body: JSON.stringify({ model, input, voice }),
      },
      timeout
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({ error: `文字转语音接口返回错误：${upstreamErrorMessage(upstream, text)}` });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) {
      return res.status(502).json({ error: '文字转语音接口返回了空数据，请稍后重试' });
    }
    const mime = upstream.headers.get('content-type') || 'audio/mpeg';
    return res.json({
      audio: `data:${mime};base64,${buffer.toString('base64')}`,
      model,
      capability: 'speech',
      provider: cfg.provider,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: `语音接口请求超时（${timeout}ms）` });
    }
    return res.status(502).json({ error: `无法连接语音接口：${err?.message || '网络错误'}` });
  }
});

module.exports = router;
// 导出内部方法，便于测试
module.exports.catalog = catalog;
module.exports.CAPABILITY_IDS = CAPABILITY_IDS;
module.exports.normalizeBase = normalizeBase;
module.exports.encryptSecret = encryptSecret;
module.exports.decryptSecret = decryptSecret;
module.exports.readConfig = readConfig;
module.exports.readCapabilityConfig = readCapabilityConfig;
module.exports.buildEndpoint = buildEndpoint;
module.exports.buildAuthHeaders = buildAuthHeaders;
module.exports.buildChatPayload = buildChatPayload;
module.exports.parseChatResponse = parseChatResponse;
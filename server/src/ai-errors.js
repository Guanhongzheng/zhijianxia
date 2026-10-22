'use strict';

/**
 * ai-errors.js —— 上游 AI 错误的可读化
 *
 * ## 为什么需要这个模块
 *
 * 上游 SDK（Vercel AI SDK）出于「不泄漏服务端细节」的考虑，会把所有错误
 * 统一替换成一句话 `An error occurred.`。这个设计对生产环境是对的，
 * 但本项目是**本地优先的桌面式应用** —— 后端就跑在用户自己机器上，
 * 用户遇到的绝大多数问题是「配置错了」或「网络不通」，
 * 而这两种情况恰恰只能靠真实错误信息定位。
 *
 * 一句话 `An error occurred.` 会让用户完全无从下手：
 * 是密钥错了？地址错了？模型名不存在？还是国内访问不了 OpenAI？
 *
 * 因此这里把 AI SDK 的各类错误翻译成**可执行的中文提示**。
 *
 * ## 安全边界
 *
 * 只回传「错误类型 + 状态码 + 上游 message」这类诊断信息，
 * **不回传 API Key**（AI SDK 的 APICallError 里 `requestBodyValues`
 * 可能含密钥，必须剥离）。
 */

/** 上游 SDK 的错误基类名 → 中文分类 */
const ERROR_KIND_LABELS = {
  AI_RetryError: '重试后仍失败',
  AI_APICallError: '接口调用失败',
  AI_NoSuchToolError: '工具不存在',
  AI_InvalidToolInputError: '工具入参非法',
  AI_InvalidPromptError: '提示词格式非法',
  AI_NoOutputGeneratedError: '模型未产出内容',
  AI_JSONValidationError: '模型输出不是合法 JSON',
  AI_TypeValidationError: '类型校验失败',
  AI_LoadAPIKeyError: 'API Key 缺失',
};

/** HTTP 状态码 → 用户能理解的原因 */
const STATUS_HINTS = {
  400: '请求参数被上游拒绝（多为模型名写错或参数不兼容）',
  401: 'API Key 无效或已过期，请到「系统设置 → AI 服务」重新填写',
  403: '没有访问该模型的权限（Key 有效但未授权该模型）',
  404: '接口地址或模型名不存在，请检查「接口地址」与「模型名」',
  413: '请求内容过大，请缩短上下文',
  422: '参数校验失败，通常是模型不支持当前的工具调用方式',
  429: '触发限流或余额不足，请稍后重试或更换服务商',
  500: '上游服务内部错误，请稍后重试或更换服务商',
  502: '上游网关错误，服务商侧可能暂时不可用',
  503: '上游服务暂时不可用（过载或维护中），请稍后重试',
  504: '上游响应超时，请稍后重试或调大超时时间',
};

/**
 * 从任意错误对象里挖出最有信息量的那段文字。
 *
 * AI SDK 的错误有层层包装（RetryError → APICallError → 原始 Error），
 * 且部分层只把信息放在 `cause` 里，因此要递归下钻。
 *
 * @param {unknown} err
 * @param {number} depth 递归深度上限
 * @returns {string|null}
 */
function deepestMessage(err, depth = 0) {
  if (!err || depth > 4) return null;

  if (typeof err === 'string') return err.trim() || null;

  if (typeof err !== 'object') return String(err);

  const e = /** @type {Record<string, unknown>} */ (err);

  // 上游响应体里的 message 最具体，优先取
  const data = /** @type {{error?: {message?: string}, message?: string} | undefined} */ (
    e.data
  );
  if (data && typeof data === 'object') {
    if (typeof data.error?.message === 'string' && data.error.message.trim()) {
      return data.error.message.trim();
    }
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message.trim();
    }
  }

  // RetryError 会把最后一次的错误写进 message（"Failed after N attempts. Last error: ..."）
  if (typeof e.message === 'string' && e.message.trim()) {
    return e.message.trim();
  }

  return deepestMessage(e.cause, depth + 1);
}

/**
 * 剥掉可能含密钥的字段。
 * APICallError 的 requestBodyValues / headers 里可能有 API Key。
 *
 * @param {string} text
 * @returns {string}
 */
function redactSecrets(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/("?(?:api[-_]?key|authorization|token)"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi, '$1***');
}

/**
 * 把上游错误翻译成给用户看的中文文案。
 *
 * @param {unknown} err AI SDK 抛出的错误
 * @param {{ base?: string, model?: string }} ctx 上下文（用于给出针对性建议）
 * @returns {string}
 */
function describeAiError(err, ctx = {}) {
  const name =
    err && typeof err === 'object'
      ? String(/** @type {{name?: string}} */ (err).name || '')
      : '';
  const raw = deepestMessage(err) || '未知错误';

  // RetryError 的 message 形如：
  //   "Failed after 3 attempts. Last error: AI_APICallError: Cannot connect to API: ..."
  // 这里把内层错误提出来，避免用户看到「重试 3 次后仍然失败」却不知道为何。
  const innerMatch = raw.match(/Last error:\s*(.+)$/s);
  const coreRaw = innerMatch ? innerMatch[1] : raw;
  const core = redactSecrets(coreRaw).slice(0, 400);

  const statusCode =
    err && typeof err === 'object'
      ? /** @type {{statusCode?: number}} */ (err).statusCode
      : undefined;
  const kind = name && ERROR_KIND_LABELS[name] ? `（${ERROR_KIND_LABELS[name]}）` : '';

  // 连接类问题单独识别 —— 这是国内用户最常撞上的
  if (/connect timeout|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|Connect Timeout/i.test(core)) {
    const host = hostOf(ctx.base);
    return [
      `无法连接到 AI 服务${host ? `（${host}）` : ''}：${core}`,
      host && /openai\.com/i.test(host)
        ? '提示：api.openai.com 在国内通常无法直连，请改用国内服务商（DeepSeek / 智谱 / 通义千问 / Kimi 等）。'
        : '提示：请检查「系统设置 → AI 服务」里的接口地址是否正确、能否在浏览器中打开。',
    ].join('\n');
  }

  if (statusCode && STATUS_HINTS[statusCode]) {
    return `AI 服务返回 ${statusCode}${kind}：${STATUS_HINTS[statusCode]}\n上游信息：${core}`;
  }

  if (name === 'AI_LoadAPIKeyError') {
    return '尚未配置 API 密钥，请到「系统设置 → AI 服务」填写。';
  }

  return `AI 调用失败${kind}：${core}`;
}

/**
 * 从 base URL 里取出主机名，用于错误提示。
 * @param {string|undefined} base
 * @returns {string|null}
 */
function hostOf(base) {
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

module.exports = { describeAiError, redactSecrets, deepestMessage };
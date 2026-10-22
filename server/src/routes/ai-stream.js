'use strict';

/**
 * ai-stream.js —— Vercel AI SDK 流式对话路由
 *
 * ## 职责
 *
 * 把 AI SDK 的 `useChat` 请求转成上游模型的流式响应，
 * 再把上游流**重新封装成 AI SDK 的 UI 消息流**（`UIMessageChunk` 的 SSE 形态）吐给前端。
 * 前端只需 `readUIMessageStream` 即可解析，两端协议完全对齐。
 *
 * ## 为什么要「重新封装」而不是直接转发上游 SSE
 *
 * 上游三家协议差异极大：
 * - OpenAI 协议：`data: {choices:[{delta:{content}}]}`，工具调用藏在 `delta.tool_calls`
 * - Anthropic：事件名分叉（content_block_delta / input_json_delta …）
 * - Gemini：`streamGenerateContent?alt=sse`，parts 结构完全不同
 *
 * 前端不该为三家协议各写一套解析。AI SDK 已经把这件事做完了，
 * 所以这里只负责「把配置喂给 AI SDK → 拿 AI SDK 的结果流 → 转成 UI 消息流」。
 *
 * ## 工具调用
 *
 * 工具描述来自 shared/ai-tools.json（前后端唯一数据源），
 * 执行器在 server/src/ai-tools.js。多步工具调用由 AI SDK 的
 * `stopWhen: stepCountIs(n)` 驱动：模型请求工具 → 本地执行 → 结果回灌 → 继续生成。
 *
 * 路由：POST /api/ai/stream
 * body: { messages: UIMessage[], capability?, model?, temperature?, tools? }
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { requireAuth } = require('../auth');
const { readCapabilityConfig, readConfig } = require('./ai-proxy');
const { isValidCapability, DEFAULT_CAPABILITY, capabilityName } = require('../providers');
const { executeTool } = require('../ai-tools');
const { describeAiError } = require('../ai-errors');

const {
  streamText,
  tool,
  jsonSchema,
  convertToModelMessages,
  stepCountIs,
  toUIMessageStream,
} = require('ai');

const { createOpenAI } = require('@ai-sdk/openai');
const { createAnthropic } = require('@ai-sdk/anthropic');
const { createGoogleGenerativeAI } = require('@ai-sdk/google');

const router = express.Router();

/** 单次请求最多允许的「模型回合」数：1 次回答 + 最多 4 轮工具调用 */
const MAX_STEPS = 5;

/** 系统提示词：约束工具使用与回答风格 */
const SYSTEM_PROMPT = [
  '你是「智简匣」内置的 AI 助手，运行在用户的本地应用里。',
  '',
  '回答要求：',
  '1. 默认使用简体中文回答，简洁、直接，不写客套话。',
  '2. 需要算数、单位换算、当前时间、文本统计、随机数时，必须调用对应工具，不要自己心算。',
  '3. 工具返回结果后，用一句话把结论说清楚，不要重复粘贴原始数据。',
  '4. 不确定的事直接说不确定，不要编造。',
].join('\n');

/* ------------------------------------------------------------------ *
 * 工具清单加载
 * ------------------------------------------------------------------ */

/** 读不到 shared 时的最小兜底清单（保证路由不因缺文件而 500） */
const FALLBACK_TOOLS = [
  {
    name: 'calculator',
    description: '计算一个数学表达式并返回结果。支持 + - * / % ^ 与括号，例如 (12+8)*3.5。',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要计算的数学表达式，只允许数字与 + - * / % ^ ( ) . 空格' },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
];

let toolCatalogCache = null;

/**
 * 加载工具清单（shared/ai-tools.json），带模块级缓存与兜底
 * @returns {{name:string, description:string, parameters:object}[]}
 */
function loadToolCatalog() {
  if (toolCatalogCache) return toolCatalogCache;

  const candidates = [
    path.join(__dirname, '..', '..', '..', 'shared', 'ai-tools.json'),
    path.join(__dirname, '..', '..', 'shared', 'ai-tools.json'),
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed?.tools) && parsed.tools.length) {
        toolCatalogCache = parsed.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        return toolCatalogCache;
      }
    } catch {
      // 试下一个候选路径
    }
  }

  toolCatalogCache = FALLBACK_TOOLS;
  return toolCatalogCache;
}

/**
 * 把工具清单转成 AI SDK 的 tool() 集合
 * @param {boolean} enabled 是否启用工具（前端可在关掉工具时省 token）
 */
function buildSdkTools(enabled) {
  if (!enabled) return undefined;

  const tools = {};
  for (const item of loadToolCatalog()) {
    if (!item?.name || !item.parameters) continue;
    tools[item.name] = tool({
      description: item.description,
      inputSchema: jsonSchema(item.parameters),
      execute: async (input) => executeTool(item.name, input),
    });
  }
  return Object.keys(tools).length ? tools : undefined;
}

/* ------------------------------------------------------------------ *
 * 模型构造：protocol → AI SDK provider
 * ------------------------------------------------------------------ */

/**
 * 按协议构造 AI SDK 的 LanguageModel
 *
 * 三种协议对应三家官方 provider 包；用户自填的 base（智谱 / DeepSeek / Qwen 等
 * OpenAI 兼容网关）走 openai 分支的 baseURL 覆盖即可。
 *
 * @param {{protocol:string, base:string, key:string}} cfg
 * @param {string} model
 */
function createModel(cfg, model) {
  const baseURL = cfg.base;
  const apiKey = cfg.key;

  switch (String(cfg.protocol || 'openai').toLowerCase()) {
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
      });
      return provider(model);
    }
    case 'gemini': {
      const provider = createGoogleGenerativeAI({
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
      });
      return provider(model);
    }
    default: {
      const provider = createOpenAI({
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
      });
      return provider(model);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

/**
 * POST /api/ai/stream —— AI SDK 流式对话 —— 需要登录
 *
 * body: {
 *   messages: UIMessage[],       // 前端 useChat 的消息数组（含 parts）
 *   capability?: string,        // 默认 chat
 *   model?: string,
 *   temperature?: number,
 *   tools?: boolean,             // 默认 true
 * }
 * 返回: AI SDK UI 消息流（SSE）
 */
router.post('/stream', requireAuth, async (req, res) => {
  const body = req.body || {};
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];

  if (!rawMessages.length) {
    return res.status(400).json({ error: '请提供 messages 数组' });
  }

  const cap = isValidCapability(body.capability) ? body.capability : DEFAULT_CAPABILITY;
  const cfg = readCapabilityConfig(cap);

  if (!cfg.configured) {
    return res.status(400).json({
      error: `「${capabilityName(cap)}」尚未配置服务商，请在「系统设置 → AI 服务」中填写接口地址与密钥`,
    });
  }
  if (!cfg.key) {
    return res.status(400).json({ error: '尚未配置 API 密钥，请前往「系统设置 → AI 服务」填写' });
  }

  const model = String(body.model || cfg.model).trim();
  if (!model) {
    return res.status(400).json({ error: '未指定模型名，请前往「系统设置 → AI 服务」选择模型' });
  }

  const temperature = Number.isFinite(Number(body.temperature))
    ? Number(body.temperature)
    : readConfig().temperature;

  // UIMessage[] → ModelMessage[]（AI SDK 自带转换，tool part 会被正确展开）
  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(rawMessages);
  } catch (err) {
    return res.status(400).json({ error: `消息格式无法解析：${err?.message || '未知错误'}` });
  }

  let sdkTools;
  try {
    sdkTools = buildSdkTools(body.tools !== false);
  } catch (err) {
    return res.status(500).json({ error: `工具初始化失败：${err?.message || '未知错误'}` });
  }

  // 客户端中断时立刻停止向上游发流
  const abortController = new AbortController();
  req.on('aborted', () => abortController.abort());
  req.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const result = streamText({
      model: createModel(cfg, model),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      temperature,
      // 多步工具调用：模型要工具 → 执行 → 回灌 → 继续生成，最多 MAX_STEPS 回合
      stopWhen: stepCountIs(MAX_STEPS),
      ...(sdkTools ? { tools: sdkTools } : {}),
      abortSignal: abortController.signal,
      onError: ({ error }) => {
        // 真实错误必须留档：AI SDK 默认会把一切错误替换成
        // "An error occurred."，日志里若也存这份就永远查不出问题。
        console.warn('[zj-ai-stream] 模型调用出错：', describeAiError(error, { base: cfg.base, model }));
      },
    });

    // 把 streamText 的文本流转成 AI SDK 的 UI 消息流（UIMessageChunk 的 SSE 形态）。
    //
    // ⚠️ 这里曾写成 `createUIMessageStream({ execute: () => result.asUIMessageStream() })`
    // —— `asUIMessageStream` 是 **v4 时代**的方法名，v7 已不存在。
    // 调用它必然抛 `result.asUIMessageStream is not a function`，
    // 于是**每一次后端模式对话都必然失败**（AI 对话面板与所有插件的 AI 功能
    // 全都走这条路径，用户表现为「插件的 AI 功能用不了」）。
    // v7 的正确入口是独立的 `toUIMessageStream({ stream, ... })`。
    //
    // ⚠️ 必须传 onError：AI SDK 的默认值是 `() => 'An error occurred.'`，
    // 本意是不泄漏服务端细节；但本项目后端就跑在用户自己机器上，
    // 而用户遇到的绝大多数是「配置错了 / 网络不通」——
    // 一句无信息量的话会让用户完全无从下手（密钥错？地址错？模型名错？）。
    // 这里改为回传可执行的中文提示（密钥在回传前已剥离）。
    const stream = toUIMessageStream({
      stream: result.stream,
      ...(sdkTools ? { tools: sdkTools } : {}),
      // 原始消息必须带上：多步工具调用时 AI SDK 依赖它回灌工具结果，
      // 缺失会导致第二轮生成缺少上下文。
      originalMessages: rawMessages,
      onError: (error) => describeAiError(error, { base: cfg.base, model }),
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 关掉 nginx 之类的缓冲，否则流式会被攒成一次性返回
      'X-Accel-Buffering': 'no',
    });

    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (abortController.signal.aborted) break;
      res.write(`data: ${JSON.stringify(value)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    // 流还没开始写头时可以正常返回 JSON 错误
    if (!res.headersSent) {
      return res.status(502).json({ error: describeAiError(err, { base: cfg.base, model }) });
    }
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({ type: 'error', errorText: describeAiError(err, { base: cfg.base, model }) })}\n\n`,
      );
      res.end();
    }
  }
});

module.exports = router;
module.exports.MAX_STEPS = MAX_STEPS;
module.exports.loadToolCatalog = loadToolCatalog;
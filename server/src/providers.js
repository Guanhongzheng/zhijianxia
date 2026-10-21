'use strict';

/**
 * providers.js —— AI 服务商共享清单加载与查询
 *
 * 数据源：shared/api-providers.json（前后端唯一数据源，前端直接渲染选择器）
 *
 * 为什么要单独抽一个文件：
 *   server/ 目录在打包 / 分发时可能被单独拷走，届时 shared/ 不一定存在。
 *   因此这里用 try/catch 容错，读不到文件时退回到一份内置的最小兜底清单
 *   （至少包含 openai / anthropic / gemini），保证后端不会因缺文件而崩溃。
 *
 * 说明：ai-proxy.js 位于 server/src/routes/，从那里 require 本文件时
 *   相对路径 'shared/api-providers.json' 即为 ../../../shared/api-providers.json，
 *   与共享契约文档中给出的写法等价。
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * 兜底清单：结构与 shared/api-providers.json 完全一致（字段名不能自创），
 * 仅保留最核心的三个服务商，保证功能可用。
 */
const FALLBACK_CATALOG = {
  version: 1,
  capabilities: [
    { id: 'chat', name: '文本对话', desc: '通用文本生成与多轮对话', icon: 'message-square' },
    { id: 'vision', name: '多模态模型', desc: '支持图片理解的模型', icon: 'eye' },
    { id: 'image', name: '图像生成', desc: '根据文字描述生成图片', icon: 'image' },
    { id: 'speech', name: '语音模型', desc: '语音转文字与文字转语音', icon: 'mic' },
  ],
  providers: [
    {
      id: 'openai',
      name: 'OpenAI API',
      capabilities: ['chat', 'vision', 'image', 'speech'],
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      keyHint: 'sk-...',
      docs: 'https://platform.openai.com/api-keys',
      models: {
        chat: [{ id: 'gpt-4o-mini', name: 'GPT-4o mini', desc: '性价比高，响应快' }],
        vision: [{ id: 'gpt-4o', name: 'GPT-4o', desc: '支持图片理解' }],
        image: [{ id: 'dall-e-3', name: 'DALL·E 3', desc: '画质细腻' }],
        speech: [{ id: 'whisper-1', name: 'Whisper API', desc: '语音转文字' }],
      },
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude API',
      capabilities: ['chat', 'vision'],
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      keyHint: 'sk-ant-...',
      docs: 'https://console.anthropic.com/settings/keys',
      models: {
        chat: [{ id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', desc: '稳定可靠' }],
        vision: [{ id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', desc: '支持图片理解' }],
      },
    },
    {
      id: 'gemini',
      name: 'Google Gemini API',
      capabilities: ['chat', 'vision'],
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      keyHint: 'AIza...',
      docs: 'https://aistudio.google.com/app/apikey',
      models: {
        chat: [{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', desc: '长上下文，复杂任务' }],
        vision: [{ id: 'gemini-1.5-pro', name: 'Gemini Pro Vision', desc: '高精度图像理解' }],
      },
    },
  ],
};

/**
 * 依次尝试若干候选路径，返回第一个可解析的清单。
 * 说明：从 server/src/ 出发是 ../../shared/api-providers.json；
 *      从 server/src/routes/ 出发是 ../../../shared/api-providers.json。
 * @returns {object} 共享清单
 */
function loadCatalog() {
  const candidates = [
    path.join(__dirname, '..', '..', 'shared', 'api-providers.json'),
    path.join(__dirname, '..', '..', '..', 'shared', 'api-providers.json'),
  ];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      // 结构校验：必须同时具备 capabilities 与 providers 数组
      if (Array.isArray(parsed?.capabilities) && Array.isArray(parsed?.providers)) {
        return parsed;
      }
    } catch {
      // 落到下一个候选路径，全部失败则使用兜底清单
    }
  }
  return FALLBACK_CATALOG;
}

/** 共享清单（模块加载时确定一次） */
const catalog = loadCatalog();

/** 清单里声明的全部能力 id，顺序即前端渲染顺序 */
const CAPABILITY_IDS = catalog.capabilities.map((c) => c.id);

/** 默认能力：未显式指定 capability 时按文本对话处理 */
const DEFAULT_CAPABILITY = 'chat';

/**
 * 按 id 查找服务商
 * @param {string} id
 * @returns {object|null}
 */
function getProvider(id) {
  const key = String(id || '').trim();
  return catalog.providers.find((p) => p.id === key) || null;
}

/**
 * 服务商是否支持某项能力
 * @param {string} providerId
 * @param {string} capability
 * @returns {boolean}
 */
function providerSupports(providerId, capability) {
  const provider = getProvider(providerId);
  if (!provider) return false;
  return Array.isArray(provider.capabilities) && provider.capabilities.includes(capability);
}

/**
 * 列出支持某项能力的服务商
 * @param {string} capability
 * @returns {object[]}
 */
function listProvidersFor(capability) {
  return catalog.providers.filter(
    (p) => Array.isArray(p.capabilities) && p.capabilities.includes(capability)
  );
}

/**
 * 取某服务商在某能力下的模型清单
 * @param {string} providerId
 * @param {string} capability
 * @returns {{id:string,name:string,desc?:string}[]}
 */
function modelsFor(providerId, capability) {
  const provider = getProvider(providerId);
  const list = provider?.models?.[capability];
  return Array.isArray(list) ? list : [];
}

/**
 * 取某能力下的第一个模型 id，用作默认值
 * @param {string} providerId
 * @param {string} capability
 * @returns {string} 没有则返回空串
 */
function defaultModelFor(providerId, capability) {
  const list = modelsFor(providerId, capability);
  return list.length ? String(list[0].id) : '';
}

/**
 * 判断 capability 是否为清单内合法取值
 * @param {string} capability
 * @returns {boolean}
 */
function isValidCapability(capability) {
  return CAPABILITY_IDS.includes(capability);
}

/**
 * 取某项能力的中文名称，用于拼接错误提示
 * @param {string} capability
 * @returns {string}
 */
function capabilityName(capability) {
  const hit = catalog.capabilities.find((c) => c.id === capability);
  return hit ? hit.name : String(capability || '');
}

module.exports = {
  catalog,
  CAPABILITY_IDS,
  DEFAULT_CAPABILITY,
  FALLBACK_CATALOG,
  getProvider,
  providerSupports,
  listProvidersFor,
  modelsFor,
  defaultModelFor,
  isValidCapability,
  capabilityName,
};
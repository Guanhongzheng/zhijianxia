'use strict';

/**
 * prompts.js —— 后端侧 Prompt 模板渲染
 *
 * 与 `src/lib/prompts/index.ts` 一对：同一份 `shared/prompts.json`，
 * 各自实现渲染（后端是 CommonJS，无法直接复用 TS 模块）。
 *
 * **两边必须产出完全一致的结果** —— `scripts/prompt-test.mjs` 会直接对比，
 * 不一致就失败。这是防止"改了前端忘了后端"的唯一可靠手段。
 */

const fs = require('node:fs');
const path = require('node:path');

/** 找到 shared/prompts.json（打包后目录层级可能变化，按候选路径找） */
function findCatalogFile() {
  const candidates = [
    path.join(__dirname, '..', '..', 'shared', 'prompts.json'),
    path.join(__dirname, '..', 'shared', 'prompts.json'),
    path.join(process.cwd(), 'shared', 'prompts.json'),
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

/** 读不到文件时的兜底：宁可少几条规则，也不能让对话 500 */
const FALLBACK = {
  'assistant.system':
    '你是「{{appName}}」内置的 AI 助手。回答简洁、准确；不确定就说不确定。需要工具时必须调用，不要心算。',
  'assistant.system.local':
    '你是「{{appName}}」内置的本地 AI 助手。回答简洁、准确；不确定就说不确定。',
};

const DEFAULT_VARS = { appName: '智简匣' };

/** 用户输入里的聊天模板控制标记 */
const CONTROL_TOKEN = /<\|(?:im_start|im_end|endoftext|endofprompt|start|end)\|>|<\/?s>/g;

let cached = null;

/** @returns {{format:string, templates:{id:string,version:number,body:string,variables:string[]}[]}} */
function loadCatalog() {
  if (cached) return cached;
  const file = findCatalogFile();
  if (!file) {
    cached = { format: 'fallback', templates: [] };
    return cached;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    cached = {
      format: typeof parsed.format === 'string' ? parsed.format : 'unknown',
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
    };
  } catch {
    cached = { format: 'fallback', templates: [] };
  }
  return cached;
}

/** 按 id 取模板（找不到返回兜底正文） */
function getTemplate(id) {
  const found = loadCatalog().templates.find((t) => t.id === id);
  if (found && typeof found.body === 'string') return found;
  return { id, version: 0, body: FALLBACK[id] ?? FALLBACK['assistant.system'], variables: [] };
}

/**
 * 渲染 `{{var}}` 占位符；未提供的变量原样保留（与前端行为一致）。
 * @param {string} body
 * @param {Record<string,string>} [vars]
 */
function renderTemplate(body, vars = {}) {
  const merged = { ...DEFAULT_VARS, ...vars };
  return String(body).replace(/\{\{(\w+)\}\}/g, (match, key) => (key in merged ? merged[key] : match));
}

/**
 * 取系统提示词。
 * @param {'tools'|'local'} [mode]
 * @param {Record<string,string>} [vars]
 */
function getSystemPrompt(mode = 'tools', vars = {}) {
  const id = mode === 'local' ? 'assistant.system.local' : 'assistant.system';
  return renderTemplate(getTemplate(id).body, vars);
}

/** 剔除用户输入里的聊天模板控制标记（服务端也做一遍，不假设客户端已处理） */
function sanitizeUserText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(CONTROL_TOKEN, '');
}

/** 版本标识，如 `assistant.system@2` */
function promptVersionTag(mode = 'tools') {
  const id = mode === 'local' ? 'assistant.system.local' : 'assistant.system';
  const t = getTemplate(id);
  return `${t.id}@${t.version ?? 0}`;
}

/** 测试用：清掉模块级缓存 */
function resetPromptCache() {
  cached = null;
}

module.exports = {
  CONTROL_TOKEN,
  DEFAULT_VARS,
  getTemplate,
  renderTemplate,
  getSystemPrompt,
  sanitizeUserText,
  promptVersionTag,
  resetPromptCache,
  findCatalogFile,
};

/**
 * Prompt 模板层（前端侧入口）
 *
 * 解决的问题（不是「为了有 Prompt 模块」）：
 *
 * 1. **本地模式此前完全没有系统提示词**。后端转发有 `SYSTEM_PROMPT` 常量，
 *    本地推理直接把用户消息丢进 ChatML —— 同一句话在两种模式下风格、
 *    边界、约束全不一致。现在两边渲染同一份 `shared/prompts.json`。
 * 2. **模板散落在两处代码里**。改一处忘另一处是最典型的漂移。
 *    这里把"写什么"收进 JSON，"怎么渲染"放在 `render.ts`（可被测试直接加载），
 *    用 `scripts/prompt-test.mjs` 保证前后端产出逐字符一致。
 * 3. **用户输入可以伪造对话结构**。见 `sanitizeUserText` ——
 *    本地推理没有服务端兜底，这是最现实的注入路径。
 *
 * 版本：每条模板带 `version`，改动正文必须递增。`promptVersionTag()`
 * 给出可上报的标识（`assistant.system.local@2`）—— 采集端目前尚未接入，
 * 这块留待需要回答「这条坏回答是哪版提示词产生的」时再接遥测。
 */

import catalog from '../../../shared/prompts.json';
import {
  DEFAULT_PROMPT_VARS,
  renderTemplate,
  sanitizeUserText,
  hasControlTokens,
  type PromptTemplate,
} from './render';

export type PromptTemplateId = 'assistant.system' | 'assistant.system.local';
export { DEFAULT_PROMPT_VARS, renderTemplate, sanitizeUserText, hasControlTokens };
export type { PromptTemplate };

interface PromptCatalog {
  format: string;
  note?: string;
  templates: PromptTemplate[];
}

const TEMPLATES = (catalog as PromptCatalog).templates;

export function listTemplates(): PromptTemplate[] {
  return TEMPLATES;
}

export function getTemplate(id: PromptTemplateId): PromptTemplate {
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) {
    // 模板缺失属于发布事故，但不能让聊天直接崩：给一条最小可用提示词
    return {
      id,
      version: 0,
      description: 'fallback',
      variables: [],
      body: '你是「{{appName}}」内置的 AI 助手。回答简洁、准确，不确定就说不确定。',
    };
  }
  return found;
}

/**
 * 取系统提示词。
 *
 * @param mode `'tools'` 后端转发（有工具）/ `'local'` 本地推理（无工具）
 */
export function getSystemPrompt(
  mode: 'tools' | 'local',
  vars: Record<string, string> = {},
): string {
  const id: PromptTemplateId = mode === 'tools' ? 'assistant.system' : 'assistant.system.local';
  return renderTemplate(getTemplate(id), vars);
}

/** 提示词版本标识，如 `assistant.system.local@2`，上报遥测时用 */
export function promptVersionTag(mode: 'tools' | 'local'): string {
  const id: PromptTemplateId = mode === 'tools' ? 'assistant.system' : 'assistant.system.local';
  const t = getTemplate(id);
  return `${t.id}@${t.version}`;
}

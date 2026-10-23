/**
 * Prompt 渲染的纯函数部分
 *
 * 与 `index.ts` 分开的原因：`index.ts` 要 `import catalog from '*.json'`（打包器支持，
 * Node 的 ESM 需要 import attributes，直接跑会失败）。而渲染逻辑需要被
 * `scripts/prompt-test.mjs` 直接加载，用来和后端 `server/src/prompts.js`
 * 对比渲染结果 —— 所以这里**不引用任何 JSON**，目录数据由调用方传入。
 */

export interface PromptTemplate {
  id: string;
  version: number;
  description: string;
  variables: string[];
  body: string;
}

/** 渲染模板时默认带入的变量 */
export const DEFAULT_PROMPT_VARS: Record<string, string> = {
  appName: '智简匣',
};

/** 聊天模板的控制标记 —— 用户输入里出现即需剔除 */
export const CONTROL_TOKEN = /<\|(?:im_start|im_end|endoftext|endofprompt|start|end)\|>|<\/?s>/g;

/**
 * 渲染模板：替换 `{{var}}`。
 *
 * 未提供的变量**原样保留**而不是替换为空 —— 空字符串会让提示词读成
 * 「你是「」内置的助手」，而保留占位符能让测试与用户立刻看出漏传了变量。
 */
export function renderTemplate(
  template: Pick<PromptTemplate, 'body'>,
  vars: Record<string, string> = {},
): string {
  const merged = { ...DEFAULT_PROMPT_VARS, ...vars };
  return String(template.body ?? '').replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in merged ? merged[key] : match,
  );
}

/**
 * 剔除用户输入里的聊天模板控制标记。
 *
 * 为什么必须做：ChatML 靠 `<|im_start|>system` 这类标记切分角色，
 * 用户在输入框里打出来就能伪造一个 system 轮（本地推理没有服务端兜底）。
 * 这里**删除标记本身**而不是转义：转义后模型仍会读到「im_start」字样，
 * 反而更容易被诱导；而正常用户不会需要输入这些标记。
 */
export function sanitizeUserText(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(CONTROL_TOKEN, '');
}

/** 判断一段文本是否包含可疑的模板标记（用于遥测，不改变行为） */
export function hasControlTokens(text: string): boolean {
  if (typeof text !== 'string') return false;
  CONTROL_TOKEN.lastIndex = 0;
  return CONTROL_TOKEN.test(text);
}

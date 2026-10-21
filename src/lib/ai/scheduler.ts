/**
 * 统一 AI 调度层 —— 自动判断当前模式（前端本地 / 后端转发）与后端在线状态。
 * 插件与业务模块只依赖本模块，无需关心底层实现。
 */

import {
  localChat,
  loadLocalModel,
  getLocalAiState,
  subscribeLocalAi,
  type ChatMessage,
  type LocalAiState,
} from './local-engine';
import { backendChat } from '@/lib/backend/api';
import type { LanConfig } from '@/lib/backend/client';
import { runChatChain, type ChainMessage } from './chain';

export type AiMode = 'local' | 'backend';

export interface AiRequestContext {
  mode: AiMode;
  lan: LanConfig;
  token: string | null;
}

export class BackendRequiredError extends Error {
  constructor() {
    super('后端服务未开启，请启动后端服务后再使用该功能');
    this.name = 'BackendRequiredError';
  }
}

/**
 * 统一 AI 对话入口。
 * - mode='local'：走浏览器内 ONNX Runtime 推理（WebGPU 优先，WASM 兜底），无需后端
 * - mode='backend'：转发到后端配置的外部 API
 *
 * 两种模式都经由 LangChain 的 LCEL 链统一编排（见 chain.ts），
 * 好处是提示词拆分、输出清洗等行为在两条路径上完全一致，
 * 也便于将来挂上记忆与流式。
 */
export async function aiChat(
  ctx: AiRequestContext,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; systemSuffix?: string } = {},
): Promise<string> {
  const { systemSuffix, ...genOpts } = opts;

  if (ctx.mode === 'backend') {
    if (!ctx.token) throw new BackendRequiredError();
    const generator = async (msgs: ChainMessage[]) => {
      const reply = await backendChat(ctx.lan, ctx.token!, msgs);
      return reply.trim();
    };
    return runChatChain(generator, messages, { systemSuffix });
  }

  // 本地模式：确保模型已加载（WebGPU / WASM 由 local-engine 自动决策）
  await loadLocalModel();
  const generator = async (msgs: ChainMessage[]) =>
    localChat(msgs, genOpts);
  return runChatChain(generator, messages, { systemSuffix });
}

/** 预热本地模型（供用户在设置里手动触发） */
export async function warmupLocalAi(): Promise<void> {
  await loadLocalModel();
}

export { getLocalAiState, subscribeLocalAi, loadLocalModel };
export type { ChatMessage, LocalAiState };
// 转发链编排能力，供插件与业务模块直接使用
export { ConversationMemory, chatWithMemory } from './chain';
export type { ChainMessage } from './chain';

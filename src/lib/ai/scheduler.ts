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
 * - mode='local'：走浏览器内 Transformers.js 推理，无需后端
 * - mode='backend'：转发到后端配置的外部 API
 */
export async function aiChat(
  ctx: AiRequestContext,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  if (ctx.mode === 'backend') {
    if (!ctx.token) throw new BackendRequiredError();
    const reply = await backendChat(ctx.lan, ctx.token, messages);
    return reply.trim();
  }

  // 本地模式：确保模型已加载
  await loadLocalModel();
  return localChat(messages, opts);
}

/** 预热本地模型（供用户在设置里手动触发） */
export async function warmupLocalAi(): Promise<void> {
  await loadLocalModel();
}

export { getLocalAiState, subscribeLocalAi, loadLocalModel };
export type { ChatMessage, LocalAiState };

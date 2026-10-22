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
import type { ChainMessage } from './chain';

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
 * 加载 LCEL 编排层（**动态导入**）。
 *
 * ## 为什么必须是动态的
 *
 * `chain.ts` 静态依赖 `@langchain/core`，而它连同 zod 在首屏 chunk 里
 * 占了 1570 KB（未压缩）—— **整个构建产物的 46%**，
 * 传输后 412 KB，占首屏 JS 总量的 61%。
 *
 * 而这条导入链是首屏必经的：
 *
 *     page.tsx → providers.tsx → plugin-store.ts → scheduler.ts → chain.ts
 *
 * `providers.tsx` 启动时就要 boot 插件内核，`plugin-store.ts` 又静态导入了本模块。
 * 于是**用户只是打开首页、根本没打算用 AI**，也要先下载 412 KB 的编排库。
 *
 * 改成动态导入后，LangChain 只在**真正发起 AI 调用时**才被拉取 ——
 * 首屏不再为「可能永远用不到」的功能付费。
 *
 * 行为完全不变：`aiChat` 本来就是 async，多一次 await 无副作用。
 */
async function loadChain() {
  return import('./chain');
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
  const { runChatChain } = await loadChain();

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
export type { ChainMessage } from './chain';

/* -------------------------------------------------------------------------- */
/* 转发链编排能力（供插件与业务模块直接使用）                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ 这两个此前是**静态 re-export**，会把 LangChain 拖进首屏 chunk。
 * 现改为惰性代理：调用时才加载 chain 模块，行为与原先完全一致。
 *
 * `ConversationMemory` 是类（需 `new`），不能直接 re-export，
 * 因此用工厂函数返回实例。
 */

/** 会话记忆的公开形态（与 chain.ts 的 ConversationMemory 一致） */
export interface ConversationMemoryLike {
  add(userContent: string, aiContent: string): void;
  messages(): ChainMessage[];
  toChainMessages(): ChainMessage[];
  readonly turns: number;
  clear(): void;
}

/** 创建会话记忆（等价于原先的 `new ConversationMemory(maxTurns)`） */
export async function createConversationMemory(maxTurns = 6): Promise<ConversationMemoryLike> {
  const { ConversationMemory } = await loadChain();
  return new ConversationMemory(maxTurns);
}

/** 带记忆的对话执行器（多轮上下文场景） */
export async function chatWithMemory(
  memory: ConversationMemoryLike,
  generator: (messages: ChainMessage[]) => Promise<string>,
  userInput: string,
  opts: { systemSuffix?: string } = {},
): Promise<string> {
  const mod = await loadChain();
  // chain.ts 的实现只用到记忆的公开方法（add / toChainMessages），
  // 这里把结构类型转成它期望的类类型即可。
  return mod.chatWithMemory(
    memory as unknown as Parameters<typeof mod.chatWithMemory>[0],
    generator,
    userInput,
    opts,
  );
}
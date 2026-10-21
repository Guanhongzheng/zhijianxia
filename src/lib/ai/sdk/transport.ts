/**
 * AI SDK 聊天传输层
 *
 * ## 为什么需要自定义 transport
 *
 * AI SDK 的 `useChat` 默认通过 HTTP 请求服务端接口（`DefaultChatTransport`）。
 * 但本项目的推理有两条完全不同的路径：
 *
 * 1. **本地模式** —— 模型跑在**浏览器内**（ONNX Runtime Web / WebGPU / WASM），
 *    根本没有服务端接口可打；
 * 2. **外部 API 模式** —— 请求要经后端转发（密钥存在后端，前端拿不到）。
 *
 * 所以这里实现一个 `ChatTransport`：对 AI SDK 而言两者形态一致，
 * 都产出 `UIMessageChunk` 流；对内核而言各自走最合适的通道。
 *
 * ## 产出的 chunk 协议
 *
 * AI SDK v7 的 UI 消息流协议（`UIMessageChunk`）：
 * - `text-start` / `text-delta` / `text-end` —— 正文增量
 * - `tool-input-start` / `tool-input-delta` / `tool-input-available` —— 工具入参
 * - `tool-output-available` —— 工具执行结果
 * - `error` —— 错误
 */

import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { localChatStream } from '@/lib/ai/local-engine';
import { backendStreamChat } from '@/lib/backend/ai-stream';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import type { LanConfig } from '@/lib/backend/client';

/** 本项目使用的消息类型（目前就是标准 UIMessage） */
export type ZjUIMessage = UIMessage;

/** 传输层需要的上下文 */
export interface ZjTransportContext {
  /** 推理通道：local = 浏览器内推理，backend = 后端转发 */
  mode: 'local' | 'backend';
  /** 局域网配置（backend 模式用） */
  lan: LanConfig;
  /** 登录令牌（backend 模式用） */
  token: string | null;
}

/** 从全局 store 读取当前传输上下文 */
export function readTransportContext(): ZjTransportContext {
  const { api, lan } = useAppStore.getState();
  return {
    mode: api.mode,
    lan,
    token: useAuthStore.getState().token,
  };
}

/**
 * 把 UIMessage 数组压成「模型能看懂的」消息数组。
 *
 * AI SDK 的 UIMessage 里正文是 `parts` 数组（可能混有 tool part），
 * 而模型侧只认 role + content，因此要抽取纯文本。
 * 工具结果也拼进上下文，让模型知道工具返回了什么。
 */
export function toModelMessages(
  messages: UIMessage[],
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const chunks: string[] = [];
    for (const part of msg.parts ?? []) {
      const p = part as { type?: string; text?: string; output?: unknown };
      if (p.type === 'text' && typeof p.text === 'string') {
        chunks.push(p.text);
      } else if (p.type?.startsWith('tool-') && p.output !== undefined) {
        chunks.push(`[工具结果] ${JSON.stringify(p.output)}`);
      }
    }
    const text = chunks.join('\n').trim();
    if (!text) continue;
    out.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
  }
  return out;
}

/**
 * 构造一个 `ReadableStream<UIMessageChunk>`，由给定的产出器填充。
 *
 * 抽出来是为了让「本地推理」与「后端转发」共用同一套 chunk 产出逻辑，
 * 避免两条路径的 chunk 形态出现细微差异（那会让 UI 行为不一致）。
 */
function chunkStream(
  produce: (emit: (chunk: UIMessageChunk) => void) => Promise<void>,
): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      try {
        await produce((chunk) => controller.enqueue(chunk));
        controller.close();
      } catch (err) {
        controller.enqueue({
          type: 'error',
          errorText: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      }
    },
  });
}

/** 生成一个短 id */
function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 本地模式 transport —— 在浏览器内跑 ONNX 模型。
 *
 * 流程：
 * 1. 把 UIMessage 转成模型消息；
 * 2. 逐段消费 `localChatStream` 的增量，转成 `text-delta` chunk；
 * 3. 结束后发 `text-end`。
 *
 * 本地小模型不擅长原生 function calling，因此这里的工具调用
 * 走「提示词约定 + 前端解析」的路子（见 `parseLocalToolCalls`）。
 */
function localTransport(
  messages: UIMessage[],
  signal: AbortSignal | undefined,
): ReadableStream<UIMessageChunk> {
  return chunkStream(async (emit) => {
    const textId = shortId();
    emit({ type: 'text-start', id: textId });

    const modelMessages = toModelMessages(messages);
    let emitted = '';
    try {
      for await (const delta of localChatStream(modelMessages, { signal })) {
        if (signal?.aborted) break;
        emitted += delta;
        emit({ type: 'text-delta', id: textId, delta });
      }
    } catch (err) {
      emit({
        type: 'error',
        errorText: err instanceof Error ? err.message : String(err),
      });
    }
    emit({ type: 'text-end', id: textId });
    void emitted;
  });
}

/**
 * 解析后端返回的 SSE，逐块产出 `UIMessageChunk`。
 *
 * 为什么不直接用 AI SDK 的 `readUIMessageStream`：
 * 那个函数吃进去的是 `ReadableStream<UIMessageChunk>`，吐出来的是**已还原的 UIMessage**，
 * 而 transport 必须返回 chunk 流（useChat 内部还会再拼装一次）。
 * 这里只需要把 `data: {...}` 行拆出来，是几十行就能写完的纯文本活，
 * 没必要为此把整条流先 buffer 成字符串。
 */
function sseChunkStream(body: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      for (;;) {
        // SSE 以空行（\n\n）分隔一条事件
        const boundary = buffer.search(/\r?\n\r?\n/);
        if (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');

          const dataLines = rawEvent
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());

          if (!dataLines.length) continue;

          const payload = dataLines.join('\n');
          // [DONE] 是流结束标记，不是 chunk
          if (payload === '[DONE]') {
            controller.close();
            return;
          }

          try {
            controller.enqueue(JSON.parse(payload) as UIMessageChunk);
          } catch {
            // 单条事件解析失败不应中断整条流，跳过即可
          }
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * 后端模式 transport —— 经后端转发到外部 AI 服务。
 *
 * 后端返回的是 AI SDK 的 UI 消息流（SSE），
 * 这里解析成 `UIMessageChunk` 序列交给 `useChat`。
 */
async function backendTransport(
  ctx: ZjTransportContext,
  messages: UIMessage[],
  signal: AbortSignal | undefined,
  tools: boolean,
): Promise<ReadableStream<UIMessageChunk>> {
  const response = await backendStreamChat(ctx.lan, ctx.token, messages, signal, tools);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `后端返回 ${response.status}`);
  }
  if (!response.body) {
    throw new Error('后端未返回响应流');
  }
  return sseChunkStream(response.body);
}

/** transport 的可选配置 */
export interface ZjTransportOptions {
  /**
   * 工具开关。**每次发送时读取**，因此面板上切换开关能立刻生效，
   * 不需要重建 transport（重建会让进行中的流断掉）。
   */
  isToolsEnabled?: () => boolean;
}

/**
 * 创建 transport。
 *
 * 模式在**每次发送时**才决定，而不是创建时 —— 因为用户可能在设置里
 * 随时切换「本地推理 / 外部 API」，transport 实例是长期存在的。
 */
export function createZjTransport(options: ZjTransportOptions = {}): ChatTransport<UIMessage> {
  return {
    async sendMessages(sendOptions) {
      const ctx = readTransportContext();
      if (ctx.mode === 'backend') {
        if (!ctx.token) {
          throw new Error('后端服务未开启，请启动后端服务后再使用该功能');
        }
        return backendTransport(
          ctx,
          sendOptions.messages,
          sendOptions.abortSignal,
          options.isToolsEnabled?.() ?? true,
        );
      }
      return localTransport(sendOptions.messages, sendOptions.abortSignal);
    },
    async reconnectToStream() {
      // 不支持断线重连：本地推理无法在页面刷新后恢复
      return null;
    },
  };
}

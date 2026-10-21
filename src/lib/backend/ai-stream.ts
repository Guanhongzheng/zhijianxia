/**
 * 后端流式对话客户端
 *
 * 对应后端路由 `POST /api/ai/stream`（server/src/routes/ai-stream.js）。
 * 该路由返回 **AI SDK 的 UI 消息流**（SSE，`text/event-stream`），
 * 前端用 `readUIMessageStream` 解析成 `UIMessageChunk` 序列。
 *
 * 与 `backendChat`（一次性）的区别：这里**不解析响应体**，
 * 而是直接把 `Response` 交出去，让调用方边读边渲染。
 */

import { backendBaseUrl, type LanConfig } from './client';
import type { UIMessage } from 'ai';

/**
 * 发起一次流式对话。
 *
 * @param cfg 局域网配置
 * @param token 登录令牌
 * @param messages UI 消息历史
 * @param signal 中断信号
 * @param tools 是否允许模型调用工具（面板上的开关会实时控制它）
 */
export async function backendStreamChat(
  cfg: LanConfig,
  token: string | null,
  messages: UIMessage[],
  signal?: AbortSignal,
  tools = true,
): Promise<Response> {
  if (!token) {
    throw new Error('后端服务未开启，请启动后端服务后再使用该功能');
  }
  const url = `${backendBaseUrl(cfg)}/api/ai/stream`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages, tools }),
    signal,
  });

  if (!res.ok) {
    // 错误响应体是 JSON（{ error }），读出来给上层展示
    const detail = await res.text().catch(() => '');
    let message = `后端返回 ${res.status}`;
    try {
      const parsed = JSON.parse(detail) as { error?: unknown };
      if (parsed && typeof parsed.error === 'string') message = parsed.error;
    } catch {
      if (detail) message = detail;
    }
    throw new Error(message);
  }

  return res;
}

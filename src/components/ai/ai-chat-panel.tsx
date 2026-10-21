'use client';

/**
 * ai-chat-panel.tsx —— AI SDK 流式对话面板
 *
 * ## 这一层做了什么
 *
 * 直接把 AI SDK 的 `useChat` 接到本项目的双通道 transport 上：
 *
 * ```
 * useChat({ transport: createZjTransport() })
 *   ├── 本地模式 → 浏览器内 ONNX 模型（localChatStream），逐 token 渲染
 *   └── 后端模式 → POST /api/ai/stream → 外部模型，原生 function calling
 * ```
 *
 * 消息渲染按 `parts` 逐个分发：文本 part 走正文，
 * `tool-*` part 交给 `ToolPartView` 渲染成结果卡片（生成式 UI）。
 *
 * ## 为什么正文要自己处理流式光标
 *
 * AI SDK 的 `status` 已经覆盖了 submitted / streaming / ready / error，
 * 但「光标」属于纯视觉细节，交给 CSS 动画（`animate-pulse` 的方块）
 * 比在正文里插一个会跟着重渲染跳动的字符更稳。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  Send,
  Square,
  Sparkles,
  RotateCcw,
  Wrench,
  User,
  Bot,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/store/app-store';
import { useAuthStore } from '@/store/auth-store';
import { createZjTransport, type ZjUIMessage } from '@/lib/ai/sdk/transport';
import { AI_TOOLS } from '@/lib/ai/sdk/tools';
import { ToolPartView } from './tool-parts';
import type { ToolUIPart, UIMessage } from 'ai';

/** 欢迎区的推荐问题：覆盖文本生成与全部 5 个工具，便于一眼验证三项能力 */
const SUGGESTIONS = [
  '用一句话解释什么是 WebGPU',
  '帮我算一下 (128*3.7+56)/4.2',
  '3.5 公里等于多少米？',
  '统计这段文字：智简匣是一个本地优先的 AI 工作台，支持离线推理与插件扩展。',
  '现在几点了？用北京时间',
  '掷一个 1 到 100 的随机数',
];

/** 是否处于「生成中」 */
function isBusy(status: string): boolean {
  return status === 'submitted' || status === 'streaming';
}

/**
 * 从 UIMessage 里取出纯文本（用于消息列表里 tool part 之外的兜底显示）
 */
function textOf(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is Extract<(typeof message.parts)[number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** 判断 part 是否为工具 part */
function isToolPart(part: { type: string }): part is ToolUIPart {
  return part.type.startsWith('tool-');
}

/* -------------------------------------------------------------------------- */
/* 单条消息                                                                    */
/* -------------------------------------------------------------------------- */

function MessageRow({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const text = useMemo(() => textOf(message), [message]);
  const toolParts = useMemo(
    () => (message.parts ?? []).filter(isToolPart),
    [message.parts],
  );

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* 头像 */}
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-[var(--zj-muted-fg)]/15 text-[var(--zj-muted-fg)]'
            : 'bg-[var(--zj-accent)]/15 text-[var(--zj-accent)]',
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      <div className={cn('min-w-0 flex-1 space-y-2', isUser && 'flex flex-col items-end')}>
        {text ? (
          <div
            className={cn(
              'max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--zj-radius)] px-3.5 py-2.5 text-sm leading-relaxed',
              isUser
                ? 'bg-[var(--zj-accent)] text-[var(--zj-accent-fg)]'
                : 'bg-[var(--zj-card)] text-[var(--zj-fg)] ring-1 ring-[var(--zj-border)]',
            )}
          >
            {text}
          </div>
        ) : null}

        {/* 生成式 UI：工具调用结果 */}
        {toolParts.map((part, i) => (
          <div key={`${part.type}-${i}`} className="max-w-[92%]">
            <ToolPartView part={part} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 主面板                                                                      */
/* -------------------------------------------------------------------------- */

export interface AiChatPanelProps {
  className?: string;
}

export function AiChatPanel({ className }: AiChatPanelProps) {
  const [input, setInput] = useState('');
  const [toolsEnabled, setToolsEnabled] = useState(true);

  const mode = useAppStore((s) => s.api.mode);
  const token = useAuthStore((s) => s.token);

  // transport 需要在整个会话生命周期内稳定，
  // 所以用 useState 惰性创建而不是 useMemo（后者在 StrictMode 下可能被重算）。
  //
  // 工具开关通过 ref 透传：transport 在发送时才读 ref.current，
  // 因此切换开关立刻生效，且不需要重建 transport（那会打断进行中的流）。
  const toolsEnabledRef = useRef(toolsEnabled);
  toolsEnabledRef.current = toolsEnabled;

  const [transport] = useState(() =>
    createZjTransport({ isToolsEnabled: () => toolsEnabledRef.current }),
  );

  const { messages, sendMessage, status, error, stop, regenerate, setMessages } = useChat({
    transport,
    // 错误统一由下面的 error 区块展示，这里不重复弹窗
    onError: () => {},
  });

  const busy = isBusy(status);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息 / 流式增量到达时滚到底
  const lastText = messages[messages.length - 1]?.parts?.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, lastText]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setInput('');
      void sendMessage({ text: trimmed });
    },
    [busy, sendMessage],
  );

  const backendNotReady = mode === 'backend' && !token;

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3', className)}>
      {/* 顶部工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full bg-[var(--zj-muted-fg)]/10 px-2.5 py-1 text-xs text-[var(--zj-muted-fg)]">
          <Sparkles className="size-3" />
          {mode === 'local' ? '本地推理（浏览器内）' : '后端转发（外部 API）'}
        </div>

        <button
          type="button"
          onClick={() => setToolsEnabled((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
            toolsEnabled
              ? 'bg-[var(--zj-accent)]/15 text-[var(--zj-accent)]'
              : 'bg-[var(--zj-muted-fg)]/10 text-[var(--zj-muted-fg)]',
          )}
          title="开关后端模式下的工具调用"
        >
          <Wrench className="size-3" />
          工具 {toolsEnabled ? '开' : '关'}
        </button>

        <span className="text-xs text-[var(--zj-muted-fg)]">
          共 {AI_TOOLS.length} 个：{AI_TOOLS.map((t) => t.name).join(' / ')}
        </span>

        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => setMessages([])}
          >
            <RotateCcw className="size-3" />
            清空
          </Button>
        )}
      </div>

      {mode === 'local' && (
        <p className="rounded-[var(--zj-radius)] bg-[var(--zj-muted-fg)]/8 px-3 py-2 text-xs text-[var(--zj-muted-fg)]">
          当前是<b className="text-[var(--zj-fg)]">本地推理</b>
          ：模型跑在浏览器里（ONNX Runtime），正文为真流式输出。
          浏览器内小模型通常不会原生发起工具调用，工具卡片主要在
          <b className="text-[var(--zj-fg)]">后端转发</b>模式下出现。
        </p>
      )}

      {backendNotReady && (
        <p className="flex items-start gap-2 rounded-[var(--zj-radius)] bg-[var(--zj-danger)]/10 px-3 py-2 text-xs text-[var(--zj-danger)]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          后端模式需要先登录并启动后端服务；请到「系统设置 → 局域网 / 后端」完成配置。
        </p>
      )}

      {/* 消息区 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-[var(--zj-radius)] border border-[var(--zj-border)] bg-[var(--zj-card)]/40 p-4"
      >
        {messages.length === 0 ? (
          <div className="space-y-3 py-4">
            <p className="text-center text-sm text-[var(--zj-muted-fg)]">
              问点什么，或点下面任意一条试试
            </p>
            <div className="mx-auto flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-[var(--zj-border)] px-3 py-1.5 text-xs text-[var(--zj-muted-fg)] transition-colors hover:border-[var(--zj-accent)] hover:text-[var(--zj-fg)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageRow key={m.id} message={m} />)
        )}

        {/* 等待首字节时的骨架 */}
        {status === 'submitted' && (
          <div className="flex items-center gap-2 pl-10 text-xs text-[var(--zj-muted-fg)]">
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--zj-muted-fg)]" />
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--zj-muted-fg)] [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--zj-muted-fg)] [animation-delay:300ms]" />
            正在思考…
          </div>
        )}

        {/* 流式光标 */}
        {status === 'streaming' && <span className="ml-10 inline-block h-4 w-1.5 animate-pulse bg-[var(--zj-accent)] align-text-bottom" />}

        {error && (
          <div className="flex items-start gap-2 rounded-[var(--zj-radius)] bg-[var(--zj-danger)]/10 px-3 py-2 text-xs text-[var(--zj-danger)]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">出错了</p>
              <p className="mt-0.5 break-words">{error.message}</p>
              {messages.length > 0 && (
                <Button variant="ghost" size="sm" className="mt-1 h-6 px-2 text-xs" onClick={() => void regenerate()}>
                  <RotateCcw className="size-3" />
                  重试
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送，Shift+Enter 换行
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder={
            backendNotReady ? '后端未就绪…' : '说点什么…（Enter 发送，Shift+Enter 换行）'
          }
          className="min-h-[64px] resize-none"
        />
        {busy ? (
          <Button variant="outline" size="icon" className="size-10 shrink-0" onClick={() => void stop()} title="停止生成">
            <Square className="size-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="size-10 shrink-0"
            onClick={() => send(input)}
            disabled={!input.trim() || backendNotReady}
            title="发送"
          >
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export type { ZjUIMessage };
/**
 * LangChain.js 编排层—— 把「本地推理 / 后端转发」两条路径统一成 LCEL 链。
 *
 * ## 为什么引入 LangChain
 *
 * 此前 `scheduler.ts` 只是一个 if/else：本地调localChat，后端调 backendChat。
 * 功能一多（多轮记忆、提示词模板、输出解析、失败降级、流式）就会迅速失控。
 * LangChain 的 LCEL（LangChain Expression Language）用声明式组合解决这点：
 * 每个环节是一个 Runnable，用 `|` 串起来即为一条链，天然支持流式与并行。
 *
 * ## 重要的包结构坑
 *
 * `@langchain/core@1.2.x` 的**主入口 `index` 是空壳**（dist 里是 `__exportAll({})`，
 * 运行时什么也导不出来），但子路径（`/runnables`、`/messages`、`/prompts` …）是完整的。
 * 所以本文件一律从**子路径**导入，绝不从 `'@langchain/core'` 主入口导入，
 * 否则构建能过、运行时却报「xxx is not a constructor」。
 *
 * 同时该包带 `"input": "./src/index.ts"` 条件，Node 直接执行时可能匹配到 TS 源码入口；
 * 浏览器构建走bundler 的默认条件解析，不受影响。
 */

import { RunnableLambda, type Runnable } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';

/** 与 scheduler / local-engine 共用的消息类型 */
export type ChainMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * 把项目内部的消息结构转为 LangChain 的 BaseMessage。
 *
 * 注意 role 的映射必须显式写全：`tool` 等角色在内部结构里不存在，
 * 漏掉会让 TS 认为 switch 已穷尽而实际漏分支。
 */
export function toLangChainMessages(
  messages: ChainMessage[],
): BaseMessage[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'system':
        return new SystemMessage(m.content);
      case 'assistant':
        return new AIMessage(m.content);
      default:
        return new HumanMessage(m.content);
    }
  });
}

/** LangChain BaseMessage 转回内部结构 */
export function fromLangChainMessages(
  messages: BaseMessage[],
): ChainMessage[] {
  return messages.map((m) => {
    const text =
      typeof m.content === 'string'
        ? m.content
        : // 多模态内容可能是结构化数组，退化为文本拼接
          m.content
            .map((part: unknown) =>
              typeof part === 'object' && part !== null && 'text' in part
                ? String((part as { text: unknown }).text)
                : '',
            )
            .join('');
    const cls = m.getType();
    return {
      role: cls === 'system' ? 'system' : cls === 'ai' ? 'assistant' : 'user',
      content: text,
    } as ChainMessage;
  });
}

/** 底层生成器的统一签名 —— 本地与后端各自实现 */
export type Generator = (
  messages: ChainMessage[],
) => Promise<string>;

/**
 * 提取 system 提示词，其余消息作为对话主体。
 *
 * 拆开的原因：多数下游（本地小模型尤其如此）对 system 指令的遵循度不稳定，
 * 单独拎出来拼接比混在消息数组里更可控。
 */
export function splitSystemPrompt(messages: ChainMessage[]): {
  system: string;
  rest: ChainMessage[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  return { system, rest: messages.filter((m) => m.role !== 'system') };
}

/**
 * 清洗模型输出。
 *
 * 小模型常在正文外多吐模板标记（`<|im_end|>`）或重复的开头，
 * 直接展示会很脏，因此在解析层统一收口 —— 这正是输出解析器的职责。
 */
export function cleanOutput(raw: string): string {
  return raw
    // ChatML / Qwen 系模板标记
    .replace(/<\|im_start\|>\s*\w+\s*/g, '')
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|endoftext\|>/g, '')
    .replace(/<\|endofprompt\|>/g, '')
    // Llama 系
    .replace(/\[INST\]|\[\/INST\]/g, '')
    .replace(/<\|start_header_id\|>[\s\S]*?<\|end_header_id\|>/g, '')
    // 模型自说自话地重复角色前缀
    .replace(/^\s*(assistant|system|user)\s*[:：]\s*/i, '')
    .replace(/\n\s*(assistant|system|user)\s*[:：]\s*$/i, '')
    .trim();
}

/**
 * 组装一条完整的 LCEL 链：
 *
 *   { messages }
 *     → 拆分 system 提示词
 *     → 调用底层生成器（本地 WebGPU/WASM 推理，或后端 API 转发）
 *     → 清洗输出
 *     → StringOutputParser
 *
 * @param generator 底层生成实现
 * @param systemSuffix 追加到 system 提示词末尾的约束（如群聊场景的身份设定）
 */
export function buildChatChain(
  generator: Generator,
  systemSuffix?: string,
): Runnable<ChainMessage[], string> {
  // 显式标注输入为 ChainMessage[]：RunnableLambda.from 的类型推导
  // 在不标注时会把入参当成单条消息，导致后续 pipe 的类型全部错位
  const invokeModel = RunnableLambda.from<ChainMessage[], string>(
    async (input: ChainMessage[]) => {
      const { system, rest } = splitSystemPrompt(input);
      const fullSystem = systemSuffix
        ? [system, systemSuffix].filter(Boolean).join('\n\n')
        : system;

      const payload: ChainMessage[] = fullSystem
        ? [{ role: 'system', content: fullSystem }, ...rest]
        : rest;

      const raw = await generator(payload);
      return cleanOutput(raw);
    },
  );

  // invokeModel 已返回 string，StringOutputParser 负责把
  // BaseMessage 等形态收敛为纯文本（此处输入已是 string，属幂等收口）
  return invokeModel.pipe(new StringOutputParser());
}

/**
 * 便捷入口：直接跑一次对话。
 *
 * 保留这个薄封装是为了让调用方不必关心链的组装细节，
 * 同时保留 chain 对象以便将来挂流式（`chain.stream()`）。
 */
export async function runChatChain(
  generator: Generator,
  messages: ChainMessage[],
  opts: { systemSuffix?: string } = {},
): Promise<string> {
  const chain = buildChatChain(generator, opts.systemSuffix);
  const result = await chain.invoke(messages);
  return typeof result === 'string' ? result : String(result);
}

/**
 * 会话记忆 —— 内存态多轮上下文。
 *
 * 用 LangChain 的 `InMemoryChatMessageHistory` 而非自建数组，
 * 好处是后续换成持久化记忆（Redis / 文件）时只需替换实现，调用方无感。
 * 当前仅保存最近 N 轮，避免小模型上下文窗口溢出导致质量骤降。
 */
export class ConversationMemory {
  private history: BaseMessage[] = [];
  private readonly maxTurns: number;

  constructor(maxTurns = 6) {
    this.maxTurns = maxTurns;
  }

  /** 追加一轮对话 */
  add(userContent: string, aiContent: string) {
    this.history.push(new HumanMessage(userContent));
    this.history.push(new AIMessage(aiContent));
    // 按「轮」裁剪：2 条消息 = 1 轮
    const maxMessages = this.maxTurns * 2;
    if (this.history.length > maxMessages) {
      this.history = this.history.slice(this.history.length - maxMessages);
    }
  }

  /** 取历史（不含 system） */
  messages(): ChainMessage[] {
    return fromLangChainMessages(this.history);
  }

  /** 历史轮数 */
  get turns(): number {
    return Math.floor(this.history.length / 2);
  }

  clear() {
    this.history = [];
  }

  /** 导出为内部消息结构，便于直接喂给链 */
  toChainMessages(): ChainMessage[] {
    return this.messages();
  }
}

/**
 * 带记忆的对话执行器。
 *
 * 流程：合并历史 → 调链 → 写入历史。
 * 群聊 AI 助手等需要连续上下文的场景直接用它。
 */
export async function chatWithMemory(
  memory: ConversationMemory,
  generator: Generator,
  userInput: string,
  opts: { systemSuffix?: string } = {},
): Promise<string> {
  const messages: ChainMessage[] = [
    ...memory.toChainMessages(),
    { role: 'user', content: userInput },
  ];
  const reply = await runChatChain(generator, messages, opts);
  memory.add(userInput, reply);
  return reply;
}
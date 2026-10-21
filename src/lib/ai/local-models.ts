/**
 * 本地模型清单 —— 供用户在设置中自行选择要下载哪个模型。
 *
 * 说明：
 * - 全部仓库均已通过 hf-mirror.com 国内镜像实测可达（config.json 与 onnx/model_q4.onnx 均返回 200）。
 * - 体积为 q4 量化权重的近似值，实际以 Hugging Face 仓库为准。
 * - 换用 Qwen 系列以外模型时，聊天模板可能不同，
 *   因此模板按「模型族」选择，见 local-engine.ts 的 resolveChatTemplate。
 */

/** 模型族 —— 决定使用哪套聊天模板 */
export type ModelFamily = 'qwen' | 'smol' | 'chatml';

export interface LocalModelOption {
  /** Hugging Face 仓库 id */
  id: string;
  /** 展示名称 */
  name: string;
  /** 参数量描述 */
  size: string;
  /** q4 量化权重近似体积 */
  approxSize: string;
  /** 简介 */
  desc: string;
  /** 聊天模板族 */
  family: ModelFamily;
  /** 推荐给新用户 */
  recommended?: boolean;
}

/** 默认模型 —— 体积小、中文能力够用 */
export const DEFAULT_LOCAL_MODEL = 'Xenova/Qwen1.5-0.5B-Chat';

/**
 * 可选模型清单。
 * 全部经 hf-mirror.com 实测可达，按体积从小到大排列。
 */
export const LOCAL_MODEL_OPTIONS: LocalModelOption[] = [
  {
    id: 'Xenova/Qwen1.5-0.5B-Chat',
    name: 'Qwen1.5 0.5B Chat',
    size: '0.5B',
    approxSize: '约 400 MB',
    desc: '阿里通义千问 1.5 代轻量版，中文表现均衡，最省流量与内存',
    family: 'qwen',
    recommended: true,
  },
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    name: 'SmolLM2 360M Instruct',
    size: '360M',
    approxSize: '约 290 MB',
    desc: '体积最小的推荐选项，适合低配设备与首次尝鲜',
    family: 'smol',
  },
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    name: 'Qwen3 0.6B',
    size: '0.6B',
    approxSize: '约 480 MB',
    desc: '通义千问 3 代轻量版，推理与代码能力优于 1.5 代',
    family: 'qwen',
  },
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    name: 'Qwen2.5 0.5B Instruct',
    size: '0.5B',
    approxSize: '约 400 MB',
    desc: '通义千问 2.5 代轻量版，指令遵循更稳定',
    family: 'qwen',
  },
  {
    id: 'onnx-community/Qwen2.5-1.5B-Instruct',
    name: 'Qwen2.5 1.5B Instruct',
    size: '1.5B',
    approxSize: '约 1 GB',
    desc: '同代中更大参数，写作与长文本质量更好，需较多内存',
    family: 'qwen',
  },
];

/** 按 id 查找模型项 */
export function findModelOption(id: string): LocalModelOption | undefined {
  return LOCAL_MODEL_OPTIONS.find((m) => m.id === id);
}

/** 推断模型所属模板族 —— 供自定义模型 id 使用 */
export function inferFamily(id: string): ModelFamily {
  const lower = id.toLowerCase();
  if (lower.includes('qwen')) return 'qwen';
  if (lower.includes('smol')) return 'smol';
  return 'chatml';
}

// ---------------------------------------------------------------------------
// 模型下载源
// ---------------------------------------------------------------------------

/** 模型源 id */
export type ModelSourceId = 'hf-mirror' | 'hf-official';

export interface ModelSourceOption {
  id: ModelSourceId;
  name: string;
  /** remoteHost 主机地址 */
  host: string;
  desc: string;
  /** 是否为国内镜像 */
  domestic: boolean;
}

/**
 * 可选模型源。
 * 国内镜像 hf-mirror.com 走 CDN 加速，无墙环境下速度更稳定；
 * 官方源作为兜底，万一镜像缺文件可切换。
 */
export const MODEL_SOURCES: ModelSourceOption[] = [
  {
    id: 'hf-mirror',
    name: 'HF 镜像（国内加速）',
    host: 'https://hf-mirror.com',
    desc: 'hf-mirror.com 国内镜像，下载更快更稳定，推荐使用',
    domestic: true,
  },
  {
    id: 'hf-official',
    name: 'HuggingFace 官方',
    host: 'https://huggingface.co',
    desc: '模型仓库的官方源，镜像缺文件时可切换到此源',
    domestic: false,
  },
];

/** 默认使用国内镜像 */
export const DEFAULT_MODEL_SOURCE: ModelSourceId = 'hf-mirror';

/** 按 id 查找模型源 */
export function findModelSource(id: string): ModelSourceOption {
  return (
    MODEL_SOURCES.find((s) => s.id === id) ??
    MODEL_SOURCES.find((s) => s.id === DEFAULT_MODEL_SOURCE)!
  );
}

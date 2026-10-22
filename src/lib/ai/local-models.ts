/**
 * 本地模型清单 —— 供用户在设置中自行选择要下载哪个模型。
 *
 * 说明：
 * - 全部仓库均已通过**阿里巴巴魔搭社区（ModelScope）** 实测可达
 *   （config.json 与 onnx/model_q4.onnx 均返回 200），且带 CORS 头可跨域加载。
 * - 体积为 q4 量化权重的近似值，实际以模型仓库为准。
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
  /**
   * q4 权重的实际字节数（用于判定能否走 WebGPU）。
   *
   * ⚠️ 必须是**实际值**而非估算 —— 下面这个阈值判断是精确的分界线：
   * GPU 的 `maxBufferSize` 是 2 GiB，而 ORT 的 WebGPU EP 会把整个权重
   * 分配成**单个** GPU buffer（不分块），所以权重 + 激活/工作区
   * 一旦越过 2 GiB 就会分配失败，表现为 wasm侧 abort（一个裸指针数字）。
   *
   * 实测（NVIDIA Lovelace / RTX 40 系，maxBufferSize = 2147483648）：
   *   onnx-community/Qwen2.5-0.5B-Instruct  q4 = 786156820 (749 MB) → ✅ 成功
   *   Xenova/Qwen1.5-0.5B-Chat             q4 = 832860847 (794 MB) → ✅ 成功
   *   onnx-community/Qwen2.5-1.5B-Instruct  q4 = 1787566590 (1.7 GB) → ❌ 失败
   *
   * 阈值取 1 GiB 是保守留余量：1 GiB 以内的模型在 WebGPU 上都验证过可用，
   * 超过则直接引导到 WASM，避免用户白等几分钟下载完才发现加载不了。
   */
  q4Bytes?: number;
  /**
   * 本模型实际使用的权重精度档。
   *
   * 绝大多数模型用 `q4`。但**大模型是个例外**：
   * Qwen2.5-1.5B 的 q4 权重是 1.78 GB，在 WASM 后端下装不下 ——
   * 实测（同一台机器、同一份代码）：
   *   q4f16 (1.22 GB) → ❌ Aborted()（wasm 后端缺 fp16 算子支持）
   *   uint8 (1.58 GB) → ✅ 319s 加载成功
   *   q4    (1.78 GB) → ❌ 裸数字（内存分配失败）
   *
   * 注意这个模型里 **uint8 反而比 q4 更小**（1.58 GB < 1.78 GB），
   * 因为它的 q4 是分块 int4 量化、带 fp32 scale，额外开销不小。
   *
   * 固定到模型级还有一个好处：**下载与加载用的是同一个文件**，
   * 不会出现「下了 q4、加载时却要 uint8」的白下载。
   */
  weightDtype?: 'q4' | 'uint8';
  /**
   * 权重文件在仓库里的路径 —— 必须与 `weightDtype` 对应。
   * 不写则默认 `onnx/model_q4.onnx`。
   */
  weightFile?: string;
  /** 简介 */
  desc: string;
  /** 聊天模板族 */
  family: ModelFamily;
  /** 推荐给新用户 */
  recommended?: boolean;
}

/**
 * WebGPU 可承载的 q4 权重上限（字节）。
 *
 * 依据：GPU `maxBufferSize` = 2 GiB，ORT WebGPU EP 单 buffer 分配整个权重，
 * 留一半余量给激活值、KV cache 与工作区。实测 794 MB 通过、1.7 GB 失败，
 * 故把红线设在 1 GiB —— 该线以内都验证过可用。
 */
export const WEBGPU_MAX_Q4_BYTES = 1024 * 1024 * 1024;

/**
 * 判断该模型能否走 WebGPU。
 *
 * 未知体积（q4Bytes 缺失）时返回 true —— 宁可试一把，
 * 因为多数模型都在阈值内；只有明确超限才提前拦下。
 *
 * 传入 undefined（模型不在清单里）同样按「不拦」处理。
 */
export function canUseWebGpu(m: LocalModelOption | undefined): boolean {
  if (!m || m.q4Bytes === undefined) return true;
  return m.q4Bytes <= WEBGPU_MAX_Q4_BYTES;
}

/** 默认模型 —— 体积小、中文能力够用 */
export const DEFAULT_LOCAL_MODEL = 'Xenova/Qwen1.5-0.5B-Chat';

/**
 * 可选模型清单。
 * 全部经阿里巴巴魔搭社区（ModelScope）实测可达，按体积从小到大排列。
 */
export const LOCAL_MODEL_OPTIONS: LocalModelOption[] = [
  {
    id: 'Xenova/Qwen1.5-0.5B-Chat',
    name: 'Qwen1.5 0.5B Chat',
    size: '0.5B',
    approxSize: '约 400 MB',
    q4Bytes: 832860847,
    desc: '阿里通义千问 1.5 代轻量版，中文表现均衡，最省流量与内存',
    family: 'qwen',
    recommended: true,
  },
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    name: 'SmolLM2 360M Instruct',
    size: '360M',
    approxSize: '约 290 MB',
    q4Bytes: 417375737,
    desc: '体积最小的推荐选项，适合低配设备与首次尝鲜',
    family: 'smol',
  },
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    name: 'Qwen3 0.6B',
    size: '0.6B',
    approxSize: '约 480 MB',
    q4Bytes: 919096585,
    desc: '通义千问 3 代轻量版，推理与代码能力优于 1.5 代',
    family: 'qwen',
  },
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    name: 'Qwen2.5 0.5B Instruct',
    size: '0.5B',
    approxSize: '约 400 MB',
    q4Bytes: 786156820,
    desc: '通义千问 2.5 代轻量版，指令遵循更稳定',
    family: 'qwen',
  },
  {
    id: 'onnx-community/Qwen2.5-1.5B-Instruct',
    name: 'Qwen2.5 1.5B Instruct',
    size: '1.5B',
    approxSize: '约 1.5 GB',
    q4Bytes: 1787566590,
    // ⚠️ 只能用 uint8：q4 权重 1.78 GB 在 WASM 后端下内存分配失败，
    // 而这个模型的 uint8（1.58 GB）反而比 q4 更小且能正常加载。
    // 详见 LocalModelOption.weightDtype 的实测记录。
    weightDtype: 'uint8',
    weightFile: 'onnx/model_uint8.onnx',
    desc: '同代中更大参数，写作与长文本质量更好，需较多内存；权重较大，仅支持 WASM 推理',
    family: 'qwen',
  },
];

/**
 * 取某个模型实际使用的权重精度。
 * 未声明时默认 `q4`。
 */
export function modelWeightDtype(m: LocalModelOption | undefined): 'q4' | 'uint8' {
  return m?.weightDtype ?? 'q4';
}

/**
 * 取某个模型实际使用的权重文件路径（仓库内相对路径）。
 * 未声明时默认 `onnx/model_q4.onnx`。
 */
export function modelWeightFile(m: LocalModelOption | undefined): string {
  return m?.weightFile ?? 'onnx/model_q4.onnx';
}

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
export type ModelSourceId = 'modelscope' | 'hf-official';

export interface ModelSourceOption {
  id: ModelSourceId;
  name: string;
  /** remoteHost 主机地址 */
  host: string;
  /** remotePathTemplate —— 仓库内文件路径模板 */
  pathTemplate: string;
  /** 默认分支（revision） */
  revision: string;
  desc: string;
  /** 是否为国内源 */
  domestic: boolean;
}

/**
 * 可选模型源。
 * 国内源为**阿里巴巴魔搭社区（ModelScope）** —— 国内访问稳定、速度快；
 * 官方 HuggingFace 作为兜底。
 */
export const MODEL_SOURCES: ModelSourceOption[] = [
  {
    id: 'modelscope',
    name: '魔搭社区（阿里，国内）',
    host: 'https://www.modelscope.cn/',
    pathTemplate: 'models/{model}/resolve/{revision}/',
    revision: 'master',
    desc: '阿里巴巴魔搭社区，国内访问更快更稳定，推荐使用',
    domestic: true,
  },
  {
    id: 'hf-official',
    name: 'HuggingFace 官方',
    host: 'https://huggingface.co/',
    pathTemplate: '{model}/resolve/{revision}/',
    revision: 'main',
    desc: '模型仓库的官方源，魔搭缺文件时可切换到此源',
    domestic: false,
  },
];

/** 默认使用国内源（阿里巴巴魔搭） */
export const DEFAULT_MODEL_SOURCE: ModelSourceId = 'modelscope';

/** 按 id 查找模型源 */
export function findModelSource(id: string): ModelSourceOption {
  return (
    MODEL_SOURCES.find((s) => s.id === id) ??
    MODEL_SOURCES.find((s) => s.id === DEFAULT_MODEL_SOURCE)!
  );
}

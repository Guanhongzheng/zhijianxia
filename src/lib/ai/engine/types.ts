/**
 * engine/types.ts —— 推理引擎的边界定义。
 *
 * ## 为什么要有这层
 *
 * 目前只有一个实现（Transformers.js + ONNX Runtime Web），抽接口看起来是
 * 提前抽象。但它的收益不在「现在」，而在**下一个引擎**：
 *
 * - 静态内存规划、OPFS 流式加载、KV cache 压缩、核融合、GGUF 量化档 ——
 *   这些能力全部属于引擎内部（见 `docs/AI-RUNTIME-ROADMAP.md`）。
 *   接到 WebLLM / wllama 上时，唯一不动宿主代码的办法就是这层接口。
 * - Worker 里那套「消息 id 对齐 / 进度回传 / 降级 / 互斥」的管道是有价值的
 *   公共资产，第二个引擎应该白拿，而不是复制一遍。
 *
 * ## 刻意保持最小
 *
 * 只有 `load / generate / unload` 三个动作 + 两个元信息字段。
 * 没有提前设计「可取消的流」「多模态」「工具调用」——
 * 那些等真有第二个实现时按需长出来，否则就是给自己造抽象税。
 */

/** 引擎标识。新增引擎时在这里加一项，并在 registry 里注册。 */
export type EngineId = 'transformers';

/** 权重格式 —— 决定该引擎能吃哪种模型清单 */
export type WeightFormat = 'onnx' | 'mlc' | 'gguf';

/** 一次运行尝试（设备 + 精度），由主线程算好阶梯传给引擎 */
export interface EngineRuntimeAttempt {
  device: 'webgpu' | 'wasm';
  dtype: string;
}

/** 加载参数 */
export interface EngineLoadParams {
  modelId: string;
  /** 运行时阶梯 —— 引擎依次尝试，失败自动降级 */
  runtimes: EngineRuntimeAttempt[];
  sourceId: 'modelscope' | 'hf-official';
  revision: string;
}

/** 生成参数 */
export interface EngineGenerateParams extends EngineLoadParams {
  prompt: string;
  maxTokens: number;
  temperature: number;
  doSample: boolean;
}

/** 进度回调：0–1 的比例 + 当前文件名 */
export type EngineProgress = (progress: number, file?: string) => void;

/**
 * 推理引擎。
 *
 * 约定：
 * - 所有方法都在 **Worker 线程**里被调用（引擎实现不应假设有 window）；
 * - `load` 可以重复调用，实现方负责复用/替换；
 * - `generate` 必须等 `load` 完成（宿主会保证顺序，实现方仍应自己兜底）。
 */
export interface InferenceEngine {
  readonly id: EngineId;
  /** 展示名（设置面板里给用户看） */
  readonly name: string;
  /** 该引擎接受的权重格式 */
  readonly weightFormat: WeightFormat;
  load(params: EngineLoadParams, onProgress?: EngineProgress): Promise<void>;
  /**
   * 生成文本，逐段回调增量。
   *
   * 第三个参数是**加载进度**：generate 可能在模型尚未加载时被调用
   * （用户直接发消息），此时实现方内部要先加载，进度仍应回传 ——
   * 否则界面会停在「准备中」没有任何进展。
   */
  generate(
    params: EngineGenerateParams,
    onToken: (text: string) => void,
    onProgress?: EngineProgress,
  ): Promise<void>;
  unload(): Promise<void>;
}

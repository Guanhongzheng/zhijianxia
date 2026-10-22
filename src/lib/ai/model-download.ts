/**
 * 模型下载状态 —— 区分「已下载」与「未下载」。
 *
 * 背景：设置面板此前把「下载模型」和「加载模型」混成一个按钮，
 * 用户点之前不知道权重到底在不在本地，白点一下可能重新下载几百 MB。
 * 这里通过模型缓存精确判断某个模型的权重是否已完整落盘。
 *
 * ## 原理
 *
 * 模型文件存在我们自己的分片缓存里（见 model-cache.ts），
 * 键是**完整的远端 URL**，外加一条元信息记录。
 * 因此判断「模型是否已下载」= 检查该模型必需的权重文件是否都在缓存里。
 * 只查「必要文件」而非「任意文件」，否则下载了一半的模型会被误判成已下载。
 */

import { LOCAL_MODEL_OPTIONS, modelWeightFile, type LocalModelOption } from './local-models';
import { listCachedFiles } from './model-cache';

/** Transformers.js 的浏览器缓存名 */
const CACHE_NAME = 'transformers-cache';

/**
 * 每个模型「下载完成」所必需的权重文件。
 *
 * 只列决定性文件：ONNX 权重 + 分词器 + 配置。
 * 少了任何一个都跑不起来，所以全部命中才算「已下载」。
 *
 * ⚠️ 权重文件名**随模型而变** —— 大模型在 WASM 下只能用 uint8，
 * 那个文件是 `onnx/model_uint8.onnx`，不是 `model_q4.onnx`。
 * 判定必须跟着模型走，否则会出现「显示已下载、加载时却要重新下」的情况。
 */
const TOKENIZER_FILES = ['tokenizer.json', 'tokenizer_config.json'];
const CONFIG_FILES = ['config.json', 'generation_config.json'];

/** 单个模型的下载状态 */
export interface ModelDownloadState {
  /** 模型 id */
  modelId: string;
  /** 是否已完整下载 */
  downloaded: boolean;
  /** 已缓存的文件数（用于展示进度细节） */
  cachedFiles: number;
  /** 必需文件总数 */
  totalFiles: number;
}

/** 缓存查询结果 —— 一次扫描，供所有模型共用 */
let cachedUrls: string[] | null = null;
let cacheScannedAt = 0;

/** 缓存的「新鲜期」：多久扫一次（毫秒） */
const CACHE_TTL = 3000;

/**
 * 扫描缓存，拿到所有已缓存文件的 URL。
 * 扫描本身有开销（Cache API 的 keys() 在大缓存上不便宜），
 * 因此做短 TTL 缓存，避免每帧都扫。
 */
async function getCachedUrls(): Promise<string[]> {
  if (cachedUrls !== null && Date.now() - cacheScannedAt < CACHE_TTL) return cachedUrls;
  try {
    cachedUrls = await listCachedFiles();
  } catch {
    // 缓存不可用（如无痕模式）—— 当作什么都没下载
    cachedUrls = [];
  }
  cacheScannedAt = Date.now();
  return cachedUrls;
}

/** 强制下次重新扫描缓存（下载/清缓存后调用） */
export function invalidateDownloadState(): void {
  cachedUrls = null;
  cacheScannedAt = 0;
}

/**
 * 判断某个模型是否已完整下载。
 *
 * 判定方式：把缓存里所有 URL 与该模型所需的文件名逐一比对。
 * 只要**任一**必需文件缺失，就认为未下载完成（部分下载不算）。
 */
export async function isModelDownloaded(
  model: LocalModelOption | string,
): Promise<ModelDownloadState> {
  const opt = typeof model === 'string' ? LOCAL_MODEL_OPTIONS.find((m) => m.id === model) : model;
  if (!opt) {
    return { modelId: String(model), downloaded: false, cachedFiles: 0, totalFiles: 0 };
  }

  const urls = await getCachedUrls();
  if (!urls.length) {
    return { modelId: opt.id, downloaded: false, cachedFiles: 0, totalFiles: 0 };
  }

  // 缓存键形如：
  //   https://www.modelscope.cn/models/<repo>/resolve/master/onnx/model_q4.onnx
  // 因此只要 URL 里含模型 id 且以目标文件名结尾，就算命中。
  const hasFile = (file: string) =>
    urls.some((k) => k.includes(`${opt.id}/`) && k.endsWith(`/${file}`));

  // 三组必需文件：权重（**按模型实际精度档**）、分词器、配置
  const metGroups = [
    hasFile(modelWeightFile(opt)),
    TOKENIZER_FILES.some(hasFile),
    CONFIG_FILES.some(hasFile),
  ].filter(Boolean).length;

  return {
    modelId: opt.id,
    downloaded: metGroups === 3,
    cachedFiles: metGroups,
    totalFiles: 3,
  };
}

/**
 * 批量查询所有模型的下载状态。
 * 只扫一次缓存，供设置面板渲染使用。
 */
export async function getAllDownloadStates(): Promise<Record<string, ModelDownloadState>> {
  const out: Record<string, ModelDownloadState> = {};
  await Promise.all(
    LOCAL_MODEL_OPTIONS.map(async (m) => {
      out[m.id] = await isModelDownloaded(m);
    }),
  );
  return out;
}

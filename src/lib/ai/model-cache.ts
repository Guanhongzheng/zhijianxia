/**
 * 模型文件缓存 —— 基于 Cache API 的**分片**存储。
 *
 * ## 为什么不用普通的 Cache API 直接存
 *
 * 实测（本机 Edge/Chrome，Chromium 内核）：
 *   单条目 8MB / 16MB / 32MB / 64MB / 100MB / 128MB / 200MB → ✅ 写入成功
 *   单条目 256MB / 417MB                                → ❌ 失败
 *       `Failed to execute 'put' on 'Cache': Unexpected internal error.`
 *   （总配额有 10GB，所以这是**单条目**上限，不是配额问题）
 *
 * Chrome 的 Cache API 有个单条目大小上限（约 256MB），而我们清单里的模型
 * q4 权重最小 417MB、最大 1.78GB —— **全都超过**。
 *
 * 这带来一个此前没人注意到的严重后果：Transformers.js 写缓存时是
 * `cache.put(...).catch(err => console.warn(...))` —— **写失败被静默吞掉**。
 * 于是：
 *   - 模型照样能加载（用的是内存里的 buffer），看起来一切正常；
 *   - 但缓存里**从来没有**权重文件；
 *   - 下次加载又要重新下载几百 MB～1.8 GB。
 * 这才是「每次点加载都重新下载」的真正根因（此前的清缓存逻辑只是帮凶）。
 *
 * ## 本模块的解法
 *
 * 1. 每个文件按 **64MB** 切成若干片，分别存进 Cache API —— 每片都远低于上限；
 * 2. 额外存一条「元信息」记录（分片数、总大小、content-type）；
 * 3. 对外暴露一个符合 Web Cache API 形状的 `match/put/delete/keys` 对象，
 *    通过 `env.useCustomCache` 交给 Transformers.js 使用 ——
 *    它会照常调用 `match` 拿文件、`put` 存文件，完全无需改动库本身。
 *
 * 读取时用 ReadableStream **逐片流式**取出，
 * 避免把 1.8GB 一次性读进内存（Transformers 最终仍会 arrayBuffer 一次，
 * 但至少不会「分片数组 + 合并结果」同时占两份）。
 */

/** 缓存名 —— 与 Transformers.js 默认一致，这样 `purgeModelCache` 也能一并清掉 */
const CACHE_NAME = 'transformers-cache';

/**
 * 分片 / 元信息在缓存里的 key 前缀。
 *
 * ⚠️ **必须用路径而不是 fragment（`#`）来区分！**
 *
 * Cache API 在存储与匹配时会**丢弃 URL 的 fragment**（见 Service Worker 规范：
 * put 时的 request URL 会去掉 fragment 再作为键）。
 * 于是 `#zj-chunk-0`、`#zj-chunk-1`、…、`#zj-meta` 全部塌缩成同一个键，
 * 后写入的元信息会覆盖掉分片 —— 表现为「下载显示成功，但加载时拿到的是
 * 损坏的数据」，而且还得重新下载一遍。
 *
 * 路径部分不会被丢弃，因此用独立路径区分：一个逻辑文件的分片与元信息
 * 各自占据不同的条目。
 */
const KEY_BASE = 'https://zj.local/__model_cache__/';

/**
 * 单个分片的大小。
 *
 * 64MB 远低于 Chrome 约 256MB 的单条目上限，留足余量
 * （不同浏览器/版本的上限可能不同，小一点更保险）。
 */
const CHUNK_SIZE = 64 * 1024 * 1024;

/** 存入元信息的内容 */
interface ChunkMeta {
  /** 分片数量 */
  chunks: number;
  /** 文件总字节数 */
  size: number;
  /** content-type */
  contentType: string;
  /** 写入时间戳 */
  ts: number;
}

/** 把 request（Request | string）归一成 URL 字符串 */
function toUrl(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  if (request instanceof URL) return request.toString();
  return request.url;
}

/** 逻辑 URL → 缓存内的条目 key */
function entryKey(url: string, suffix: string): string {
  return `${KEY_BASE}${encodeURIComponent(url)}${suffix}`;
}

/** 某个逻辑 URL 的分片 key */
function chunkKey(url: string, index: number): string {
  return entryKey(url, `/c${index}`);
}

/** 某个逻辑 URL 的元信息 key */
function metaKey(url: string): string {
  return entryKey(url, '/meta');
}

/** 从缓存条目 key 反推逻辑 URL */
function decodeEntryKey(entryUrl: string): string | null {
  if (!entryUrl.startsWith(KEY_BASE)) return null;
  const rest = entryUrl.slice(KEY_BASE.length);
  const slash = rest.lastIndexOf('/');
  if (slash <= 0) return null;
  try {
    return decodeURIComponent(rest.slice(0, slash));
  } catch {
    return null;
  }
}

/** 打开底层缓存 */
async function openCache(): Promise<Cache | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    return await window.caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * 供 Transformers.js 使用的自定义缓存。
 *
 * 形状与 Web Cache API 一致：`match` / `put` / `delete` / `keys`。
 */
export const modelCache = {
  /**
   * 取一个文件。
   * 命中则返回拼装好的 Response；未命中返回 undefined（与 Cache API 一致）。
   */
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const cache = await openCache();
    if (!cache) return undefined;
    const url = toUrl(request);

    const metaRes = await cache.match(metaKey(url));
    if (!metaRes) return undefined;

    let meta: ChunkMeta;
    try {
      meta = (await metaRes.json()) as ChunkMeta;
    } catch {
      return undefined;
    }
    if (!meta || !Number.isInteger(meta.chunks) || meta.chunks <= 0) return undefined;

    // 逐片流式读取 —— 避免一次性把整个文件读进内存
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index >= meta.chunks) {
          controller.close();
          return;
        }
        const part = await cache.match(chunkKey(url, index));
        index += 1;
        if (!part) {
          // 分片缺失 = 缓存不完整，视为未命中
          controller.error(new Error('模型缓存分片缺失'));
          return;
        }
        const buf = new Uint8Array(await part.arrayBuffer());
        controller.enqueue(buf);
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': meta.contentType || 'application/octet-stream',
        'content-length': String(meta.size),
      },
    });
  },

  /**
   * 存一个文件（自动分片）。
   */
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const cache = await openCache();
    if (!cache) throw new Error('浏览器缓存不可用');
    const url = toUrl(request);

    const buf = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    // 先删掉旧分片，避免残留导致「看起来已下载」但内容是旧的
    await modelCache.delete(url);

    const chunkCount = Math.max(1, Math.ceil(buf.byteLength / CHUNK_SIZE));
    for (let i = 0; i < chunkCount; i += 1) {
      const slice = buf.subarray(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buf.byteLength));
      // 每片单独 copy 一份 —— Response 构造后底层 buffer 可能被复用
      const copy = slice.slice();
      await cache.put(
        chunkKey(url, i),
        new Response(copy, { headers: { 'content-type': contentType } }),
      );
    }

    const meta: ChunkMeta = {
      chunks: chunkCount,
      size: buf.byteLength,
      contentType,
      ts: Date.now(),
    };
    await cache.put(
      metaKey(url),
      new Response(JSON.stringify(meta), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  },

  /** 删一个文件（含全部分片与元信息） */
  async delete(request: RequestInfo | URL): Promise<boolean> {
    const cache = await openCache();
    if (!cache) return false;
    const url = toUrl(request);

    const metaRes = await cache.match(metaKey(url));
    if (!metaRes) return false;
    let meta: ChunkMeta | undefined;
    try {
      meta = (await metaRes.json()) as ChunkMeta;
    } catch {
      meta = undefined;
    }
    if (meta) {
      for (let i = 0; i < meta.chunks; i += 1) {
        await cache.delete(chunkKey(url, i));
      }
    }
    await cache.delete(metaKey(url));
    return true;
  },

  /** 列出所有**逻辑**文件（只列元信息，不列分片） */
  async keys(): Promise<string[]> {
    const cache = await openCache();
    if (!cache) return [];
    const all = await cache.keys();
    const out: string[] = [];
    for (const r of all) {
      const url = r.url;
      if (!url.startsWith(KEY_BASE) || !url.endsWith('/meta')) continue;
      const logical = decodeEntryKey(url);
      if (logical) out.push(logical);
    }
    return out;
  },
};

/**
 * 查询某个文件是否已完整缓存。
 * 走 `match` 的元信息判断，不读正文，开销很小。
 */
export async function isFileCached(url: string): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  return (await cache.match(metaKey(url))) !== undefined;
}

/** 列出已缓存的所有逻辑文件 URL */
export async function listCachedFiles(): Promise<string[]> {
  return modelCache.keys();
}

/** 删除所有模型缓存（用于「清缓存」） */
export async function clearModelCache(): Promise<number> {
  const cache = await openCache();
  if (!cache) return 0;
  const urls = await modelCache.keys();
  for (const u of urls) await modelCache.delete(u);
  // 兜底：清掉可能残留的孤儿分片
  const all = await cache.keys();
  for (const r of all) {
    if (r.url.startsWith(KEY_BASE)) {
      await cache.delete(r);
    }
  }
  // 顺带清掉**旧版**直接以远端 URL 为键的条目 ——
  // 那是分片缓存上线前的写法，权重因单条目超限从未写成功过，
  // 但小文件（config/tokenizer）确实存进去了，留着只会占地方。
  for (const r of all) {
    if (!r.url.startsWith(KEY_BASE) && /modelscope\.cn|huggingface\.co/.test(r.url)) {
      await cache.delete(r);
    }
  }
  return urls.length;
}

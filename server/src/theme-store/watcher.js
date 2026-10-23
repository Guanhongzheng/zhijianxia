'use strict';

/**
 * theme-store/watcher.js —— 监听主题目录，增量更新并广播变更事件
 *
 * ## 为什么既有扫描器又有监听
 *
 * - **扫描器**（scanner.js）：全量视图，用于启动时的初始同步，
 *   以及「目录被整体替换」这类批量变更的兜底。
 * - **监听器**（本文件）：增量视图，保证「放一个文件夹 → 数秒内广场出现」
 *   而无需重启或等 30 秒缓存过期。
 *
 * 两者都写同一份数据（内存中的扫描结果），幂等。
 *
 * ## 事件为什么要走 WebSocket
 *
 * 主题广场是「数据即文件」的目录 —— 用户直接把文件夹丢进 themes/ 就会生效。
 * 但浏览器里的列表不会自己刷新，所以需要服务端把变更推给前端。
 */

const path = require('node:path');
const fs = require('node:fs');
const chokidar = require('chokidar');

const {
  scanThemes,
  invalidateThemesCache,
  themesRoot,
  isValidSlug,
} = require('./scanner');

/** 防抖：文件系统事件常常成簇触发（一次复制可能报十几次） */
const DEBOUNCE_MS = 300;

/** 周期性对账间隔（兜底） */
const RESYNC_INTERVAL_MS = Number(process.env.RESYNC_INTERVAL_MS || 15_000);

/**
 * 增量更新单个主题：重新扫描该目录，判断是新增 / 变更 / 移除。
 *
 * @param {string} slug 主题 slug
 * @param {boolean} dirGone 目录**已被删除**（chokidar 的 unlinkDir 事件）。
 *   此时目录里的文件已经不在了，扫描器会因「主题校验不通过」跳过它，
 *   永远判不出 removed —— 所以必须显式走删除分支。
 * @param {Set<string>} known 当前已知的主题 slug 集合（会被就地更新）
 * @returns {Promise<'added'|'changed'|'removed'|null>}
 */
async function refreshOne(slug, dirGone, known) {
  if (!isValidSlug(slug)) return null;

  // ⚠️ 必须**先**失效缓存再扫描 —— scanThemes() 有 30 秒的模块级缓存，
  // 若先扫描后失效，扫到的永远是旧快照（新主题根本不在里面），
  // 事件就永远不会发出去。
  invalidateThemesCache();

  const existed = known.has(slug);

  // 目录已被删除：直接判 removed，不看扫描结果
  if (dirGone) {
    known.delete(slug);
    return existed ? 'removed' : null;
  }

  // ⚠️ 判定删除要以**文件系统**为准，而不是以扫描结果为准。
  //
  // 删除目录时 chokidar 会先发文件级的 unlink、后发 unlinkDir。
  // 若 unlink 先到且防抖窗口内没等到 unlinkDir，扫描会看到
  // 「目录还在但 theme.json 没了」→ 判成 changed（误报），
  // 而正确结论是 removed。
  //
  // 判据：theme.json 没了 **且** 目录里没剩别的文件 → 主题被删除。
  // 若还剩别的文件（比如用户正在改写 theme.json，写到一半），
  // 那是「变更」而不是「删除」—— 交给扫描器判定，避免误报 removed。
  const themeDir = path.join(themesRoot(), slug);
  let manifestExists = false;
  let leftovers = 0;
  try {
    manifestExists = (await fs.promises.stat(path.join(themeDir, 'theme.json'))).isFile();
    const entries = await fs.promises.readdir(themeDir, { withFileTypes: true });
    leftovers = entries.filter((e) => e.isFile() && e.name !== 'theme.json').length;
  } catch {
    manifestExists = false;
    leftovers = 0;
  }
  if (!manifestExists && leftovers === 0) {
    known.delete(slug);
    return existed ? 'removed' : null;
  }

  const items = await scanThemes();
  const meta = items.find((i) => i.slug === slug);

  if (meta) {
    known.add(slug);
    return existed ? 'changed' : 'added';
  }
  // 目录还在但主题不合法（theme.json 缺失 / 校验不过）→ 视为被移除
  if (existed) {
    known.delete(slug);
    return 'removed';
  }
  return null;
}

/**
 * 启动监听。
 *
 * @param {object} options
 * @param {(payload: {type: string, slug: string}) => void} options.broadcast
 *        广播函数（通常是 WS hub 的 broadcast）
 * @param {Set<string>} [options.known] 已存在的主题 slug 集合。
 *        必须传入 —— 否则启动后的第一次对账会把所有主题当成「新增」重发一遍。
 * @returns {() => Promise<void>} 停止监听的函数
 */
function startWatcher(options) {
  const { broadcast } = options;
  const root = themesRoot();

  console.log(`[themes] 开始监听主题目录：${root}`);

  // 忽略点文件与临时文件，避免编辑器保存时刷屏
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
    ignored: (p) => {
      const base = path.basename(p);
      return base.startsWith('.') || base === 'node_modules';
    },
  });

  /** 每个 slug 的防抖定时器 */
  const timers = new Map();
  const pending = new Set();
  /** 已知目录被删除的 slug —— 这些要显式走 removed 分支 */
  const dirGone = new Set();
  /**
   * 当前已知的主题 slug（用于判断 added / changed / removed）。
   *
   * ⚠️ 必须是**共享引用** —— 启动时的 initialSync 会往里填初始状态。
   * 若各建各的，watcher 里的 known 是空集，
   * 启动后第一次对账会把所有主题当成「新增」重发一遍。
   */
  const known = options.known ?? new Set();

  const schedule = (slug, gone = false) => {
    if (gone) dirGone.add(slug);
    pending.add(slug);
    const existing = timers.get(slug);
    if (existing) clearTimeout(existing);
    timers.set(
      slug,
      setTimeout(() => {
        timers.delete(slug);
        void flush();
      }, DEBOUNCE_MS),
    );
  };

  /**
   * 待确认的「变更」事件。
   *
   * ⚠️ 为什么 changed 要延迟确认？
   *
   * 删除目录时，chokidar 的文件级 unlink 可能**早于**目录级 unlinkDir 到达。
   * 那时目录里的文件已被删掉一部分，但 theme.json 可能还在 ——
   * 扫出来「主题还合法」，于是判成 changed。
   * 可实际上这个主题马上就要被删除，changed 是一次**误报**。
   *
   * 误报的实际代价：前端收到 changed → 重新拉取该主题 → 发现 404 →
   * 移除。功能上没错，但白跑一次请求，而且事件序列看起来很脏
   * （changed 紧跟着 removed）。
   *
   * 所以 changed 进待确认队列，等一个对账周期：
   * - 若这期间主题消失了 → 不发 changed（removed 会覆盖它）；
   * - 若还在 → 确认是真正的内容变更，这时才广播。
   */
  const changedPending = new Map();

  const flush = async () => {
    const slugs = [...pending];
    pending.clear();
    for (const slug of slugs) {
      try {
        const type = await refreshOne(slug, dirGone.has(slug), known);
        dirGone.delete(slug);
        if (type === 'changed') {
          // 延迟确认，不立即广播
          changedPending.set(slug, Date.now());
          continue;
        }
        if (type) {
          changedPending.delete(slug);
          broadcast({ type, slug });
          console.log(`[themes] ${type} → ${slug}`);
        }
      } catch (err) {
        console.error(`[themes] 处理 ${slug} 变更出错：${err.message}`);
      }
    }
  };

  // 新增目录
  watcher.on('addDir', (dirPath) => {
    const slug = path.basename(dirPath);
    if (path.dirname(dirPath) !== root) return; // 只关心直接子目录
    schedule(slug);
  });

  // 删除目录
  //
  // ⚠️ 这里**不走防抖队列**，而是立即判定并广播 ——
  // unlinkDir 是「目录整个没了」最权威的信号。
  //
  // 若也排队，会出现两种问题：
  // 1. 删除过程中文件级的 unlink 先 flush，误判成 changed；
  // 2. removed 事件被延迟到防抖窗口之后。
  //
  // 所以这里直接处理，并**取消**该 slug 待处理的文件级事件 ——
  // 否则队列里残留的 unlink 会在稍后再触发一次 changed。
  watcher.on('unlinkDir', (dirPath) => {
    const slug = path.basename(dirPath);
    if (path.dirname(dirPath) !== root) return;

    // 取消待处理的文件级事件
    pending.delete(slug);
    const timer = timers.get(slug);
    if (timer) {
      clearTimeout(timer);
      timers.delete(slug);
    }
    dirGone.add(slug);

    void (async () => {
      try {
        const type = await refreshOne(slug, true, known);
        dirGone.delete(slug);
        // 主题被删 → 撤掉待确认的 changed（它本会是一次误报）
        changedPending.delete(slug);
        if (type) {
          broadcast({ type, slug });
          console.log(`[themes] ${type} → ${slug}  [unlinkDir]`);
        }
      } catch (err) {
        console.error(`[themes] 处理 ${slug} 删除出错：${err.message}`);
      }
    })();
  });

  // 目录内文件变化（theme.json 改了、封面换了）
  const onFileEvent = (filePath, eventKind) => {
    const dir = path.dirname(filePath);
    if (path.dirname(dir) !== root) return;
    const slug = path.basename(dir);
    const name = path.basename(filePath);

    // ⚠️ 删除目录时，文件级的 unlink 可能**早于** unlinkDir 到达。
    // 那时主题已经不可用，若照常排队，扫描会判成 changed ——
    // 一次无意义的事件，还会让前端多刷一次。
    //
    // 两道判据：
    // 1. manifest 被删 → 主题已失效，直接交给 unlinkDir；
    // 2. 目录已空 → 同上。
    if (eventKind === 'unlink' && name === 'theme.json') return;
    try {
      const remaining = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
      if (remaining.length === 0) return; // 目录已空 → 交给 unlinkDir
    } catch {
      return; // 目录已经没了 → 交给 unlinkDir
    }

    schedule(slug);
  };
  watcher.on('add', (p) => onFileEvent(p, 'add'));
  watcher.on('change', (p) => onFileEvent(p, 'change'));
  watcher.on('unlink', (p) => onFileEvent(p, 'unlink'));

  watcher.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[themes] 监听出错：${message}`);
    // ⚠️ Windows 上删除被监听目录时可能报 EPERM。
    // chokidar 本身会恢复，但事件可能丢 —— 下面的周期性对账是兜底。
  });

  /* ---------------------------------------------------------------------- */
  /* 周期性对账（兜底）                                                     */
  /* ---------------------------------------------------------------------- */
  //
  // 文件系统事件**不保证送达**：Windows 的 EPERM、网络盘的丢事件、
  // 容器挂载卷的合并事件，都会让某个变更静默丢失。
  //
  // 所以定期把「磁盘上的实际状态」与「已知状态」对一次账，
  // 差异部分补发事件。这让「放一个文件夹 → 广场出现」最终一定成立，
  // 只是延迟从「秒级」变成「最多一个对账周期」。

  const resyncTimer = setInterval(() => {
    void (async () => {
      try {
        invalidateThemesCache();
        const onDisk = await scanThemes();
        const onDiskSlugs = new Set(onDisk.map((i) => i.slug));

        for (const slug of onDiskSlugs) {
          if (!known.has(slug)) {
            known.add(slug);
            changedPending.delete(slug);
            broadcast({ type: 'added', slug });
            console.log(`[themes] 对账补发 added → ${slug}`);
          }
        }
        for (const slug of [...known]) {
          if (!onDiskSlugs.has(slug)) {
            known.delete(slug);
            // 主题没了 → 撤掉待确认的 changed（它本会是一次误报）
            changedPending.delete(slug);
            broadcast({ type: 'removed', slug });
            console.log(`[themes] 对账补发 removed → ${slug}`);
          }
        }

        // ---- 确认待定的 changed ----
        // 主题仍存在于磁盘 → 说明是真的内容变更，这时才广播。
        for (const [slug, at] of [...changedPending]) {
          if (Date.now() - at < RESYNC_INTERVAL_MS) continue; // 还没到确认时点
          changedPending.delete(slug);
          if (!onDiskSlugs.has(slug)) continue; // 已被删除 → 不发
          broadcast({ type: 'changed', slug });
          console.log(`[themes] 确认 changed → ${slug}`);
        }
      } catch (err) {
        console.error(`[themes] 对账出错：${err.message}`);
      }
    })();
  }, RESYNC_INTERVAL_MS);
  resyncTimer.unref();

  return async () => {
    clearInterval(resyncTimer);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    await watcher.close();
  };
}

/**
 * 启动时的全量同步：扫描 → 记录已知状态。
 *
 * ⚠️ 这里**不广播**任何事件 ——
 * 启动时的这些主题对前端来说是「本来就存在的」，
 * 广播 added 会让刚打开页面的前端把它们当新增重复处理。
 * 前端首次加载本来就是靠 GET /api/themes 拉全量，不需要事件。
 *
 * @returns {Promise<Set<string>>} 已知的主题 slug 集合
 */
async function initialSync() {
  const items = await scanThemes();
  invalidateThemesCache();
  const known = new Set(items.map((i) => i.slug));
  console.log(`[themes] 初始同步完成：共 ${items.length} 个主题`);
  return known;
}

module.exports = { startWatcher, initialSync, RE_SYNC_INTERVAL_MS: RESYNC_INTERVAL_MS };

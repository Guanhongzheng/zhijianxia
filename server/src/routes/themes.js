'use strict';

/**
 * routes/themes.js —— 主题广场的 REST 接口
 *
 * ## 与 registry 的分工
 *
 * - `/api/registry/themes*`：**管理**通道（登录态）。上传、删除、列出仓库里的主题包。
 * - `/api/themes*`：**浏览**通道（公开）。读主题目录、拿封面与预览图、下载与导出。
 *
 * 两者的数据同源 —— 都来自 `server/packages/themes/` 目录，
 * 只是 `/api/themes` 额外提供了封面 / 预览图 / 打包下载这些"给人看"的资源。
 *
 * ## 安全约束（三道闸，任何一道不过都返回 400）
 *
 * 1. **白名单正则**：slug 匹配 ^[a-zA-Z0-9_-]+$；文件名不允许含 / \ ..；
 * 2. **safeJoin**：path.resolve 后断言仍在该主题目录内（见 theme-store/scanner.js）；
 * 3. **流式返回**：图片与压缩包一律用流，绝不 fs.readFile 整读进内存。
 */

const express = require('express');
const { createReadStream, promises: fs } = require('node:fs');
const path = require('node:path');

const archiver = require('archiver');

const { requireAuth, requireAdmin } = require('../auth');
const {
  safeJoin,
  isValidSlug,
  isValidFileName,
  scanThemes,
  themesRoot,
} = require('../theme-store/scanner');
const { readThemeFolder, folderToThemePackage } = require('../theme-store/export');

const router = express.Router();

/**
 * 解析主题的壁纸文件名。
 *
 * theme.json 里的 `wallpaper` 字段声明了壁纸的相对路径，
 * 但**声明的扩展名可能与磁盘上的实际文件不一致** ——
 * 例如把 wallpaper.png 转成体积更小的 wallpaper.webp 后忘了改声明。
 * 这时直接取 basename 会 404，导出的 .theme 里也会带上坏链接。
 *
 * 所以这里做两级回退：
 * 1. 声明的文件名存在 → 直接用；
 * 2. 不存在 → 到 assets/ 下按「webp → jpg → png」找第一张图片。
 *
 * @param {string} themeDir 主题目录绝对路径
 * @param {string|undefined} declared theme.json 里声明的 wallpaper 相对路径
 * @returns {Promise<string|null>} assets/ 下的文件名（不含目录）
 */
async function resolveWallpaperFile(themeDir, declared) {
  if (declared) {
    const name = path.basename(declared);
    // 声明的路径可能带子目录（assets/xxx.png），也可能是纯文件名
    const candidates = [name, path.basename(declared)];
    for (const c of candidates) {
      if (!c) continue;
      try {
        const st = await fs.stat(path.join(themeDir, 'assets', c));
        if (st.isFile()) return c;
      } catch {
        /* 继续找 */
      }
    }
  }
  // 回退：assets/ 下按 webp → jpg → png 找第一张图
  try {
    const entries = await fs.readdir(path.join(themeDir, 'assets'), { withFileTypes: true });
    const images = entries
      .filter((e) => e.isFile() && ['.webp', '.jpg', '.jpeg', '.png'].includes(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort();
    return images[0] ?? null;
  } catch {
    return null;
  }
}

/** 扩展名 → Content-Type */
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function contentTypeFor(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 允许跨源嵌入图片的响应头。
 *
 * 前端启用了跨域隔离（COEP: require-corp，用于 WebGPU / 多线程 WASM），
 * 跨源资源必须显式允许嵌入，否则浏览器会直接拦截图片 ——
 * 表现为 `ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`。
 */
function setImageHeaders(res) {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
}

/** 元信息 → 列表项 */
function toListItem(meta) {
  return {
    slug: meta.slug,
    name: meta.name,
    author: meta.author,
    description: meta.description,
    protocol: meta.protocol === 2 ? 'v2' : 'v1',
    version: meta.version,
    category: meta.category,
    tags: meta.tags,
    coverUrl: meta.coverFile ? `/api/themes/${meta.slug}/cover` : '',
    fileSize: meta.fileSize,
    updatedAt: meta.updatedAt,
  };
}

/* ==========================================================================
 * 穿越守卫：把「攻击性路径」统一拦成 400
 * ========================================================================== */

/**
 * Express 4 会在路由匹配**之前**规范化路径：
 * - `/api/themes/..%2F..%2Fetc/passwd` 解码后变成多段路径 → 匹配不到路由 → 404；
 * - `/api/themes/x/previews/..` 被规范化掉尾段 → 反而匹配到了别的路由。
 *
 * 两种情况都不该发生：规格要求穿越类请求一律 400（明确告知「参数非法」，
 * 而不是含糊的 404，更不能悄悄命中别的路由）。
 *
 * 这里在**原始 URL**（未解码、未规范化）上做检测：
 * 出现编码过的路径分隔符或 `..` 段，一律 400。
 *
 * ⚠️ 关键：Express 4 的 req.originalUrl 保留原始编码形态，
 * 但 req.path / req.url 已被规范化 —— 所以必须用 originalUrl。
 */
router.use('/api/themes', (req, res, next) => {
  const raw = req.originalUrl;
  // 编码过的路径分隔符 / 点号
  if (/%2e|%2f|%5c/i.test(raw)) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }
  // 路径里出现 `..` 段（含解码后的形态）
  const decoded = decodeURIComponent(raw.split('?')[0] ?? '');
  if (/(^|\/)\.\.(\/|$)/.test(decoded)) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }
  // 双编码：%252F 解码一次是 %2F，再解一次才是 /。
  // 某些中间层会多解一层，所以这里也判非法 —— 宁可误伤也不能放过。
  if (/%25(2e|2f|5c)/i.test(raw)) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }
  next();
});

/* ==========================================================================
 * 列表与详情
 * ========================================================================== */

/**
 * GET /api/themes —— 主题列表
 *
 * 查询参数：
 * - q          模糊匹配 name / author / description / tags（不区分大小写）
 * - protocol  v1 | v2 | all
 * - sort       newest（按 mtime 倒序） | name（按名称升序）
 * - page       页码，从 1 开始
 * - limit      每页条数，默认 24，最大 100
 */
router.get('/api/themes', async (req, res) => {
  const { q, protocol, sort, page, limit } = req.query;

  let items = await scanThemes();

  // ---- 关键词过滤 ----
  const kw = typeof q === 'string' ? q.trim().toLowerCase() : '';
  if (kw) {
    items = items.filter((t) => {
      const hay = [t.name, t.author, t.description, ...t.tags]
        .join(' ')
        .toLowerCase();
      return hay.includes(kw);
    });
  }

  // ---- 协议过滤 ----
  const wantProtocol = typeof protocol === 'string' ? protocol.toLowerCase() : 'all';
  if (wantProtocol !== 'all' && wantProtocol) {
    items = items.filter((t) => `v${t.protocol}` === wantProtocol);
  }

  // ---- 排序 ----
  const sortBy = typeof sort === 'string' ? sort.toLowerCase() : 'newest';
  if (sortBy === 'name') {
    items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } else {
    items.sort((a, b) => b.updatedAt - a.updatedAt || a.slug.localeCompare(b.slug));
  }

  // ---- 分页 ----
  const total = items.length;
  const perPage = Math.min(Math.max(Number(limit) || 24, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const start = (current - 1) * perPage;
  const paged = items.slice(start, start + perPage);

  res.json({
    items: paged.map(toListItem),
    total,
    page: current,
  });
});

/**
 * GET /api/themes/:slug —— 主题详情
 */
router.get('/api/themes/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: '非法的 slug' });
    return;
  }

  const items = await scanThemes();
  const meta = items.find((t) => t.slug === slug);
  if (!meta) {
    res.status(404).json({ error: `主题「${slug}」不存在` });
    return;
  }

  res.json({
    ...toListItem(meta),
    previews: meta.previews.map((f) => `/api/themes/${slug}/previews/${f}`),
  });
});

/* ==========================================================================
 * 图片流
 * ========================================================================== */

/**
 * GET /api/themes/:slug/cover —— 封面图
 */
router.get('/api/themes/:slug/cover', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: '非法的 slug' });
    return;
  }

  const items = await scanThemes();
  const meta = items.find((t) => t.slug === slug);
  if (!meta) {
    res.status(404).json({ error: `主题「${slug}」不存在` });
    return;
  }
  if (!meta.coverFile) {
    res.status(404).json({ error: '该主题没有封面图' });
    return;
  }

  // 封面文件名来自扫描结果，仍需再过一遍白名单（防库里被塞进坏值）
  if (!isValidFileName(meta.coverFile)) {
    res.status(400).json({ error: '非法的封面文件名' });
    return;
  }

  const file = safeJoin(slug, meta.coverFile);
  if (!file) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }

  try {
    const st = await fs.stat(file);
    if (!st.isFile()) {
      res.status(404).json({ error: '封面文件不存在' });
      return;
    }
    res.setHeader('Content-Type', contentTypeFor(file));
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Cache-Control', 'public, max-age=300');
    setImageHeaders(res);
    // 流式返回，不整读
    createReadStream(file).pipe(res);
  } catch {
    res.status(404).json({ error: '封面文件不存在' });
  }
});

/**
 * GET /api/themes/:slug/previews/:file —— 预览图
 *
 * ⚠️ 路径段是 `previews`（复数），与磁盘上的目录名一致 ——
 * 写成单数 `preview` 会导致路由能匹配、但文件找不到（404）。
 */
router.get('/api/themes/:slug/previews/:file', async (req, res) => {
  const { slug, file } = req.params;
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: '非法的 slug' });
    return;
  }
  if (!isValidFileName(file)) {
    res.status(400).json({ error: '非法的文件名' });
    return;
  }

  const full = safeJoin(slug, 'previews', file);
  if (!full) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }

  try {
    const st = await fs.stat(full);
    if (!st.isFile()) {
      res.status(404).json({ error: '预览图不存在' });
      return;
    }
    res.setHeader('Content-Type', contentTypeFor(full));
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Cache-Control', 'public, max-age=300');
    setImageHeaders(res);
    createReadStream(full).pipe(res);
  } catch {
    res.status(404).json({ error: '预览图不存在' });
  }
});

/**
 * GET /api/themes/:slug/wallpaper/:file —— 主题资源（壁纸等）
 *
 * 存在的意义：导出的 .theme 里，wallpaper 必须是一个**绝对 URL** ——
 * 因为智简匣（另一个端口）拿到 .theme 后会自己去取这张图。
 * 相对路径在跨端口场景下是取不到的。
 */
router.get('/api/themes/:slug/wallpaper/:file', async (req, res) => {
  const { slug, file } = req.params;
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: '非法的 slug' });
    return;
  }
  if (!isValidFileName(file)) {
    res.status(400).json({ error: '非法的文件名' });
    return;
  }

  const full = safeJoin(slug, 'assets', file);
  if (!full) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }

  try {
    const st = await fs.stat(full);
    if (!st.isFile()) {
      res.status(404).json({ error: '资源不存在' });
      return;
    }
    res.setHeader('Content-Type', contentTypeFor(full));
    res.setHeader('Content-Length', String(st.size));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    setImageHeaders(res);
    createReadStream(full).pipe(res);
  } catch {
    res.status(404).json({ error: '资源不存在' });
  }
});

/* ==========================================================================
 * 下载
 * ========================================================================== */

/**
 * GET /api/themes/:slug/theme-file —— 导出 .theme 单文件
 *
 * 用户路径：广场下载 .theme → 智简匣「设置 · 个性化 → 导入本地主题」→ 应用。
 *
 * 与 /download 的分工：
 * - /download   → 整个主题文件夹的 zip（含壁纸、预览图），适合分发与备份；
 * - /theme-file → 单个 .theme 文件，可直接被智简匣导入。
 */
router.get('/api/themes/:slug/theme-file', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: '非法的 slug' });
    return;
  }

  const dir = safeJoin(slug);
  if (!dir) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }

  const parsed = await readThemeFolder(dir);
  if (!parsed) {
    res.status(404).json({ error: `主题「${slug}」不存在或格式不正确` });
    return;
  }

  // 壁纸的绝对 URL —— 从请求的 Host 推导，
  // 这样局域网其它设备访问时也能取到（不能用固定的 127.0.0.1）
  const wallpaperFile = await resolveWallpaperFile(dir, parsed.theme.wallpaper);
  const host = req.get('host') ?? `127.0.0.1:${process.env.PORT ?? 8787}`;
  const proto = (req.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  const wallpaperUrl = wallpaperFile
    ? `${proto}://${host}/api/themes/${encodeURIComponent(slug)}/wallpaper/${encodeURIComponent(wallpaperFile)}`
    : undefined;

  const pkg = folderToThemePackage(parsed.theme, parsed.css, { wallpaperUrl });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.theme"`);
  res.send(`${JSON.stringify(pkg, null, 2)}\n`);
});

/**
 * GET /api/themes/:slug/download —— 打包下载整个主题文件夹
 */
router.get('/api/themes/:slug/download', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: '非法的 slug' });
    return;
  }

  const dir = safeJoin(slug);
  if (!dir) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }

  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) {
      res.status(404).json({ error: `主题「${slug}」不存在` });
      return;
    }
  } catch {
    res.status(404).json({ error: `主题「${slug}」不存在` });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('warning', (err) => {
    console.warn(`[themes] 打包 ${slug} 时的警告：${err.message}`);
  });
  archive.on('error', (err) => {
    console.error(`[themes] 打包 ${slug} 出错：${err.message}`);
    res.destroy(err);
  });

  archive.pipe(res);

  // 排除点文件（编辑器临时文件、.DS_Store 等）
  archive.glob('**/*', {
    cwd: dir,
    dot: false,
    ignore: ['**/.*', '**/node_modules/**'],
  });

  await archive.finalize();
});

/**
 * DELETE /api/themes/:slug —— 删除主题（管理员）
 *
 * 浏览通道也提供删除 —— 因为仓库里的主题是**文件夹制**，
 * 而 registry 的删除端点只处理 .theme 单文件，管不到文件夹。
 *
 * ⚠️ 浏览是公开的，但**删除是管理操作**，必须鉴权 + 管理员。
 * 主题目录是「数据即文件」，删除即删目录 ——
 * 监听器会自动把 removed 事件推给广场前端。
 */
router.delete('/api/themes/:slug', requireAuth, requireAdmin, async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: '非法的 slug' });
    return;
  }

  const dir = safeJoin(slug);
  if (!dir) {
    res.status(400).json({ error: '非法的路径' });
    return;
  }

  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) {
      res.status(404).json({ error: `主题「${slug}」不存在` });
      return;
    }
    // 递归删除整个主题目录（含壁纸、预览图）
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    res.status(404).json({ error: `主题「${slug}」不存在` });
    return;
  }

  res.json({ ok: true });
});

/** 供其它模块复用：主题根目录 */
module.exports = router;
module.exports.themesRoot = themesRoot;
module.exports.toListItem = toListItem;

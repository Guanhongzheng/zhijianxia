'use strict';

/**
 * routes/registry.js —— 插件包与主题包仓库
 *
 * 供局域网内其它设备下载已发布的 .plugin / .theme 包。
 *
 * GET    /api/registry/plugins        列出全部插件包（登录）
 * GET    /api/registry/plugins/:id    下载指定插件包完整内容（登录）
 * POST   /api/registry/plugins        上传/覆盖插件包（管理员）
 * DELETE /api/registry/plugins/:id    删除插件包（管理员）
 * GET    /api/registry/themes         列出全部主题包（登录）
 * GET    /api/registry/themes/:id     下载指定主题包内容（登录）
 * POST   /api/registry/themes         上传/覆盖主题包（管理员）
 * DELETE /api/registry/themes/:id     删除主题包（管理员）
 *
 * 约定：所有错误统一返回 { error: '中文提示' }，不抛堆栈。
 */

const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const {
  validatePluginPackage,
  validateThemePack,
  joinTags,
  splitTags,
} = require('./registry-validate');

const router = express.Router();

/**
 * 数据库行 -> 插件包摘要
 * @param {object} row
 * @returns {object}
 */
function mapPluginSummary(row) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    category: row.category,
    description: row.description,
    author: row.author,
    preview: row.preview,
    tags: splitTags(row.tags),
    sizeKB: row.size_kb,
    builtin: row.builtin === 1,
    offline: row.offline === 1,
    minCoreVersion: row.min_core_version,
    createdAt: row.created_at,
  };
}

/**
 * 数据库行 -> 主题包摘要
 * @param {object} row
 * @returns {object}
 */
function mapThemeSummary(row) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    category: row.category || '综合',
    description: row.description,
    author: row.author,
    preview: row.preview,
    tags: splitTags(row.tags),
    createdAt: row.created_at,
  };
}

/**
 * 计算包体积（KB）：按原文字节长度除以 1024 并四舍五入
 * @param {string} text
 * @returns {number}
 */
function calcSizeKB(text) {
  return Math.round(Buffer.byteLength(text, 'utf8') / 1024);
}

/* ==========================================================================
 * 插件包
 * ========================================================================== */

/**
 * GET /api/registry/plugins —— 列出全部插件包（按 category, name 排序）
 */
router.get('/plugins', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM plugin_packages ORDER BY category ASC, name ASC');
  return res.json({ plugins: rows.map(mapPluginSummary) });
});

/**
 * GET /api/registry/plugins/:id —— 下载指定插件包的完整内容
 */
router.get('/plugins/:id', requireAuth, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '插件包 id 不能为空' });

  const row = get('SELECT * FROM plugin_packages WHERE id = ?', id);
  if (!row) return res.status(404).json({ error: '插件包不存在' });

  let pkg;
  try {
    pkg = JSON.parse(row.package_json);
  } catch {
    return res.status(500).json({ error: '插件包内容已损坏，无法读取' });
  }
  return res.json({ package: pkg });
});

/**
 * POST /api/registry/plugins —— 上传/覆盖插件包（仅管理员）
 * body: { package: <.plugin 包原文对象> }
 */
router.post('/plugins', requireAuth, requireAdmin, (req, res) => {
  const pkg = req.body?.package;
  if (pkg === undefined || pkg === null) {
    return res.status(400).json({ error: '请求体缺少 package 字段（.plugin 包原文）' });
  }

  const check = validatePluginPackage(pkg);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const data = check.data;

  const packageJson = JSON.stringify(pkg);
  const manifestJson = JSON.stringify(pkg.manifest);
  const sizeKB = calcSizeKB(packageJson);
  const now = Date.now();

  // id 相同则整体覆盖
  run(
    `INSERT INTO plugin_packages
       (id, name, version, category, description, author, preview, tags, size_kb,
        builtin, offline, min_core_version, manifest_json, package_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       version = excluded.version,
       category = excluded.category,
       description = excluded.description,
       author = excluded.author,
       preview = excluded.preview,
       tags = excluded.tags,
       size_kb = excluded.size_kb,
       builtin = excluded.builtin,
       offline = excluded.offline,
       min_core_version = excluded.min_core_version,
       manifest_json = excluded.manifest_json,
       package_json = excluded.package_json`,
    data.id,
    data.name,
    data.version,
    data.category,
    data.description,
    data.author,
    data.preview,
    joinTags(data.tags),
    sizeKB,
    data.builtin,
    data.offline,
    data.minCoreVersion,
    manifestJson,
    packageJson,
    now
  );

  const row = get('SELECT * FROM plugin_packages WHERE id = ?', data.id);
  return res.json({ plugin: mapPluginSummary(row) });
});

/**
 * DELETE /api/registry/plugins/:id —— 删除插件包（仅管理员，内置包受保护）
 */
router.delete('/plugins/:id', requireAuth, requireAdmin, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '插件包 id 不能为空' });

  const row = get('SELECT * FROM plugin_packages WHERE id = ?', id);
  if (!row) return res.status(404).json({ error: '插件包不存在' });
  if (row.builtin === 1) return res.status(400).json({ error: '内置插件包不可删除' });

  run('DELETE FROM plugin_packages WHERE id = ?', id);
  return res.json({ ok: true });
});

/* ==========================================================================
 * 主题包
 * ========================================================================== */

/**
 * GET /api/registry/themes —— 列出全部主题包（按 name 排序）
 */
router.get('/themes', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM theme_packages ORDER BY name ASC');
  return res.json({ themes: rows.map(mapThemeSummary) });
});

/**
 * GET /api/registry/themes/:id —— 下载指定主题包内容
 */
router.get('/themes/:id', requireAuth, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '主题包 id 不能为空' });

  const row = get('SELECT * FROM theme_packages WHERE id = ?', id);
  if (!row) return res.status(404).json({ error: '主题包不存在' });

  let pack;
  try {
    pack = JSON.parse(row.pack_json);
  } catch {
    return res.status(500).json({ error: '主题包内容已损坏，无法读取' });
  }
  // 同时返回 .theme 信封，客户端可按需取用
  return res.json({
    pack,
    package: {
      format: 'zhijianxia.theme',
      formatVersion: 1,
      manifest: {
        id: row.id,
        name: row.name,
        version: row.version,
        category: row.category || '综合',
        description: row.description,
        author: row.author,
        preview: row.preview,
        tags: splitTags(row.tags),
      },
      pack,
    },
  });
});

/**
 * POST /api/registry/themes —— 上传/覆盖主题包（仅管理员）
 * body: { pack: <主题包 JSON> }
 */
router.post('/themes', requireAuth, requireAdmin, (req, res) => {
  // 兼容两种提交形态：
  // 1. { pack: {...} } —— 直接提交主题定义
  // 2. { package: { format: 'zhijianxia.theme', manifest, pack } } —— 提交 .theme 信封
  let pack = req.body?.pack;
  if (pack === undefined || pack === null) {
    const envelope = req.body?.package;
    if (envelope && typeof envelope === 'object' && envelope.pack) {
      pack = envelope.pack;
    }
  }
  if (pack === undefined || pack === null) {
    return res.status(400).json({ error: '请求体缺少 pack 字段（主题包定义）' });
  }

  const check = validateThemePack(pack);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const data = check.data;

  const packJson = JSON.stringify(pack);
  const now = Date.now();

  run(
    `INSERT INTO theme_packages
       (id, name, version, category, description, author, preview, tags, pack_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       version = excluded.version,
       category = excluded.category,
       description = excluded.description,
       author = excluded.author,
       preview = excluded.preview,
       tags = excluded.tags,
       pack_json = excluded.pack_json`,
    data.id,
    data.name,
    data.version,
    data.category,
    data.description,
    data.author,
    data.preview,
    joinTags(data.tags),
    packJson,
    now
  );

  const row = get('SELECT * FROM theme_packages WHERE id = ?', data.id);
  return res.json({ theme: mapThemeSummary(row) });
});

/**
 * DELETE /api/registry/themes/:id —— 删除主题包（仅管理员）
 */
router.delete('/themes/:id', requireAuth, requireAdmin, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '主题包 id 不能为空' });

  const row = get('SELECT * FROM theme_packages WHERE id = ?', id);
  if (!row) return res.status(404).json({ error: '主题包不存在' });

  run('DELETE FROM theme_packages WHERE id = ?', id);
  return res.json({ ok: true });
});

module.exports = router;

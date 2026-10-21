'use strict';

/**
 * routes/registry.js —— 插件包与主题包仓库（文件存储）
 *
 * 包的存放位置：
 * - 插件包：`server/packages/plugins/*.plugin`
 * - 主题包：`server/packages/themes/*.theme`
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
const { requireAuth, requireAdmin } = require('../auth');
const store = require('../packages');

const router = express.Router();

/* ==========================================================================
 * 插件包
 * ========================================================================== */

/**
 * GET /api/registry/plugins —— 列出全部插件包
 */
router.get('/plugins', requireAuth, (req, res) => {
  return res.json({ plugins: store.listPluginPackages() });
});

/**
 * GET /api/registry/plugins/:id —— 下载指定插件包的完整内容
 */
router.get('/plugins/:id', requireAuth, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '插件包 id 不能为空' });

  const found = store.readPluginPackage(id);
  if (!found.ok) return res.status(404).json({ error: found.error });
  return res.json({ package: found.data.json });
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

  const written = store.writePluginPackage(pkg);
  if (!written.ok) return res.status(400).json({ error: written.error });

  const list = store.listPluginPackages();
  const summary = list.find((p) => p.id === written.data.id);
  return res.json({ plugin: summary });
});

/**
 * DELETE /api/registry/plugins/:id —— 删除插件包（仅管理员）
 */
router.delete('/plugins/:id', requireAuth, requireAdmin, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '插件包 id 不能为空' });

  const result = store.deletePluginPackage(id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  return res.json({ ok: true });
});

/* ==========================================================================
 * 主题包
 * ========================================================================== */

/**
 * GET /api/registry/themes —— 列出全部主题包
 */
router.get('/themes', requireAuth, (req, res) => {
  return res.json({ themes: store.listThemePackages() });
});

/**
 * GET /api/registry/themes/:id —— 下载指定主题包内容
 *
 * 两种形态：
 * - 文件夹制：返回 { format:'zhijianxia.theme.dir', manifest, css, assets }
 * - 单文件信封制：返回 { format:'zhijianxia.theme', ...envelope }
 */
router.get('/themes/:id', requireAuth, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '主题包 id 不能为空' });

  const found = store.readThemePackage(id);
  if (!found.ok) return res.status(404).json({ error: found.error });

  const data = found.data;

  // 文件夹制：theme.json 原文 + theme.css + 资源索引
  if (data.assets) {
    return res.json({
      format: 'zhijianxia.theme.dir',
      manifest: data.json,
      css: data.css ?? '',
      assets: data.assets,
    });
  }

  // 单文件信封制
  const pkg = data.json;
  return res.json({ format: 'zhijianxia.theme', ...pkg, pack: pkg.pack ?? pkg });
});

/**
 * POST /api/registry/themes —— 上传/覆盖主题包（仅管理员）
 * body: { pack: <主题包定义> } 或 { package: <.theme 信封> }
 */
router.post('/themes', requireAuth, requireAdmin, (req, res) => {
  const input = req.body?.package ?? req.body?.pack;
  if (input === undefined || input === null) {
    return res.status(400).json({ error: '请求体缺少 pack 字段（主题包定义）' });
  }

  const written = store.writeThemePackage(input);
  if (!written.ok) return res.status(400).json({ error: written.error });

  const list = store.listThemePackages();
  const summary = list.find((t) => t.id === written.data.id);
  return res.json({ theme: summary });
});

/**
 * DELETE /api/registry/themes/:id —— 删除主题包（仅管理员）
 */
router.delete('/themes/:id', requireAuth, requireAdmin, (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: '主题包 id 不能为空' });

  const result = store.deleteThemePackage(id);
  if (!result.ok) return res.status(404).json({ error: result.error });
  return res.json({ ok: true });
});

module.exports = router;

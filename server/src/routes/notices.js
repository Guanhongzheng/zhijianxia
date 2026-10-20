'use strict';

/**
 * routes/notices.js —— 公告 CRUD
 *
 * GET    /api/notices          列表（普通用户可读，公开）
 * GET    /api/notices/:id      详情
 * POST   /api/notices          新增（仅管理员）
 * PUT    /api/notices/:id      修改（仅管理员）
 * DELETE /api/notices/:id      删除（仅管理员）
 */

const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

/** 数据库行 -> 前端对象 */
function mapNotice(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    authorUid: row.author_uid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/notices —— 公告列表（无需登录，方便首页展示）
 */
router.get('/', (req, res) => {
  const rows = all('SELECT * FROM notices ORDER BY created_at DESC, id DESC');
  return res.json({ notices: rows.map(mapNotice) });
});

/**
 * GET /api/notices/:id —— 公告详情
 */
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '公告 ID 不合法' });
  const row = get('SELECT * FROM notices WHERE id = ?', id);
  if (!row) return res.status(404).json({ error: '公告不存在' });
  return res.json({ notice: mapNotice(row) });
});

/**
 * POST /api/notices —— 新增公告（仅管理员）
 * body: { title, body }
 */
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '');

  if (!title) return res.status(400).json({ error: '公告标题不能为空' });
  if (title.length > 100) return res.status(400).json({ error: '公告标题不能超过 100 个字符' });
  if (body.length > 10000) return res.status(400).json({ error: '公告内容不能超过 10000 个字符' });

  const now = Date.now();
  const result = run(
    'INSERT INTO notices (title, body, author_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    title,
    body,
    req.user.uid,
    now,
    now
  );
  const row = get('SELECT * FROM notices WHERE id = ?', Number(result.lastInsertRowid));
  return res.status(201).json({ notice: mapNotice(row) });
});

/**
 * PUT /api/notices/:id —— 修改公告（仅管理员）
 * body: { title?, body? }
 */
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '公告 ID 不合法' });

  const existing = get('SELECT * FROM notices WHERE id = ?', id);
  if (!existing) return res.status(404).json({ error: '公告不存在' });

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
  const body = req.body?.body !== undefined ? String(req.body.body) : existing.body;

  if (!title) return res.status(400).json({ error: '公告标题不能为空' });
  if (title.length > 100) return res.status(400).json({ error: '公告标题不能超过 100 个字符' });
  if (body.length > 10000) return res.status(400).json({ error: '公告内容不能超过 10000 个字符' });

  run('UPDATE notices SET title = ?, body = ?, updated_at = ? WHERE id = ?', title, body, Date.now(), id);
  const row = get('SELECT * FROM notices WHERE id = ?', id);
  return res.json({ notice: mapNotice(row) });
});

/**
 * DELETE /api/notices/:id —— 删除公告（仅管理员）
 */
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '公告 ID 不合法' });

  const existing = get('SELECT * FROM notices WHERE id = ?', id);
  if (!existing) return res.status(404).json({ error: '公告不存在' });

  run('DELETE FROM notices WHERE id = ?', id);
  return res.json({ ok: true, id });
});

module.exports = router;

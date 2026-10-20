'use strict';

/**
 * routes/auth.js —— 注册 / 登录 / 当前用户
 *
 * POST /api/auth/register  注册并直接返回 token
 * POST /api/auth/login     登录
 * GET  /api/auth/me        获取当前登录用户
 * POST /api/auth/logout    退出登录（销毁会话）
 */

const express = require('express');
const { run, get } = require('../db');
const {
  hashPassword,
  verifyPassword,
  generateUid,
  createSession,
  destroySession,
  extractToken,
  publicUser,
  requireAuth,
} = require('../auth');

const router = express.Router();

/** 随机头像颜色池 */
const AVATAR_COLORS = [
  '#4F8CFF', '#7C5CFF', '#FF6B8A', '#FF9F43',
  '#2ED573', '#00C2D1', '#A55EEA', '#F368E0',
];

/**
 * POST /api/auth/register
 * body: { nickname, password, uid? }
 */
router.post('/register', (req, res) => {
  const nickname = String(req.body?.nickname || '').trim();
  const password = String(req.body?.password || '');
  const wantedUid = String(req.body?.uid || '').trim().toUpperCase();

  if (!nickname) return res.status(400).json({ error: '请填写昵称' });
  if (nickname.length > 24) return res.status(400).json({ error: '昵称不能超过 24 个字符' });
  if (!password || password.length < 6) {
    return res.status(400).json({ error: '密码至少需要 6 位字符' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: '密码不能超过 128 个字符' });
  }

  // uid 可由用户指定（方便与前端本地生成的对齐），否则自动生成
  let uid = wantedUid;
  if (uid) {
    if (!/^ZJ-[A-Z0-9]{4,12}$/.test(uid)) {
      return res.status(400).json({ error: 'uid 格式不正确，应形如 ZJ-XXXXXX' });
    }
    if (get('SELECT id FROM users WHERE uid = ?', uid)) {
      return res.status(409).json({ error: '该 uid 已被占用，请换一个' });
    }
  } else {
    uid = generateUid('ZJ');
  }

  if (get('SELECT id FROM users WHERE nickname = ?', nickname)) {
    return res.status(409).json({ error: '该昵称已被使用，请换一个' });
  }

  const now = Date.now();
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  let userId;
  try {
    const result = run(
      `INSERT INTO users (uid, nickname, password_hash, avatar_color, bio, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      uid,
      nickname,
      hashPassword(password),
      avatarColor,
      '',
      'user',
      now
    );
    userId = Number(result.lastInsertRowid);
  } catch (err) {
    return res.status(500).json({ error: '注册失败，请稍后重试' });
  }

  const { token } = createSession(userId);
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  return res.status(201).json({ token, user: publicUser(user) });
});

/**
 * POST /api/auth/login
 * body: { uid?, nickname?, password }
 * uid 与 nickname 至少提供一个；两者都提供时以 uid 为准
 */
router.post('/login', (req, res) => {
  const uid = String(req.body?.uid || '').trim().toUpperCase();
  const nickname = String(req.body?.nickname || '').trim();
  const password = String(req.body?.password || '');

  if (!uid && !nickname) {
    return res.status(400).json({ error: '请输入 uid 或昵称' });
  }
  if (!password) {
    return res.status(400).json({ error: '请输入密码' });
  }

  const user = uid
    ? get('SELECT * FROM users WHERE uid = ?', uid)
    : get('SELECT * FROM users WHERE nickname = ?', nickname);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '账号或密码不正确' });
  }

  const { token } = createSession(user.id);
  return res.json({ token, user: publicUser(user) });
});

/**
 * GET /api/auth/me —— 需要登录
 */
router.get('/me', requireAuth, (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  return res.json({ user: publicUser(user) });
});

/**
 * POST /api/auth/logout —— 需要登录
 */
router.post('/logout', requireAuth, (req, res) => {
  destroySession(req.token);
  return res.json({ ok: true });
});

/**
 * PATCH /api/auth/me —— 修改个人资料（昵称、简介、头像色）
 * body: { nickname?, bio?, avatarColor? }
 */
router.patch('/me', requireAuth, (req, res) => {
  const nickname = req.body?.nickname !== undefined ? String(req.body.nickname).trim() : null;
  const bio = req.body?.bio !== undefined ? String(req.body.bio).slice(0, 200) : null;
  const avatarColor = req.body?.avatarColor !== undefined ? String(req.body.avatarColor).slice(0, 32) : null;

  if (nickname !== null) {
    if (!nickname) return res.status(400).json({ error: '昵称不能为空' });
    if (nickname.length > 24) return res.status(400).json({ error: '昵称不能超过 24 个字符' });
    const dup = get('SELECT id FROM users WHERE nickname = ? AND id != ?', nickname, req.user.id);
    if (dup) return res.status(409).json({ error: '该昵称已被使用，请换一个' });
  }
  if (avatarColor !== null && !/^#[0-9a-fA-F]{3,8}$/.test(avatarColor)) {
    return res.status(400).json({ error: '头像颜色格式不正确，应形如 #4F8CFF' });
  }

  if (nickname !== null) run('UPDATE users SET nickname = ? WHERE id = ?', nickname, req.user.id);
  if (bio !== null) run('UPDATE users SET bio = ? WHERE id = ?', bio, req.user.id);
  if (avatarColor !== null) run('UPDATE users SET avatar_color = ? WHERE id = ?', avatarColor, req.user.id);

  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  return res.json({ user: publicUser(user) });
});

module.exports = router;
module.exports.extractToken = extractToken;

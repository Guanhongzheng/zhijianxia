'use strict';

/**
 * routes/friends.js —— 好友请求 / 好友列表 / 删除好友
 *
 * GET    /api/friends              好友列表 + 收到的请求 + 发出的请求
 * POST   /api/friends/request      发起好友请求  body: { uid }
 * PUT    /api/friends/:id/accept   同意好友请求（:id 为 friends 表行 id）
 * PUT    /api/friends/:id/reject   拒绝好友请求
 * DELETE /api/friends/:uid         删除好友（双向清理）
 */

const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth } = require('../auth');
const hub = require('../ws/hub');

const router = express.Router();

/** 构造用户简要信息 */
function briefUser(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    nickname: row.nickname,
    avatarColor: row.avatar_color,
    bio: row.bio || '',
  };
}

/**
 * GET /api/friends —— 需要登录
 */
router.get('/', requireAuth, (req, res) => {
  const me = req.user.uid;

  // 已建立的好友关系（双向：任一方向 status=accepted 即为好友）
  const acceptedRows = all(
    `SELECT * FROM friends
      WHERE status = 'accepted' AND (user_uid = ? OR friend_uid = ?)
      ORDER BY created_at ASC`,
    me,
    me
  );

  // 按对方 uid 去重
  const friendMap = new Map();
  for (const row of acceptedRows) {
    const otherUid = row.user_uid === me ? row.friend_uid : row.user_uid;
    if (otherUid === me) continue;
    const user = get('SELECT * FROM users WHERE uid = ?', otherUid);
    if (!user) continue;
    friendMap.set(otherUid, {
      ...briefUser(user),
      status: 'accepted',
      since: row.created_at,
    });
  }

  // 收到的待处理请求
  const incoming = all(
    `SELECT f.*, u.nickname, u.avatar_color, u.bio
       FROM friends f LEFT JOIN users u ON u.uid = f.user_uid
      WHERE f.friend_uid = ? AND f.status = 'pending'
      ORDER BY f.created_at ASC`,
    me
  ).map((row) => ({
    id: row.id,
    from: briefUser({ uid: row.user_uid, nickname: row.nickname, avatar_color: row.avatar_color, bio: row.bio }),
    createdAt: row.created_at,
  }));

  // 发出的待处理请求
  const outgoing = all(
    `SELECT f.*, u.nickname, u.avatar_color, u.bio
       FROM friends f LEFT JOIN users u ON u.uid = f.friend_uid
      WHERE f.user_uid = ? AND f.status = 'pending'
      ORDER BY f.created_at ASC`,
    me
  ).map((row) => ({
    id: row.id,
    to: briefUser({ uid: row.friend_uid, nickname: row.nickname, avatar_color: row.avatar_color, bio: row.bio }),
    createdAt: row.created_at,
  }));

  return res.json({
    friends: Array.from(friendMap.values()),
    incoming,
    outgoing,
  });
});

/**
 * POST /api/friends/request —— 发起好友请求 —— 需要登录
 * body: { uid }
 */
router.post('/request', requireAuth, (req, res) => {
  const targetUid = String(req.body?.uid || '').trim().toUpperCase();
  const me = req.user.uid;

  if (!targetUid) return res.status(400).json({ error: '请填写对方 uid' });
  if (targetUid === me) return res.status(400).json({ error: '不能添加自己为好友' });

  const target = get('SELECT * FROM users WHERE uid = ?', targetUid);
  if (!target) return res.status(404).json({ error: '该用户不存在' });

  // 已存在关系则不重复创建
  const existing = get(
    'SELECT * FROM friends WHERE (user_uid = ? AND friend_uid = ?) OR (user_uid = ? AND friend_uid = ?) LIMIT 1',
    me,
    targetUid,
    targetUid,
    me
  );
  if (existing) {
    if (existing.status === 'accepted') {
      return res.status(409).json({ error: '你们已经是好友了' });
    }
    if (existing.user_uid === me) {
      return res.status(409).json({ error: '好友请求已发送，请等待对方处理' });
    }
    // 对方已请求过我：直接互相成为好友
    run("UPDATE friends SET status = 'accepted' WHERE id = ?", existing.id);
    const friend = get('SELECT * FROM users WHERE uid = ?', me);
    hub.sendToUser(targetUid, {
      type: 'system',
      text: `${friend?.nickname || '对方'} 已同意你的好友请求`,
    });
    return res.json({ ok: true, status: 'accepted', friend: briefUser(target) });
  }

  const now = Date.now();
  const result = run(
    "INSERT INTO friends (user_uid, friend_uid, status, created_at) VALUES (?, ?, 'pending', ?)",
    me,
    targetUid,
    now
  );

  // 通过 WebSocket 通知对方（对方在线时立即收到）
  hub.sendToUser(targetUid, {
    type: 'friend_request',
    payload: {
      id: Number(result.lastInsertRowid),
      from: briefUser(req.user),
      createdAt: now,
    },
  });

  return res.status(201).json({
    ok: true,
    status: 'pending',
    id: Number(result.lastInsertRowid),
    friend: briefUser(target),
  });
});

/**
 * PUT /api/friends/:id/accept —— 同意好友请求 —— 需要登录
 */
router.put('/:id/accept', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '请求 ID 不合法' });

  const row = get('SELECT * FROM friends WHERE id = ?', id);
  if (!row) return res.status(404).json({ error: '好友请求不存在' });
  if (row.friend_uid !== req.user.uid) {
    return res.status(403).json({ error: '只有请求的接收方可以处理该好友请求' });
  }
  if (row.status === 'accepted') {
    return res.status(409).json({ error: '该好友请求已处理过' });
  }

  run("UPDATE friends SET status = 'accepted' WHERE id = ?", id);

  // 通知请求方
  const requester = get('SELECT * FROM users WHERE uid = ?', row.user_uid);
  hub.sendToUser(row.user_uid, {
    type: 'system',
    text: `${req.user.nickname} 已同意你的好友请求`,
  });
  hub.sendToUser(row.user_uid, {
    type: 'friend_request',
    payload: {
      id,
      from: briefUser(req.user),
      status: 'accepted',
      createdAt: row.created_at,
    },
  });

  return res.json({ ok: true, status: 'accepted', friend: briefUser(requester) });
});

/**
 * PUT /api/friends/:id/reject —— 拒绝好友请求 —— 需要登录
 */
router.put('/:id/reject', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '请求 ID 不合法' });

  const row = get('SELECT * FROM friends WHERE id = ?', id);
  if (!row) return res.status(404).json({ error: '好友请求不存在' });
  if (row.friend_uid !== req.user.uid) {
    return res.status(403).json({ error: '只有请求的接收方可以处理该好友请求' });
  }

  run("UPDATE friends SET status = 'rejected' WHERE id = ?", id);
  hub.sendToUser(row.user_uid, {
    type: 'system',
    text: `${req.user.nickname} 拒绝了你的好友请求`,
  });

  return res.json({ ok: true, status: 'rejected' });
});

/**
 * DELETE /api/friends/:uid —— 删除好友（双向清理） —— 需要登录
 */
router.delete('/:uid', requireAuth, (req, res) => {
  const targetUid = String(req.params.uid || '').trim().toUpperCase();
  if (!targetUid) return res.status(400).json({ error: '请填写对方 uid' });

  run(
    'DELETE FROM friends WHERE (user_uid = ? AND friend_uid = ?) OR (user_uid = ? AND friend_uid = ?)',
    req.user.uid,
    targetUid,
    targetUid,
    req.user.uid
  );

  return res.json({ ok: true, uid: targetUid });
});

module.exports = router;

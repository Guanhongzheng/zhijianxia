'use strict';

/**
 * routes/groups.js —— 群聊 CRUD + 成员管理
 *
 * GET    /api/groups                 我加入的群列表
 * POST   /api/groups                 创建群聊        body: { name }
 * GET    /api/groups/:groupId        群详情 + 成员列表
 * PUT    /api/groups/:groupId        修改群名/公告   body: { name? }
 * DELETE /api/groups/:groupId        解散群聊（仅群主）
 * POST   /api/groups/:groupId/members 添加成员       body: { uid }
 * DELETE /api/groups/:groupId/members/:uid 移除成员
 */

const express = require('express');
const { run, get, all } = require('../db');
const { requireAuth, generateGroupId } = require('../auth');
const hub = require('../ws/hub');

const router = express.Router();

/** 判断 uid 是否为群成员 */
function isMember(groupId, uid) {
  return !!get('SELECT id FROM group_members WHERE group_id = ? AND user_uid = ?', groupId, uid);
}

/** 群信息 + 成员数 */
function groupSummary(row) {
  const memberCount = get(
    'SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?',
    row.group_id
  ).c;
  return {
    groupId: row.group_id,
    name: row.name,
    ownerUid: row.owner_uid,
    memberCount,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/groups —— 我加入的群 —— 需要登录
 */
router.get('/', requireAuth, (req, res) => {
  const rows = all(
    `SELECT g.* FROM groups g
       JOIN group_members m ON m.group_id = g.group_id
      WHERE m.user_uid = ?
      ORDER BY g.created_at DESC`,
    req.user.uid
  );
  return res.json({ groups: rows.map(groupSummary) });
});

/**
 * POST /api/groups —— 创建群聊 —— 需要登录
 * body: { name }
 */
router.post('/', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '请填写群名称' });
  if (name.length > 40) return res.status(400).json({ error: '群名称不能超过 40 个字符' });

  const groupId = generateGroupId();
  const now = Date.now();

  run('INSERT INTO groups (group_id, name, owner_uid, created_at) VALUES (?, ?, ?, ?)', groupId, name, req.user.uid, now);
  run('INSERT INTO group_members (group_id, user_uid, joined_at) VALUES (?, ?, ?)', groupId, req.user.uid, now);

  const row = get('SELECT * FROM groups WHERE group_id = ?', groupId);
  return res.status(201).json({ group: groupSummary(row) });
});

/**
 * GET /api/groups/:groupId —— 群详情 + 成员 —— 需要登录（成员可见）
 */
router.get('/:groupId', requireAuth, (req, res) => {
  const groupId = String(req.params.groupId || '').trim().toUpperCase();
  const group = get('SELECT * FROM groups WHERE group_id = ?', groupId);
  if (!group) return res.status(404).json({ error: '群聊不存在' });
  if (!isMember(groupId, req.user.uid)) {
    return res.status(403).json({ error: '你不是该群成员，无法查看群信息' });
  }

  const members = all(
    `SELECT u.uid, u.nickname, u.avatar_color, u.bio, m.joined_at
       FROM group_members m JOIN users u ON u.uid = m.user_uid
      WHERE m.group_id = ?
      ORDER BY m.joined_at ASC`,
    groupId
  ).map((row) => ({
    uid: row.uid,
    nickname: row.nickname,
    avatarColor: row.avatar_color,
    bio: row.bio || '',
    joinedAt: row.joined_at,
    isOwner: row.uid === group.owner_uid,
  }));

  return res.json({ group: groupSummary(group), members });
});

/**
 * PUT /api/groups/:groupId —— 修改群名 —— 需要登录（仅群主）
 * body: { name }
 */
router.put('/:groupId', requireAuth, (req, res) => {
  const groupId = String(req.params.groupId || '').trim().toUpperCase();
  const group = get('SELECT * FROM groups WHERE group_id = ?', groupId);
  if (!group) return res.status(404).json({ error: '群聊不存在' });
  if (group.owner_uid !== req.user.uid) {
    return res.status(403).json({ error: '只有群主可以修改群信息' });
  }

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : group.name;
  if (!name) return res.status(400).json({ error: '群名称不能为空' });
  if (name.length > 40) return res.status(400).json({ error: '群名称不能超过 40 个字符' });

  run('UPDATE groups SET name = ? WHERE group_id = ?', name, groupId);
  const row = get('SELECT * FROM groups WHERE group_id = ?', groupId);
  return res.json({ group: groupSummary(row) });
});

/**
 * DELETE /api/groups/:groupId —— 解散群聊 —— 需要登录（仅群主）
 */
router.delete('/:groupId', requireAuth, (req, res) => {
  const groupId = String(req.params.groupId || '').trim().toUpperCase();
  const group = get('SELECT * FROM groups WHERE group_id = ?', groupId);
  if (!group) return res.status(404).json({ error: '群聊不存在' });
  if (group.owner_uid !== req.user.uid) {
    return res.status(403).json({ error: '只有群主可以解散群聊' });
  }

  // 通知在线成员
  all('SELECT user_uid FROM group_members WHERE group_id = ?', groupId).forEach((row) => {
    hub.sendToUser(row.user_uid, { type: 'system', text: `群聊「${group.name}」已被群主解散` });
  });

  run('DELETE FROM group_members WHERE group_id = ?', groupId);
  run('DELETE FROM messages WHERE scope = ? AND target = ?', 'group', groupId);
  run('DELETE FROM groups WHERE group_id = ?', groupId);

  return res.json({ ok: true, groupId });
});

/**
 * POST /api/groups/:groupId/members —— 添加成员 —— 需要登录（群成员可邀请）
 * body: { uid }
 */
router.post('/:groupId/members', requireAuth, (req, res) => {
  const groupId = String(req.params.groupId || '').trim().toUpperCase();
  const targetUid = String(req.body?.uid || '').trim().toUpperCase();

  const group = get('SELECT * FROM groups WHERE group_id = ?', groupId);
  if (!group) return res.status(404).json({ error: '群聊不存在' });
  if (!isMember(groupId, req.user.uid)) {
    return res.status(403).json({ error: '你不是该群成员，无法添加成员' });
  }
  if (!targetUid) return res.status(400).json({ error: '请填写要添加的 uid' });
  if (!get('SELECT id FROM users WHERE uid = ?', targetUid)) {
    return res.status(404).json({ error: '该用户不存在' });
  }
  if (isMember(groupId, targetUid)) {
    return res.status(409).json({ error: '该用户已在群中' });
  }

  run('INSERT INTO group_members (group_id, user_uid, joined_at) VALUES (?, ?, ?)', groupId, targetUid, Date.now());
  hub.sendToUser(targetUid, {
    type: 'system',
    text: `你被邀请加入群聊「${group.name}」`,
  });

  return res.status(201).json({ ok: true, groupId, uid: targetUid });
});

/**
 * DELETE /api/groups/:groupId/members/:uid —— 移除成员 —— 需要登录（群主或本人）
 */
router.delete('/:groupId/members/:uid', requireAuth, (req, res) => {
  const groupId = String(req.params.groupId || '').trim().toUpperCase();
  const targetUid = String(req.params.uid || '').trim().toUpperCase();

  const group = get('SELECT * FROM groups WHERE group_id = ?', groupId);
  if (!group) return res.status(404).json({ error: '群聊不存在' });
  if (group.owner_uid !== req.user.uid && targetUid !== req.user.uid) {
    return res.status(403).json({ error: '只有群主可以移除其他成员' });
  }
  if (targetUid === group.owner_uid) {
    return res.status(400).json({ error: '群主不能被移除，请先解散群聊' });
  }
  if (!isMember(groupId, targetUid)) {
    return res.status(404).json({ error: '该用户不在群中' });
  }

  run('DELETE FROM group_members WHERE group_id = ? AND user_uid = ?', groupId, targetUid);
  hub.sendToUser(targetUid, {
    type: 'system',
    text: `你已被移出群聊「${group.name}」`,
  });

  return res.json({ ok: true, groupId, uid: targetUid });
});

module.exports = router;

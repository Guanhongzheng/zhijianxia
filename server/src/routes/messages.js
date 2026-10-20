'use strict';

/**
 * routes/messages.js —— 聊天记录拉取
 *
 * GET /api/messages?scope=direct&target=ZJ-XXXX&limit=50
 * GET /api/messages?scope=group&target=G-XXXX&limit=50
 *
 * 说明：
 *   - direct 场景会同时返回双方方向的消息（target 与自己之间的完整会话）
 *   - 群聊场景需要是该群成员
 */

const express = require('express');
const { all, get } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

/** 单条消息映射 */
function mapMessage(row) {
  return {
    id: row.id,
    scope: row.scope,
    target: row.target,
    senderUid: row.sender_uid,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/messages —— 需要登录
 */
router.get('/', requireAuth, (req, res) => {
  const scope = String(req.query.scope || 'direct');
  const target = String(req.query.target || '').trim().toUpperCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  if (scope !== 'direct' && scope !== 'group') {
    return res.status(400).json({ error: 'scope 必须是 direct 或 group' });
  }
  if (!target) {
    return res.status(400).json({ error: '请填写 target' });
  }

  const me = req.user.uid;

  if (scope === 'group') {
    const member = get('SELECT id FROM group_members WHERE group_id = ? AND user_uid = ?', target, me);
    if (!member) {
      return res.status(403).json({ error: '你不是该群成员，无法查看聊天记录' });
    }
    const rows = all(
      `SELECT * FROM messages
        WHERE scope = 'group' AND target = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      target,
      limit
    );
    // 倒序取出后翻转为正序，方便前端直接渲染
    return res.json({ messages: rows.reverse().map(mapMessage) });
  }

  // direct：取自己与对方之间的双向消息
  const rows = all(
    `SELECT * FROM messages
      WHERE scope = 'direct'
        AND ((target = ? AND sender_uid = ?) OR (target = ? AND sender_uid = ?))
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    target,
    me,
    me,
    target,
    limit
  );
  return res.json({ messages: rows.reverse().map(mapMessage) });
});

module.exports = router;

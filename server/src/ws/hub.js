'use strict';

/**
 * ws/hub.js —— WebSocket 连接管理
 *
 * 职责：
 *   1. 客户端连接校验（query 带 token，校验会话有效性）
 *   2. 维护在线用户表（uid -> Set<WebSocket>）
 *   3. 广播 presence 在线状态
 *   4. 消息路由：先落库，再广播
 *   5. 对外提供 sendToUser，供 REST 路由主动推送（好友请求等）
 *
 * 协议：
 *   服务端推送：{ type:'presence', online:[uid...] }
 *               { type:'message', payload:{ scope,target,senderUid,body,createdAt } }
 *               { type:'friend_request', ... }
 *               { type:'system', text }
 *   客户端上行：{ type:'message', scope, target, body }
 *               { type:'ping' }            -> 回 { type:'pong' }
 *               { type:'typing', target }
 */

const { WebSocketServer } = require('ws');
const { getUserByToken } = require('../auth');
const { run, get, all } = require('../db');

class Hub {
  constructor() {
    /** @type {import('ws').WebSocketServer|null} */
    this.wss = null;
    /** @type {Map<string, Set<import('ws').WebSocket>>} */
    this.clients = new Map();
  }

  /**
   * 挂载到 HTTP 服务
   * @param {import('http').Server} server
   */
  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    return this.wss;
  }

  /**
   * 处理新连接
   * @param {import('ws').WebSocket} ws
   * @param {import('http').IncomingMessage} req
   */
  handleConnection(ws, req) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      ws.close(1008, 'bad url');
      return;
    }

    const token = url.searchParams.get('token') || '';
    const clientUid = url.searchParams.get('uid') || '';

    // 校验会话
    const user = getUserByToken(token);
    if (!user) {
      this.sendJson(ws, { type: 'system', text: '登录状态无效，请重新登录后连接' });
      ws.close(4001, 'unauthorized');
      return;
    }
    // uid 以会话中的为准，防止冒用他人身份
    if (clientUid && clientUid !== user.uid) {
      this.sendJson(ws, { type: 'system', text: 'uid 与登录账号不一致，已断开连接' });
      ws.close(4003, 'uid mismatch');
      return;
    }

    const uid = user.uid;
    ws.uid = uid;
    ws.isAlive = true;

    if (!this.clients.has(uid)) this.clients.set(uid, new Set());
    this.clients.get(uid).add(ws);

    this.sendJson(ws, {
      type: 'system',
      text: `已连接到智简匣后端（${uid}）`,
      uid,
      online: this.onlineUids(),
    });
    this.broadcastPresence();

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => this.handleMessage(ws, raw));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', () => this.handleClose(ws));
  }

  /**
   * 关闭连接：清理在线表并广播 presence
   * @param {import('ws').WebSocket} ws
   */
  handleClose(ws) {
    const uid = ws.uid;
    if (!uid) return;
    const set = this.clients.get(uid);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.clients.delete(uid);
    this.broadcastPresence();
  }

  /**
   * 处理客户端上行消息
   * @param {import('ws').WebSocket} ws
   * @param {Buffer|string} raw
   */
  handleMessage(ws, raw) {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      this.sendJson(ws, { type: 'system', text: '消息格式错误，需要 JSON' });
      return;
    }
    if (!data || typeof data !== 'object') {
      this.sendJson(ws, { type: 'system', text: '消息格式错误，需要 JSON 对象' });
      return;
    }

    switch (data.type) {
      case 'ping':
        this.sendJson(ws, { type: 'pong', ts: Date.now() });
        break;
      case 'message':
        this.handleChat(ws, data);
        break;
      case 'typing':
        this.handleTyping(ws, data);
        break;
      default:
        this.sendJson(ws, { type: 'system', text: `不支持的消息类型：${data.type || '未知'}` });
    }
  }

  /**
   * 聊天消息：先落库，再广播
   * @param {import('ws').WebSocket} ws
   * @param {object} data
   */
  handleChat(ws, data) {
    const scope = String(data.scope || '');
    const target = String(data.target || '').trim();
    const body = String(data.body || '').trim();

    if (scope !== 'direct' && scope !== 'group') {
      this.sendJson(ws, { type: 'system', text: '消息 scope 必须是 direct 或 group' });
      return;
    }
    if (!target) {
      this.sendJson(ws, { type: 'system', text: '消息缺少 target' });
      return;
    }
    if (!body) {
      this.sendJson(ws, { type: 'system', text: '消息内容不能为空' });
      return;
    }
    if (body.length > 5000) {
      this.sendJson(ws, { type: 'system', text: '消息内容过长（最多 5000 字符）' });
      return;
    }

    const senderUid = ws.uid;
    let recipients = [];

    if (scope === 'direct') {
      const targetUid = target.toUpperCase();
      const isFriend = get(
        `SELECT id FROM friends
          WHERE status = 'accepted' AND ((user_uid = ? AND friend_uid = ?) OR (user_uid = ? AND friend_uid = ?))`,
        senderUid,
        targetUid,
        targetUid,
        senderUid
      );
      if (!isFriend) {
        this.sendJson(ws, { type: 'system', text: '对方不是你的好友，无法发送私信' });
        return;
      }
      if (!get('SELECT id FROM users WHERE uid = ?', targetUid)) {
        this.sendJson(ws, { type: 'system', text: '对方用户不存在' });
        return;
      }
      recipients = [targetUid];
    } else {
      const groupId = target.toUpperCase();
      const member = get(
        'SELECT id FROM group_members WHERE group_id = ? AND user_uid = ?',
        groupId,
        senderUid
      );
      if (!member) {
        this.sendJson(ws, { type: 'system', text: '你不是该群成员，无法发言' });
        return;
      }
      recipients = all('SELECT user_uid FROM group_members WHERE group_id = ?', groupId)
        .map((row) => row.user_uid);
    }

    const createdAt = Date.now();
    const normalizedTarget = target.toUpperCase();
    // 先落库 —— 拿到自增 id，广播时一并下发
    const inserted = run(
      'INSERT INTO messages (scope, target, sender_uid, body, created_at) VALUES (?, ?, ?, ?, ?)',
      scope,
      normalizedTarget,
      senderUid,
      body,
      createdAt
    );
    const messageId = Number(inserted?.lastInsertRowid ?? createdAt);

    // 再广播（带id，前端据此去重；此前广播无 id，前端只能拿 createdAt 冒充，
    // 导致「历史消息 id vs 时间戳」混用，去重逻辑恒不命中 → 消息重复渲染）
    const payload = {
      type: 'message',
      payload: {
        id: messageId,
        scope,
        target: normalizedTarget,
        senderUid,
        body,
        createdAt,
      },
    };
    const uniqueRecipients = Array.from(new Set([...recipients, senderUid]));
    uniqueRecipients.forEach((uid) => this.sendToUser(uid, payload));
  }

  /**
   * 「正在输入」状态转发
   * @param {import('ws').WebSocket} ws
   * @param {object} data
   */
  handleTyping(ws, data) {
    const target = String(data.target || '').trim().toUpperCase();
    if (!target) return;
    this.sendToUser(target, {
      type: 'typing',
      payload: { from: ws.uid, target, at: Date.now() },
    });
  }

  /**
   * 发送 JSON（socket 可能已关闭）
   * @param {import('ws').WebSocket} ws
   * @param {object} obj
   */
  sendJson(ws, obj) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch {
      /* 忽略发送异常，连接会在 close 事件中清理 */
    }
  }

  /**
   * 向指定 uid 的所有连接推送消息
   * @param {string} uid
   * @param {object} payload
   * @returns {number} 实际送达的连接数
   */
  sendToUser(uid, payload) {
    const set = this.clients.get(uid);
    if (!set || set.size === 0) return 0;
    let count = 0;
    for (const ws of set) {
      this.sendJson(ws, payload);
      count += 1;
    }
    return count;
  }

  /**
   * 向所有在线用户广播
   * @param {object} payload
   */
  broadcast(payload) {
    for (const set of this.clients.values()) {
      for (const ws of set) this.sendJson(ws, payload);
    }
  }

  /**
   * 当前在线 uid 列表
   * @returns {string[]}
   */
  onlineUids() {
    return Array.from(this.clients.keys());
  }

  /**
   * 广播在线状态
   */
  broadcastPresence() {
    this.broadcast({ type: 'presence', online: this.onlineUids() });
  }

  /**
   * 心跳检测：定时剔除僵死连接
   */
  startHeartbeat(intervalMs = 30000) {
    this.heartbeatTimer = setInterval(() => {
      for (const set of this.clients.values()) {
        for (const ws of set) {
          if (ws.isAlive === false) {
            try { ws.terminate(); } catch { /* 忽略 */ }
            continue;
          }
          ws.isAlive = false;
          try { ws.ping(); } catch { /* 忽略 */ }
        }
      }
    }, intervalMs);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /**
   * 关闭服务
   */
  close() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.wss) {
      for (const set of this.clients.values()) {
        for (const ws of set) {
          try { ws.close(1001, 'server shutdown'); } catch { /* 忽略 */ }
        }
      }
      this.wss.close();
    }
    this.clients.clear();
  }
}

// 导出单例，REST 路由可直接调用 sendToUser
module.exports = new Hub();
module.exports.Hub = Hub;

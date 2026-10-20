'use strict';

/**
 * auth.js —— 认证与授权核心
 *
 * - 密码哈希：node:crypto 的 scrypt（零第三方依赖，避免 bcryptjs 原生编译问题）
 * - 会话：随机 token 存入 sessions 表，带过期时间
 * - 中间件：requireAuth（登录校验）、requireAdmin（管理员校验）
 */

const crypto = require('node:crypto');
const { run, get } = require('./db');

/** 会话有效期：30 天 */
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

/** scrypt 参数 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * 生成密码哈希，格式：scrypt$N$r$p$salt(base64)$hash(base64)
 * @param {string} password 明文密码
 * @returns {string} 可直接入库的哈希串
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * 校验密码
 * @param {string} password 明文密码
 * @param {string} stored 数据库中保存的哈希串
 * @returns {boolean} 是否匹配
 */
function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * 生成全局唯一 uid，形如 ZJ-A1B2C3
 * @param {string} prefix 前缀，默认 ZJ
 * @returns {string}
 */
function generateUid(prefix = 'ZJ') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let suffix = '';
    for (let i = 0; i < 6; i += 1) {
      suffix += alphabet[crypto.randomInt(alphabet.length)];
    }
    const uid = `${prefix}-${suffix}`;
    if (!get('SELECT id FROM users WHERE uid = ?', uid)) return uid;
  }
  // 极端情况下退化为带时间戳的 uid，保证不重复
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * 生成群组 id，形如 G-A1B2C3
 * @returns {string}
 */
function generateGroupId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let suffix = '';
    for (let i = 0; i < 6; i += 1) {
      suffix += alphabet[crypto.randomInt(alphabet.length)];
    }
    const gid = `G-${suffix}`;
    if (!get('SELECT id FROM groups WHERE group_id = ?', gid)) return gid;
  }
  return `G-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * 创建会话并返回 token
 * @param {number} userId users.id
 * @returns {{token:string, expiresAt:number}}
 */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL;
  run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    token,
    userId,
    now,
    expiresAt
  );
  return { token, expiresAt };
}

/**
 * 根据 token 查找用户（自动剔除过期会话）
 * @param {string} token
 * @returns {object|null} 用户行，未登录返回 null
 */
function getUserByToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.id, u.uid, u.nickname, u.avatar_color, u.bio, u.role, u.created_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  return row;
}

/**
 * 销毁会话（退出登录）
 * @param {string} token
 */
function destroySession(token) {
  if (!token) return;
  run('DELETE FROM sessions WHERE token = ?', token);
}

/**
 * 从请求中提取 token：优先 Authorization 头，其次 ?token= 查询参数
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractToken(req) {
  const header = req.headers?.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.query && typeof req.query.token === 'string' && req.query.token) {
    return req.query.token;
  }
  return null;
}

/**
 * 将数据库用户行转为前端友好的对象（绝不包含密码哈希）
 * @param {object} row
 * @returns {object}
 */
function publicUser(row) {
  return {
    id: row.id,
    uid: row.uid,
    nickname: row.nickname,
    avatarColor: row.avatar_color,
    bio: row.bio || '',
    role: row.role,
    createdAt: row.created_at,
  };
}

/** 需要登录 */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: '登录状态已失效，请重新登录' });
  }
  req.user = user;
  req.token = token;
  return next();
}

/** 需要管理员 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '登录状态已失效，请重新登录' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '仅管理员可执行此操作' });
  }
  return next();
}

module.exports = {
  SESSION_TTL,
  hashPassword,
  verifyPassword,
  generateUid,
  generateGroupId,
  createSession,
  getUserByToken,
  destroySession,
  extractToken,
  publicUser,
  requireAuth,
  requireAdmin,
};

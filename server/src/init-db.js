'use strict';

/**
 * init-db.js —— 建表 + 种子数据脚本
 *
 * 用法：
 *   node server/src/init-db.js
 *
 * 特性：
 *   - 全部使用 CREATE TABLE IF NOT EXISTS / INSERT ... WHERE NOT EXISTS，可重复执行
 *   - 管理员 uid 固定为 ZJ-ADMIN01，昵称「管理员」，密码 admin123
 *   - 用户已存在则跳过，不覆盖已有数据
 */

const { run, get, all } = require('./db');
const { hashPassword } = require('./auth');

/** 全部建表语句 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     uid           TEXT    NOT NULL UNIQUE,
     nickname      TEXT    NOT NULL,
     password_hash TEXT    NOT NULL,
     avatar_color  TEXT    NOT NULL DEFAULT '#4F8CFF',
     bio           TEXT    NOT NULL DEFAULT '',
     role          TEXT    NOT NULL DEFAULT 'user',
     created_at    INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     token      TEXT    PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS notices (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     title      TEXT    NOT NULL,
     body       TEXT    NOT NULL DEFAULT '',
     author_uid TEXT    NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS friends (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     user_uid  TEXT    NOT NULL,
     friend_uid TEXT   NOT NULL,
     status    TEXT    NOT NULL DEFAULT 'pending',
     created_at INTEGER NOT NULL,
     UNIQUE (user_uid, friend_uid)
   )`,

  `CREATE TABLE IF NOT EXISTS groups (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id   TEXT    NOT NULL UNIQUE,
     name       TEXT    NOT NULL,
     owner_uid  TEXT    NOT NULL,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS group_members (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id  TEXT    NOT NULL,
     user_uid  TEXT    NOT NULL,
     joined_at INTEGER NOT NULL,
     UNIQUE (group_id, user_uid)
   )`,

  `CREATE TABLE IF NOT EXISTS messages (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     scope      TEXT    NOT NULL,
     target     TEXT    NOT NULL,
     sender_uid TEXT    NOT NULL,
     body       TEXT    NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL DEFAULT ''
   )`,

  // 常用查询索引
  `CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_friends_user     ON friends(user_uid)`,
  `CREATE INDEX IF NOT EXISTS idx_friends_friend   ON friends(friend_uid)`,
  `CREATE INDEX IF NOT EXISTS idx_members_group    ON group_members(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_target  ON messages(scope, target, created_at)`,
];

/** 建表（幂等） */
function createSchema() {
  for (const sql of SCHEMA) run(sql);
}

/**
 * 写入种子数据（幂等）：1 个管理员 + 1 条示例公告
 * @returns {{adminCreated:boolean, noticeCreated:boolean}}
 */
function seed() {
  let adminCreated = false;
  let noticeCreated = false;

  // 管理员：uid 固定 ZJ-ADMIN01，密码 admin123
  const exists = get('SELECT id FROM users WHERE uid = ?', 'ZJ-ADMIN01');
  if (!exists) {
    run(
      `INSERT INTO users (uid, nickname, password_hash, avatar_color, bio, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'ZJ-ADMIN01',
      '管理员',
      hashPassword('admin123'),
      '#4F8CFF',
      '智简匣内置管理员，可发布公告。',
      'admin',
      Date.now()
    );
    adminCreated = true;
  }

  // 示例公告：仅当公告表为空时写入
  const noticeCount = get('SELECT COUNT(*) AS c FROM notices').c;
  if (noticeCount === 0) {
    const now = Date.now();
    run(
      `INSERT INTO notices (title, body, author_uid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      '欢迎使用智简匣',
      '这是后端预置的示例公告。纯本地功能（离线 AI、插件、备忘录、主题包、番茄钟、本地音乐）无需连接后端；只有公告、好友、群聊与 AI 转发需要后端服务。',
      'ZJ-ADMIN01',
      now,
      now
    );
    noticeCreated = true;
  }

  return { adminCreated, noticeCreated };
}

/** 完整初始化：建表 + 种子 */
function initDatabase() {
  createSchema();
  return seed();
}

module.exports = { createSchema, seed, initDatabase, SCHEMA };

// 直接执行时跑初始化并打印结果
if (require.main === module) {
  try {
    const result = initDatabase();
    const userCount = get('SELECT COUNT(*) AS c FROM users').c;
    const noticeCount = get('SELECT COUNT(*) AS c FROM notices').c;
    console.log('[init-db] 数据库初始化完成');
    console.log(`[init-db] 管理员${result.adminCreated ? '已创建' : '已存在，跳过'}（uid: ZJ-ADMIN01 / 密码: admin123）`);
    console.log(`[init-db] 示例公告${result.noticeCreated ? '已创建' : '已存在，跳过'}`);
    console.log(`[init-db] 当前统计：用户 ${userCount} 个，公告 ${noticeCount} 条`);
    const { DB_FILE } = require('./db');
    console.log(`[init-db] 数据库文件：${DB_FILE}`);
  } catch (err) {
    console.error('[init-db] 初始化失败：', err.message);
    process.exitCode = 1;
  }
}

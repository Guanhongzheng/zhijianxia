'use strict';

/**
 * db.js —— 基于 Node.js 内置 node:sqlite 的数据库封装
 *
 * 选型说明：
 *   使用内置 DatabaseSync（Node >= 22.5），不引入 better-sqlite3，
 *   避免 Windows 下原生模块编译失败，零编译即可运行。
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

/** 数据目录：server/data（首次运行自动创建） */
const DATA_DIR = path.join(__dirname, '..', 'data');
/** 数据库文件：server/data/zhijianxia.db */
const DB_FILE = path.join(DATA_DIR, 'zhijianxia.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

// WAL 模式提升并发读写表现；外键约束保证删除用户时级联清理
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/** 执行写语句，返回 { changes, lastInsertRowid } */
function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/** 查询单行，无结果返回 undefined */
function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

/** 查询多行 */
function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/** 简易事务封装：出错自动回滚 */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* 回滚失败时忽略，抛出原始错误 */ }
    throw err;
  }
}

/** 读取 settings 表中的配置项，不存在返回 undefined */
function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : undefined;
}

/** 写入（覆盖）settings 表中的配置项 */
function setSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value ?? '')
  );
}

/** 删除 settings 表中的配置项 */
function deleteSetting(key) {
  run('DELETE FROM settings WHERE key = ?', key);
}

module.exports = {
  db,
  run,
  get,
  all,
  tx,
  getSetting,
  setSetting,
  deleteSetting,
  DATA_DIR,
  DB_FILE,
};

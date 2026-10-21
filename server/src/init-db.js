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
 *   - 插件包 / 主题包种子写入**后端包目录**（server/packages/），不落数据库
 */

const fs = require('node:fs');
const path = require('node:path');

const { run, get, all } = require('./db');
const { hashPassword } = require('./auth');
const {
  validatePluginPackage,
  validateThemePack,
} = require('./routes/registry-validate');
const {
  ensureDirs,
  listPluginPackages,
  listThemePackages,
  writePluginPackage,
  writeThemePackage,
  PACKAGES_DIR,
} = require('./packages');

/** 项目根目录（server/src 的上上级） */
const ROOT_DIR = path.resolve(__dirname, '..', '..');
/** 插件包产物目录：<项目根>/dist-plugins */
const DIST_PLUGINS_DIR = path.join(ROOT_DIR, 'dist-plugins');

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
  `CREATE INDEX IF NOT EXISTS idx_friends_user     ON friends(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_friends_friend   ON friends(friend_uid)`,
  `CREATE INDEX IF NOT EXISTS idx_members_group    ON group_members(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_target  ON messages(scope, target, created_at)`,
];

/** 建表（幂等） */
function createSchema() {
  for (const sql of SCHEMA) run(sql);
  // 旧库中的包表已废弃（包仓库改为文件存储），清理掉
  run('DROP TABLE IF EXISTS plugin_packages');
  run('DROP TABLE IF EXISTS theme_packages');
}

/**
 * 内置主题包种子（配色与圆角阴影参考 src/lib/theme/types.ts 的 BUILTIN_THEME_PACKS）
 * 字段严格按「主题包结构」填写：id / name / light / dark / wallpaper
 * 另附 version / description / author / preview / tags 等展示用元信息
 */
const THEME_PACK_SEEDS = [
  {
    id: 'ink-default',
    name: '素墨',
    version: '1.0.0',
    description: '默认主题：靛蓝主色 + 柔和浅灰底，明暗两套配色均衡耐看。',
    author: '智简匣',
    preview: '🖋️',
    tags: ['默认', '靛蓝', '简约'],
    category: '综合',
    brand: { icon: '🖋️', name: '智简匣', tagline: '本地离线 AI 工具箱' },
    card: { style: 'elevated', borderWidth: 1 },
    nav: { style: 'flat', showIcon: true },
    light: {
      accent: '#4f6bed',
      accentSoft: '#eef1fe',
      card: '#ffffff',
      bg: '#f6f7f9',
      fg: '#1c1f24',
      mutedFg: '#6b7280',
      border: '#e6e8ec',
      shadow: 2,
    },
    dark: {
      accent: '#7d93ff',
      accentSoft: '#1e2333',
      card: '#171a20',
      bg: '#0f1115',
      fg: '#e8eaed',
      mutedFg: '#9aa1ad',
      border: '#262b34',
      shadow: 2,
    },
    wallpaper: {
      light: { kind: 'gradient', gradient: 'linear-gradient(135deg,#eef1fe 0%,#f6f7f9 60%)', veil: 0.9 },
      dark: { kind: 'gradient', gradient: 'linear-gradient(135deg,#141824 0%,#0f1115 60%)', veil: 0.9 },
    },
  },
  {
    id: 'moss',
    name: '青苔',
    version: '1.0.0',
    description: '自然绿意主题：苔绿主色搭配米白与深林底色，适合长时间阅读。',
    author: '智简匣',
    preview: '🌿',
    tags: ['自然', '绿色', '护眼'],
    category: '配色',
    brand: { icon: '🌿', name: '智简匣', tagline: '本地离线 AI 工具箱' },
    card: { style: 'elevated', borderWidth: 1, accentBar: true },
    nav: { style: 'flat', showIcon: true },
    light: {
      accent: '#0f9d76',
      accentSoft: '#e4f6f0',
      card: '#ffffff',
      bg: '#f4f8f6',
      fg: '#16241f',
      mutedFg: '#5f7a71',
      border: '#e0eae6',
      shadow: 1,
    },
    dark: {
      accent: '#3ddc9a',
      accentSoft: '#152a24',
      card: '#141c19',
      bg: '#0c1210',
      fg: '#e4f1ec',
      mutedFg: '#8aa79d',
      border: '#22302b',
      shadow: 1,
    },
    wallpaper: {
      light: { kind: 'gradient', gradient: 'linear-gradient(160deg,#e4f6f0 0%,#f4f8f6 70%)', veil: 0.88 },
      dark: { kind: 'gradient', gradient: 'linear-gradient(160deg,#0f2019 0%,#0c1210 70%)', veil: 0.9 },
    },
  },
  {
    id: 'violet-night',
    name: '夜堇',
    version: '1.0.0',
    description: '暗色紫调主题：堇紫主色搭配深紫夜色，柔和光晕适合夜间使用。',
    author: '智简匣',
    preview: '🌙',
    tags: ['暗色', '紫色', '夜间'],
    category: '综合',
    brand: { icon: '🌙', name: '智简匣', tagline: '本地离线 AI 工具箱' },
    card: { style: 'glass', borderWidth: 1 },
    nav: { style: 'glass', showIcon: true },
    light: {
      accent: '#8b5cf6',
      accentSoft: '#f1ebfe',
      card: '#ffffff',
      bg: '#f8f7fb',
      fg: '#221a33',
      mutedFg: '#6f6785',
      border: '#e8e4f0',
      shadow: 1,
    },
    dark: {
      accent: '#b794f6',
      accentSoft: '#241f36',
      card: '#191624',
      bg: '#100e18',
      fg: '#ece7f6',
      mutedFg: '#9a90b5',
      border: '#282238',
      shadow: 1,
    },
    wallpaper: {
      light: { kind: 'gradient', gradient: 'linear-gradient(150deg,#f1ebfe 0%,#f8f7fb 70%)', veil: 0.9 },
      dark: { kind: 'gradient', gradient: 'linear-gradient(150deg,#1b1530 0%,#100e18 70%)', veil: 0.9 },
    },
  },
];

/**
 * 读取 dist-plugins 目录下的 .plugin 产物，作为插件包种子
 * @returns {{id:string, name:string, version:string, pkg:object, text:string}[]}
 */
function readDistPlugins() {
  let files = [];
  try {
    files = fs.readdirSync(DIST_PLUGINS_DIR).filter((f) => f.endsWith('.plugin')).sort();
  } catch {
    // 目录不存在时跳过插件包种子
    return [];
  }

  const list = [];
  for (const file of files) {
    let text = '';
    let pkg = null;
    try {
      text = fs.readFileSync(path.join(DIST_PLUGINS_DIR, file), 'utf8');
      pkg = JSON.parse(text);
    } catch {
      // 单个文件解析失败不影响其它种子
      continue;
    }
    const check = validatePluginPackage(pkg);
    if (!check.ok) continue;
    list.push({ ...check.data, pkg, text });
  }
  return list;
}

/**
 * 写入插件包种子到后端包目录（幂等）：已存在同 id 则跳过，不覆盖用户后来上传的版本
 * @returns {number} 本次新增数量
 */
function seedPluginPackages() {
  ensureDirs();
  let created = 0;
  const existing = new Set(listPluginPackages().map((p) => p.id));

  for (const item of readDistPlugins()) {
    if (existing.has(item.id)) continue;
    const written = writePluginPackage(item.pkg);
    if (!written.ok) continue;
    created += 1;
  }
  return created;
}

/**
 * 写入主题包种子到后端包目录（幂等）：已存在同 id 则跳过
 * @returns {number} 本次新增数量
 */
function seedThemePackages() {
  ensureDirs();
  let created = 0;
  const existing = new Set(listThemePackages().map((t) => t.id));

  for (const pack of THEME_PACK_SEEDS) {
    const check = validateThemePack(pack);
    if (!check.ok) continue;
    if (existing.has(pack.id)) continue;

    const written = writeThemePackage(pack);
    if (!written.ok) continue;
    created += 1;
  }
  return created;
}

/**
 * 写入种子数据（幂等）：1 个管理员 + 1 条示例公告 + 插件包 + 主题包
 * @returns {{adminCreated:boolean, noticeCreated:boolean, pluginsCreated:number, themesCreated:number}}
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

  // 插件包 / 主题包仓库种子
  const pluginsCreated = seedPluginPackages();
  const themesCreated = seedThemePackages();

  return { adminCreated, noticeCreated, pluginsCreated, themesCreated };
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
    const pluginCount = listPluginPackages().length;
    const themeCount = listThemePackages().length;
    console.log('[init-db] 数据库初始化完成');
    console.log(`[init-db] 管理员${result.adminCreated ? '已创建' : '已存在，跳过'}（uid: ZJ-ADMIN01 / 密码: admin123）`);
    console.log(`[init-db] 示例公告${result.noticeCreated ? '已创建' : '已存在，跳过'}`);
    console.log(`[init-db] 插件包种子新增 ${result.pluginsCreated} 个（当前共 ${pluginCount} 个）`);
    console.log(`[init-db] 主题包种子新增 ${result.themesCreated} 个（当前共 ${themeCount} 个）`);
    console.log(`[init-db] 当前统计：用户 ${userCount} 个，公告 ${noticeCount} 条`);
    console.log(`[init-db] 包仓库目录：${PACKAGES_DIR}`);
    const { DB_FILE } = require('./db');
    console.log(`[init-db] 数据库文件：${DB_FILE}`);
  } catch (err) {
    console.error('[init-db] 初始化失败：', err.message);
    process.exitCode = 1;
  }
}

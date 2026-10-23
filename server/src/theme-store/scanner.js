'use strict';

/**
 * theme-store/scanner.js —— 主题目录扫描器
 *
 * ## 目录约定（数据即文件）
 *
 *   themes/
 *     └── <slug>/                    文件夹名即唯一 ID
 *         ├── theme.json             必需
 *         ├── cover.webp|jpg|png     可选（没有则用色块占位）
 *         ├── previews/*.webp|jpg|png 可选
 *         └── assets/                可选（壁纸等）
 *
 * ## 扫描规则
 *
 * - 只遍历 themes/ 的**直接子目录**，不递归进入子目录；
 * - 跳过 `.` 开头的目录与隐藏项；
 * - 缺 theme.json / JSON 解析失败 / 校验不通过 → **跳过并 console.warn**；
 * - fileSize = 递归累加该主题目录下所有文件的字节数；
 * - updatedAt = 目录的 mtime。
 *
 * ## 为什么不用 registry-validate 的 validateThemePack
 *
 * 主题仓库的「文件夹制」主题是**协议主题**（有 colors 五色板），
 * 而 registry 里的主题包还支持**旧版**（light/dark 双变体）。
 * 两者都要接受，所以这里用 `validateThemePack` 判定 ——
 * 它内部会按 `colors` 是否存在自动分流到对应分支。
 */

const fs = require('node:fs');
const path = require('node:path');

const { validateThemePack } = require('../routes/registry-validate');
const { detectScheme } = require('./scheme');

/** 主题根目录：server/packages/themes */
const THEMES_DIR = path.join(__dirname, '..', '..', 'packages', 'themes');

/** 合法 slug：只允许字母、数字、下划线、连字符 */
const SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * 封面图的查找顺序。
 *
 * webp 优先：同画质下体积约为 png 的 1/30~1/50（实测 3.6MB → 104KB），
 * 浏览器全支持；jpg / png 作为老主题的兜底。
 */
const COVER_EXTENSIONS = ['.webp', '.jpg', '.png'];

/** 缓存有效期：30 秒（避免每次请求都全量扫盘） */
const CACHE_TTL_MS = 30_000;

/**
 * 主题根目录。
 *
 * 做成**函数**而非常量：环境变量要在调用时读取，
 * 否则测试里改了 process.env 也不生效。
 */
function themesRoot() {
  const override = process.env.THEMES_DIR;
  if (override && override.trim()) {
    return path.resolve(override.trim());
  }
  return THEMES_DIR;
}

/**
 * 校验 slug。
 *
 * 这是**防路径穿越的第一道闸**：slug 会被拼进文件路径，
 * 因此只允许字母数字与 _-，从根本上排除 `..`、`/`、`\`、空格等。
 */
function isValidSlug(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && SLUG_PATTERN.test(s);
}

/**
 * 校验预览图文件名。
 *
 * 不允许含路径分隔符与 `..` —— 文件名只应是文件名。
 */
function isValidFileName(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 255) return false;
  if (s.includes('/') || s.includes('\\')) return false;
  if (s.includes('..')) return false;
  if (s.startsWith('.')) return false;
  return /^[a-zA-Z0-9._-]+$/.test(s);
}

/**
 * 安全地拼接主题目录下的路径。
 *
 * 这是**防路径穿越的第二道闸**（双保险）：
 * 即使第一道的正则被绕过或未来放宽，这里仍会断言
 * 最终路径必须位于该**主题目录**之内。
 *
 * ⚠️ 关键：不能只断言「在 themes/ 之内」，还必须断言「在该主题目录内」。
 * 反例：slug='win11'、rest=['..','..','cover.jpg'] 解析后落在
 * `themes/cover.jpg` —— 它仍在 themes/ 内，能通过 startsWith 检查，
 * 但它**属于别的目录**。
 *
 * ⚠️ 但**主题目录自身**是合法的（打包下载需要它）。
 * 所以 rest 为空时，只断言「等于该主题目录」。
 *
 * @param {string} slug 主题 slug
 * @param {...string} rest 目录内的相对路径片段
 * @returns {string|null} 绝对路径；越界时返回 null
 */
function safeJoin(slug, ...rest) {
  if (!isValidSlug(slug)) return null;
  for (const seg of rest) {
    if (typeof seg !== 'string' || seg.length === 0) return null;
    if (seg.includes('\0')) return null;
  }
  const root = themesRoot();
  const themeDir = path.resolve(root, slug);
  const target = path.resolve(themeDir, ...rest);

  // 双重保险 1：必须仍在 themes/ 之内
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  // 双重保险 2：必须仍在该主题目录内。
  // rest 为空时，target 就是主题目录本身 —— 这是合法的（打包下载要用）。
  if (rest.length === 0) {
    return target === themeDir ? target : null;
  }
  if (!target.startsWith(themeDir + path.sep)) return null;
  return target;
}

/**
 * 递归累加目录内所有文件的字节数。
 *
 * 符号链接不跟随（避免环与越界）；遇到不可读的文件跳过并计数为 0。
 */
async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        total += (await fs.promises.stat(full)).size;
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  return total;
}

/**
 * 探测封面图文件名。
 *
 * 按 webp → jpg → png 顺序取第一个存在的。
 *
 * ⚠️ webp 排在最前是有意的：同画质下 webp 体积约为 png 的 1/30~1/50，
 * 主题仓库入库时体积差异巨大（实测 3.6MB → 104KB），而浏览器全支持 webp。
 * png 留作兜底 —— 用户手工放进来的老主题可能只有 png。
 */
async function findCover(themeDir) {
  for (const ext of COVER_EXTENSIONS) {
    const name = `cover${ext}`;
    try {
      const st = await fs.promises.stat(path.join(themeDir, name));
      if (st.isFile()) return name;
    } catch {
      /* 继续找下一个 */
    }
  }
  return null;
}

/**
 * 列出预览图（previews/ 下的图片）。
 * @returns {Promise<string[]>} 文件名数组（已排序）
 */
async function listPreviews(themeDir) {
  const out = [];
  try {
    const entries = await fs.promises.readdir(path.join(themeDir, 'previews'), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!isValidFileName(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      out.push(entry.name);
    }
  } catch {
    /* 没有 previews/ 目录是正常的 */
  }
  return out.sort();
}

/**
 * 读取并校验单个主题目录。
 * 任何不满足条件的情况都返回 null（调用方负责 warn）。
 */
async function readTheme(dirPath, slug) {  const themeDir = path.join(dirPath, slug);

  // ---- theme.json 必需 ----
  let raw;
  try {
    raw = await fs.promises.readFile(path.join(themeDir, 'theme.json'), 'utf8');
  } catch {
    return null;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;

  // ---- 校验：必须是合法的协议主题（或旧版双变体主题）----
  const check = validateThemePack(json);
  if (!check.ok) return null;

  // ---- 展示名：name 缺失则回退到 slug（不丢弃整个主题）----
  const name =
    typeof json.name === 'string' && json.name.trim() ? json.name.trim() : slug;

  // ---- 目录 mtime ----
  let updatedAt = 0;
  try {
    updatedAt = (await fs.promises.stat(themeDir)).mtimeMs;
  } catch {
    updatedAt = 0;
  }

  return {
    slug,
    name,
    author: typeof json.author === 'string' ? json.author : '',
    description: typeof json.description === 'string' ? json.description : '',
    protocol: typeof json.protocol === 'number' ? json.protocol : 1,
    version: typeof json.version === 'string' ? json.version : '0.0.0',
    category: check.data.category,
    tags: Array.isArray(check.data.tags) ? check.data.tags : [],
    scheme: detectScheme(json),
    coverFile: await findCover(themeDir),
    previews: await listPreviews(themeDir),
    fileSize: await dirSize(themeDir),
    updatedAt,
    themeDir,
  };
}

/* -------------------------------------------------------------------------- */
/* 模块级缓存                                                                  */
/* -------------------------------------------------------------------------- */

let cache = null;

/** 强制下次 scanThemes 重新扫盘（测试与「立即刷新」用） */
function invalidateThemesCache() {
  cache = null;
}

/**
 * 扫描 themes/ 目录，返回所有合法主题的元信息。
 *
 * 结果做**模块级内存缓存**，有效期 30 秒 —— 避免每次请求都全量扫盘。
 * 增量更新走 watcher（见 watcher.js），它会调用 invalidateThemesCache()。
 */
async function scanThemes() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.items;
  }

  const root = themesRoot();
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (err) {
    console.warn(`[themes] 无法读取主题目录 ${root}：${err.message}`);
    return [];
  }

  // 只取直接子目录，跳过 . 开头与隐藏项
  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith('.') && isValidSlug(e.name),
  );

  const results = await Promise.all(
    dirs.map(async (entry) => {
      const slug = entry.name;
      const meta = await readTheme(root, slug);
      if (!meta) {
        console.warn(
          `[themes] 跳过目录 "${slug}"：缺少 theme.json、JSON 解析失败或主题校验不通过`,
        );
        return null;
      }
      return meta;
    }),
  );

  const items = results.filter(Boolean);
  cache = { items, at: now };
  return items;
}

module.exports = {
  THEMES_DIR,
  SLUG_PATTERN,
  COVER_EXTENSIONS,
  CACHE_TTL_MS,
  themesRoot,
  isValidSlug,
  isValidFileName,
  safeJoin,
  dirSize,
  findCover,
  listPreviews,
  readTheme,
  invalidateThemesCache,
  scanThemes,
};

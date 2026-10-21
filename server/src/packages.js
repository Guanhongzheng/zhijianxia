'use strict';

/**
 * packages.js —— 后端包仓库（文件存储）
 *
 * 设计要点：
 * - **文件夹即仓库**：插件包放 `server/packages/plugins/*.plugin`，
 *   主题包放 `server/packages/themes/*.theme`，文件是唯一权威来源。
 * - 包文件本身就是「信封 + 载荷」结构（.plugin / .theme），
 *   与前端 src/lib/theme/packager.ts、src/plugins/packager.ts 的格式一致。
 * - 列表接口靠扫描目录 + 解析信封头部得到摘要，下载接口直接回传文件内容。
 * - 上传即写文件，删除即删文件；重名同 id 覆盖。
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  validatePluginPackage,
  validateThemePack,
  normalizeTags,
} = require('./routes/registry-validate');

/** 仓库根目录：server/packages */
const PACKAGES_DIR = path.join(__dirname, '..', 'packages');
/** 插件包目录 */
const PLUGINS_DIR = path.join(PACKAGES_DIR, 'plugins');
/** 主题包目录 */
const THEMES_DIR = path.join(PACKAGES_DIR, 'themes');

/** 插件包格式标识 */
const PLUGIN_FORMAT = 'zhijianxia.plugin';
/** 主题包格式标识 */
const THEME_FORMAT = 'zhijianxia.theme';
/** 信封格式版本 */
const FORMAT_VERSION = 1;

/** 确保目录存在 */
function ensureDirs() {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  fs.mkdirSync(THEMES_DIR, { recursive: true });
}

/**
 * 读取目录下的包文件列表
 * @param {string} dir 目录
 * @param {string} ext 扩展名（含点，如 '.plugin'）
 * @returns {string[]} 文件绝对路径，按文件名排序
 */
function listPackageFiles(dir, ext) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(ext));
  } catch {
    return [];
  }
  names.sort();
  return names.map((n) => path.join(dir, n));
}

/**
 * 读取并解析包文件
 * @param {string} file 文件路径
 * @returns {{ok:true, data:object}|{ok:false, error:string}}
 */
function readPackageFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, error: '包文件读取失败' };
  }
  try {
    return { ok: true, data: { text, json: JSON.parse(text) } };
  } catch {
    return { ok: false, error: '包文件不是有效的 JSON' };
  }
}

/**
 * 计算包体积（KB）
 * @param {string} text 文件原文
 * @returns {number}
 */
function calcSizeKB(text) {
  return Math.round(Buffer.byteLength(text, 'utf8') / 1024);
}

/**
 * 插件包文件名
 * @param {string} id 插件 id
 * @param {string} version 版本
 * @returns {string}
 */
function pluginFileName(id, version) {
  return `${id}-${version}.plugin`;
}

/**
 * 主题包文件名
 * @param {string} id 主题 id
 * @param {string} version 版本
 * @returns {string}
 */
function themeFileName(id, version) {
  return `${id}-${version}.theme`;
}

/**
 * 列出仓库中的全部插件包摘要
 * @returns {object[]}
 */
function listPluginPackages() {
  ensureDirs();
  const list = [];
  for (const file of listPackageFiles(PLUGINS_DIR, '.plugin')) {
    const parsed = readPackageFile(file);
    if (!parsed.ok) continue;
    const pkg = parsed.data.json;
    const check = validatePluginPackage(pkg);
    if (!check.ok) continue;
    const d = check.data;
    list.push({
      id: d.id,
      name: d.name,
      version: d.version,
      category: d.category,
      description: d.description,
      author: d.author,
      preview: d.preview,
      tags: d.tags,
      sizeKB: calcSizeKB(parsed.data.text),
      builtin: d.builtin === 1,
      offline: d.offline === 1,
      minCoreVersion: d.minCoreVersion,
      createdAt: statCreatedAt(file),
    });
  }
  return list;
}

/**
 * 列出主题目录（my-theme/）下的文件夹式主题包。
 *
 * ## 为什么有两种形态
 *
 * 主题包历史上是「单文件信封」`{id}-{version}.theme`，现在新增**文件夹制**：
 *
 *   my-theme/
 *   └── <theme-id>/← 文件夹名必须 == theme.json 的 id
 *       ├── theme.json      必需
 *       ├── theme.css       必需
 *       └── assets/         可选（壁纸 / 视频 / BGM）
 *
 * 文件夹制的优势：资源与配置同处一个目录，可直接拷贝分发，
 * 不必把二进制塞进 JSON 变成 base64。
 *
 * 两种形态共存，扫描时先列文件夹再列 .theme 文件，id 冲突时文件夹优先。
 *
 * @returns {{dir:string, id:string}[]} 按 id 排序
 */
function listThemeDirs() {
  let names = [];
  try {
    names = fs
      .readdirSync(THEMES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort()) {
    const dir = path.join(THEMES_DIR, name);
    // 目录内必须有 theme.json 才算一个主题包，否则跳过
    if (fs.existsSync(path.join(dir, 'theme.json'))) {
      out.push({ dir, id: name });
    }
  }
  return out;
}

/**
 * 读取文件夹式主题包。
 *
 * 会做schema 校验（id 与文件夹名必须一致，否则拒绝加载 ——
 * 这一条能防止多个主题互相覆盖或混淆）。
 *
 * @param {string} dir 主题目录绝对路径
 * @param {string} dirName 目录名（用于校验 id 一致性）
 * @returns {{ok:true, data:object}|{ok:false, error:string}}
 */
function readThemeDir(dir, dirName) {
  const jsonPath = path.join(dir, 'theme.json');
  let text;
  try {
    text = fs.readFileSync(jsonPath, 'utf8');
  } catch {
    return { ok: false, error: 'theme.json 读取失败' };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'theme.json 不是有效的 JSON' };
  }

  // **关键约束**：文件夹名必须与 theme.json 的 id 完全一致
  if (json.id !== dirName) {
    return {
      ok: false,
      error: `文件夹名 "${dirName}" 与 theme.json 的 id "${json.id}" 不一致`,
    };
  }

  // theme.css 必需
  const cssPath = path.join(dir, 'theme.css');
  if (!fs.existsSync(cssPath)) {
    return { ok: false, error: '缺少必需的 theme.css' };
  }
  let css = '';
  try {
    css = fs.readFileSync(cssPath, 'utf8');
  } catch {
    return { ok: false, error: 'theme.css 读取失败' };
  }

  // 收集资源（相对 theme.json 的路径）
  const assets = {};
  const assetsDir = path.join(dir, 'assets');
  let assetFiles = [];
  try {
    assetFiles = fs.readdirSync(assetsDir).filter((f) =>
      fs.statSync(path.join(assetsDir, f)).isFile(),
    );
  } catch {
    // assets/ 可选，不存在不算错
  }
  for (const f of assetFiles) {
    const stat = fs.statSync(path.join(assetsDir, f));
    assets[`assets/${f}`] = {
      size: stat.size,
      // 资源以独立 URL 提供；路径与 theme.json 中的相对路径保持一致
      url: `/theme-assets/${dirName}/assets/${f}`,
    };
  }

  return {
    ok: true,
    data: {
      text,
      json,
      css,
      assets,
      dir,
      sizeKB: calcSizeKB(text),
    },
  };
}

/**
 * 列出仓库中的全部主题包摘要（文件夹制 + 单文件信封制）
 * @returns {object[]}
 */
function listThemePackages() {
  ensureDirs();
  const list = [];
  const seen = new Set();

  // 1) 文件夹制（优先级更高）
  for (const { dir, id } of listThemeDirs()) {
    const parsed = readThemeDir(dir, id);
    if (!parsed.ok) {
      console.warn(`[zj] 跳过主题目录 ${id}：${parsed.error}`);
      continue;
    }
    const d = parsed.data.json;
    const check = validateThemePack(d);
    if (!check.ok) {
      console.warn(`[zj] 跳过主题 ${id}：${check.error}`);
      continue;
    }
    seen.add(d.id);
    list.push({
      id: d.id,
      name: d.name,
      version: typeof d.version === 'string' ? d.version : '1.0.0',
      category: check.data.category,
      description: typeof d.description === 'string' ? d.description : '',
      author: typeof d.author === 'string' ? d.author : '',
      preview: '🎨',
      tags: check.data.tags,
      createdAt: statCreatedAt(path.join(dir, 'theme.json')),
      protocol: typeof d.protocol === 'number' ? d.protocol : 1,
      source: 'dir',
    });
  }

  // 2) 单文件信封制（向后兼容）
  for (const file of listPackageFiles(THEMES_DIR, '.theme')) {
    const parsed = readPackageFile(file);
    if (!parsed.ok) continue;
    const pkg = parsed.data.json;
    const pack = pkg.pack ?? pkg;
    // 与文件夹制 id 冲突时以文件夹为准
    if (seen.has(pack.id)) continue;
    const check = validateThemePack(pack);
    if (!check.ok) continue;
    const d = check.data;
    const manifest = pkg.manifest ?? {};
    list.push({
      id: d.id,
      name: d.name,
      version: manifest.version || d.version,
      category: d.category,
      description: manifest.description ?? d.description,
      author: manifest.author ?? d.author,
      preview: manifest.preview ?? d.preview,
      tags: manifest.tags?.length ? manifest.tags : d.tags,
      createdAt: statCreatedAt(file),
      protocol: 1,
      source: 'file',
    });
  }

  return list;
}

/**
 * 读取指定插件包文件内容
 * @param {string} id 插件 id
 * @returns {{ok:true, data:{json:object, text:string}}|{ok:false, error:string}}
 */
function readPluginPackage(id) {
  ensureDirs();
  const found = listPackageFiles(PLUGINS_DIR, '.plugin').find((f) => {
    const parsed = readPackageFile(f);
    if (!parsed.ok) return false;
    const manifest = parsed.data.json.manifest ?? {};
    return manifest.id === id;
  });
  if (!found) return { ok: false, error: '插件包不存在' };
  const parsed = readPackageFile(found);
  if (!parsed.ok) return parsed;
  return { ok: true, data: parsed.data };
}

/**
 * 读取指定主题包内容（同时支持文件夹制与单文件信封制）
 * @param {string} id 主题 id
 * @returns {{ok:true, data:object}|{ok:false, error:string}}
 */
function readThemePackage(id) {
  ensureDirs();

  // 1) 文件夹制优先
  const dirEntry = listThemeDirs().find((e) => e.id === id);
  if (dirEntry) {
    const parsed = readThemeDir(dirEntry.dir, dirEntry.id);
    if (parsed.ok) return { ok: true, data: parsed.data };
  }

  // 2) 回退到单文件信封制
  const found = listPackageFiles(THEMES_DIR, '.theme').find((f) => {
    const parsed = readPackageFile(f);
    if (!parsed.ok) return false;
    const pkg = parsed.data.json;
    const pack = pkg.pack ?? pkg;
    return (pack.id ?? pkg.manifest?.id) === id;
  });
  if (!found) return { ok: false, error: '主题包不存在' };
  const parsed = readPackageFile(found);
  if (!parsed.ok) return parsed;
  return { ok: true, data: parsed.data };
}

/**
 * 写入插件包文件（同 id 覆盖）
 * @param {object} pkg .plugin 信封
 * @returns {{ok:true, data:{id:string, file:string}}|{ok:false, error:string}}
 */
function writePluginPackage(pkg) {
  ensureDirs();
  const check = validatePluginPackage(pkg);
  if (!check.ok) return { ok: false, error: check.error };
  const d = check.data;
  const file = path.join(PLUGINS_DIR, pluginFileName(d.id, d.version));
  const text = JSON.stringify(pkg, null, 2);
  try {
    fs.writeFileSync(file, text, 'utf8');
  } catch (err) {
    return { ok: false, error: `插件包写入失败：${err.message}` };
  }
  return { ok: true, data: { id: d.id, file } };
}

/**
 * 去掉配色块中的 radius（圆角已改为全局设置，不再由主题包携带）
 * @param {object} variant 配色块
 * @returns {object}
 */
function stripRadius(variant) {
  if (!variant || typeof variant !== 'object') return variant;
  const { radius, ...rest } = variant;
  return rest;
}

/**
 * 写入主题包文件（同 id 覆盖）
 *
 * 兼容两种入参：
 * 1. 完整信封 `{ format, formatVersion, manifest, pack }`
 * 2. 裸主题定义 `{ id, name, light, dark, ... }`
 *
 * 统一落盘为标准信封结构。
 * @param {object} input 主题包
 * @returns {{ok:true, data:{id:string, file:string}}|{ok:false, error:string}}
 */
function writeThemePackage(input) {
  ensureDirs();
  const isEnvelope =
    input && typeof input === 'object' && input.pack && typeof input.pack === 'object';
  const pack = isEnvelope ? input.pack : input;
  const check = validateThemePack(pack);
  if (!check.ok) return { ok: false, error: check.error };
  const d = check.data;

  const manifest = (isEnvelope && input.manifest) || {};
  const version =
    (typeof manifest.version === 'string' && manifest.version) ||
    (typeof pack.version === 'string' && pack.version) ||
    '1.0.0';

  const envelope = {
    format: THEME_FORMAT,
    formatVersion: FORMAT_VERSION,
    manifest: {
      id: d.id,
      name: d.name,
      version,
      description: manifest.description ?? d.description,
      author: manifest.author ?? d.author,
      preview: manifest.preview ?? d.preview,
      tags: manifest.tags?.length ? manifest.tags : d.tags,
      category: d.category,
    },
    pack: {
      ...pack,
      id: d.id,
      name: d.name,
      version,
      description: manifest.description ?? d.description,
      author: manifest.author ?? d.author,
      preview: manifest.preview ?? d.preview,
      tags: manifest.tags?.length ? manifest.tags : d.tags,
      category: d.category,
      // 圆角已从主题包解绑（改为全局设置）—— 落盘时剥离 radius
      light: stripRadius(pack.light),
      dark: stripRadius(pack.dark),
    },
  };

  const file = path.join(THEMES_DIR, themeFileName(d.id, version));
  try {
    fs.writeFileSync(file, JSON.stringify(envelope, null, 2), 'utf8');
  } catch (err) {
    return { ok: false, error: `主题包写入失败：${err.message}` };
  }
  return { ok: true, data: { id: d.id, file } };
}

/**
 * 删除插件包文件
 * @param {string} id 插件 id
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function deletePluginPackage(id) {
  ensureDirs();
  const target = listPackageFiles(PLUGINS_DIR, '.plugin').find((f) => {
    const parsed = readPackageFile(f);
    if (!parsed.ok) return false;
    return (parsed.data.json.manifest ?? {}).id === id;
  });
  if (!target) return { ok: false, error: '插件包不存在' };
  try {
    fs.unlinkSync(target);
  } catch (err) {
    return { ok: false, error: `插件包删除失败：${err.message}` };
  }
  return { ok: true };
}

/**
 * 删除主题包文件
 * @param {string} id 主题 id
 * @returns {{ok:true}|{ok:false, error:string}}
 */
function deleteThemePackage(id) {
  ensureDirs();
  const target = listPackageFiles(THEMES_DIR, '.theme').find((f) => {
    const parsed = readPackageFile(f);
    if (!parsed.ok) return false;
    const pkg = parsed.data.json;
    const pack = pkg.pack ?? pkg;
    return (pack.id ?? pkg.manifest?.id) === id;
  });
  if (!target) return { ok: false, error: '主题包不存在' };
  try {
    fs.unlinkSync(target);
  } catch (err) {
    return { ok: false, error: `主题包删除失败：${err.message}` };
  }
  return { ok: true };
}

/**
 * 读取文件创建时间（毫秒时间戳）
 * @param {string} file 文件路径
 * @returns {number}
 */
function statCreatedAt(file) {
  try {
    return Math.round(fs.statSync(file).mtimeMs);
  } catch {
    return Date.now();
  }
}

module.exports = {
  PACKAGES_DIR,
  PLUGINS_DIR,
  THEMES_DIR,
  PLUGIN_FORMAT,
  THEME_FORMAT,
  ensureDirs,
  listPluginPackages,
  listThemePackages,
  readPluginPackage,
  readThemePackage,
  writePluginPackage,
  writeThemePackage,
  deletePluginPackage,
  deleteThemePackage,
  normalizeTags,
};

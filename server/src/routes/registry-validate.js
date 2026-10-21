'use strict';

/**
 * registry-validate.js —— 插件包 / 主题包的合法性校验
 *
 * 被 routes/registry.js（上传接口）与 init-db.js（种子写入）共用，
 * 保证「种子数据」与「用户上传数据」使用同一套校验规则。
 *
 * 约定：所有校验函数返回 { ok: true, data } 或 { ok: false, error }，
 *       error 一律是可直接展示给用户的中文提示。
 */

/** 插件包格式标识 */
const PLUGIN_FORMAT = 'zhijianxia.plugin';

/** 插件 / 主题 id 规则：kebab-case，小写字母、数字、连字符 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** semver 规则，如 1.0.0 / 1.2.3-beta.1 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** 颜色规则：#rrggbb 或 #rrggbbaa */
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 主题配色必填的颜色字段 */
const THEME_COLOR_FIELDS = ['accent', 'accentSoft', 'card', 'bg', 'fg', 'mutedFg', 'border'];

/**
 * 把 tags 归一化为字符串数组
 * @param {unknown} value 可能是数组或逗号分隔字符串
 * @returns {string[]}
 */
function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/**
 * 把字符串数组拼成数据库存储用的逗号分隔串
 * @param {string[]} tags
 * @returns {string}
 */
function joinTags(tags) {
  return normalizeTags(tags).join(',');
}

/**
 * 把数据库中的逗号分隔串还原为字符串数组
 * @param {string} raw
 * @returns {string[]}
 */
function splitTags(raw) {
  return normalizeTags(raw);
}

/**
 * 校验单个主题配色块（light / dark）
 * @param {object} variant
 * @param {string} label 字段名（light / dark），用于错误提示
 * @returns {string|null} 错误提示，通过时返回 null
 */
function validateThemeVariant(variant, label) {
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
    return `主题包缺少 ${label} 配色`;
  }
  for (const field of THEME_COLOR_FIELDS) {
    const value = variant[field];
    if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
      return `主题包 ${label}.${field} 颜色不合法："${value}"，应为 #rrggbb 或 #rrggbbaa`;
    }
  }
  const radius = variant.radius;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0 || radius > 48) {
    return `主题包 ${label}.radius 不合法："${radius}"，应为 0-48 的数字`;
  }
  const shadow = variant.shadow;
  if (!Number.isInteger(shadow) || shadow < 0 || shadow > 3) {
    return `主题包 ${label}.shadow 不合法："${shadow}"，应为 0-3 的整数`;
  }
  return null;
}

/**
 * 校验插件包（.plugin 原文对象）
 * @param {object} pkg
 * @returns {{ok:true, data:object}|{ok:false, error:string}}
 */
function validatePluginPackage(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return { ok: false, error: '插件包格式不正确：package 必须是一个对象' };
  }
  if (pkg.format !== undefined && pkg.format !== PLUGIN_FORMAT) {
    return { ok: false, error: `插件包 format 不合法："${pkg.format}"，应为 "${PLUGIN_FORMAT}"` };
  }
  const manifest = pkg.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: '插件包缺少 manifest（插件清单）' };
  }
  if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) {
    return { ok: false, error: `插件 id 不合法："${manifest.id}"，只能包含小写字母、数字与连字符` };
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    return { ok: false, error: '插件 name（名称）不能为空' };
  }
  if (typeof manifest.version !== 'string' || !SEMVER_PATTERN.test(manifest.version)) {
    return { ok: false, error: `插件 version 不合法："${manifest.version}"，应为语义化版本（如 1.0.0）` };
  }
  if (typeof manifest.category !== 'string' || !manifest.category.trim()) {
    return { ok: false, error: '插件 category（分类）不能为空' };
  }
  if (!pkg.core || typeof pkg.core !== 'object' || typeof pkg.core.minVersion !== 'string' || !pkg.core.minVersion.trim()) {
    return { ok: false, error: '插件包缺少 core.minVersion（最低内核版本）' };
  }

  const tags = normalizeTags(manifest.tags);
  return {
    ok: true,
    data: {
      id: manifest.id,
      name: manifest.name.trim(),
      version: manifest.version,
      category: manifest.category.trim(),
      description: typeof manifest.description === 'string' ? manifest.description : '',
      author: typeof manifest.author === 'string' ? manifest.author : '',
      preview: typeof manifest.preview === 'string' && manifest.preview ? manifest.preview : '🧩',
      tags,
      builtin: manifest.builtin === true ? 1 : 0,
      offline: manifest.offline === false ? 0 : 1,
      minCoreVersion:
        typeof manifest.minCoreVersion === 'string' && manifest.minCoreVersion
          ? manifest.minCoreVersion
          : pkg.core.minVersion,
    },
  };
}

/**
 * 校验主题包
 * @param {object} pack
 * @returns {{ok:true, data:object}|{ok:false, error:string}}
 */
function validateThemePack(pack) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return { ok: false, error: '主题包格式不正确：pack 必须是一个对象' };
  }
  if (typeof pack.id !== 'string' || !ID_PATTERN.test(pack.id)) {
    return { ok: false, error: `主题包 id 不合法："${pack.id}"，只能包含小写字母、数字与连字符` };
  }
  if (typeof pack.name !== 'string' || !pack.name.trim()) {
    return { ok: false, error: '主题包 name（名称）不能为空' };
  }
  if (pack.version !== undefined && (typeof pack.version !== 'string' || !SEMVER_PATTERN.test(pack.version))) {
    return { ok: false, error: `主题包 version 不合法："${pack.version}"，应为语义化版本（如 1.0.0）` };
  }
  const lightError = validateThemeVariant(pack.light, 'light');
  if (lightError) return { ok: false, error: lightError };
  const darkError = validateThemeVariant(pack.dark, 'dark');
  if (darkError) return { ok: false, error: darkError };
  if (pack.wallpaper !== undefined && (typeof pack.wallpaper !== 'object' || pack.wallpaper === null || Array.isArray(pack.wallpaper))) {
    return { ok: false, error: '主题包 wallpaper 不合法：应为对象' };
  }

  return {
    ok: true,
    data: {
      id: pack.id,
      name: pack.name.trim(),
      version: typeof pack.version === 'string' ? pack.version : '1.0.0',
      description: typeof pack.description === 'string' ? pack.description : '',
      author: typeof pack.author === 'string' ? pack.author : '',
      preview: typeof pack.preview === 'string' && pack.preview ? pack.preview : '🎨',
      tags: normalizeTags(pack.tags),
    },
  };
}

module.exports = {
  PLUGIN_FORMAT,
  ID_PATTERN,
  SEMVER_PATTERN,
  COLOR_PATTERN,
  THEME_COLOR_FIELDS,
  normalizeTags,
  joinTags,
  splitTags,
  validatePluginPackage,
  validateThemePack,
};

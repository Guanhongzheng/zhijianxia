/**
 * 智简匣 · 插件包（.plugin）打包与解析
 *
 * .plugin 采用 JSON 格式，便于在浏览器端直接 import / export：
 * {
 *   "format": "zhijianxia.plugin",
 *   "formatVersion": 1,
 *   "manifest": { ... },
 *   "core": { "minVersion": "1.0.0" },
 *   "entry": { "kind": "esm", "source": "..." }   // 可选
 * }
 *
 * 导入时依次校验：
 * 1. 文件能否解析为 JSON
 * 2. format / formatVersion 是否受支持
 * 3. manifest.id 是否为合法 kebab-case
 * 4. manifest.version 是否为合法 semver
 * 5. 与当前内核版本是否兼容
 * 任何一步不通过都会返回中文错误提示，插件不会被加载。
 */

import {
  PLUGIN_FORMAT,
  PLUGIN_FORMAT_VERSION,
  type PluginManifest,
  type PluginPackage,
  type PluginPackageEntry,
  type PluginPackageResult,
} from './types';

/** 当前内核版本。插件的 minCoreVersion 与之比较 */
export const CORE_VERSION = '1.0.0';

/** 插件 id 规则：小写字母、数字、连字符 */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** semver 规则：主版本.次版本.修订号，可带预发布/构建后缀 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** 校验插件 id 是否合法 */
export function isValidPluginId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && ID_PATTERN.test(id);
}

/** 校验版本号是否为合法 semver */
export function isValidSemver(version: unknown): version is string {
  return typeof version === 'string' && SEMVER_PATTERN.test(version);
}

/**
 * 比较两个 semver 版本号。
 * @returns a < b 返回 -1，a === b 返回 0，a > b 返回 1
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return {
      major: parts[0] ?? 0,
      minor: parts[1] ?? 0,
      patch: parts[2] ?? 0,
      pre: pre ?? '',
    };
  };

  const left = parse(a);
  const right = parse(b);

  if (left.major !== right.major) return left.major > right.major ? 1 : -1;
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1;
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1;

  // 预发布版本视为低于正式版本
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

/**
 * 判断插件包是否与当前内核兼容。
 * @param minCoreVersion 插件声明的最低内核版本
 * @param coreVersion 当前内核版本，默认为 CORE_VERSION
 */
export function isCoreCompatible(
  minCoreVersion: string | undefined,
  coreVersion: string = CORE_VERSION,
): boolean {
  if (!minCoreVersion) return true;
  if (!isValidSemver(minCoreVersion)) return false;
  if (!isValidSemver(coreVersion)) return false;
  return compareSemver(minCoreVersion, coreVersion) <= 0;
}

/** 构造一个插件包 */
export function createPluginPackage(
  manifest: PluginManifest,
  options: {
    entry?: PluginPackageEntry;
    assets?: Record<string, string>;
    minCoreVersion?: string;
  } = {},
): PluginPackage {
  return {
    format: PLUGIN_FORMAT,
    formatVersion: PLUGIN_FORMAT_VERSION,
    manifest,
    core: {
      minVersion: options.minCoreVersion ?? manifest.minCoreVersion ?? '0.0.1',
    },
    ...(options.entry ? { entry: options.entry } : {}),
    ...(options.assets ? { assets: options.assets } : {}),
    exportedAt: new Date().toISOString(),
  };
}

/**
 * 把插件包序列化为 JSON 文本。
 * @param pretty 是否格式化输出
 */
export function serializePluginPackage(pkg: PluginPackage, pretty = true): string {
  return JSON.stringify(pkg, null, pretty ? 2 : 0);
}

/**
 * 解析并校验 .plugin 文本。
 * 失败时返回 { ok: false, error: '中文提示' }。
 */
export function parsePluginPackage(
  text: string,
  coreVersion: string = CORE_VERSION,
): PluginPackageResult<PluginPackage> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: '插件包内容为空，无法解析' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '插件包不是合法的 JSON 文件' };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '插件包格式不正确：顶层必须是对象' };
  }

  const pkg = raw as Partial<PluginPackage>;

  if (pkg.format !== PLUGIN_FORMAT) {
    return {
      ok: false,
      error: `不是智简匣插件包：format 应为 "${PLUGIN_FORMAT}"，实际为 "${String(pkg.format)}"`,
    };
  }

  if (typeof pkg.formatVersion !== 'number' || !Number.isInteger(pkg.formatVersion)) {
    return { ok: false, error: '插件包缺少合法的 formatVersion 字段' };
  }

  if (pkg.formatVersion > PLUGIN_FORMAT_VERSION) {
    return {
      ok: false,
      error: `插件包版本过高：需要 ${pkg.formatVersion}，当前内核仅支持到 ${PLUGIN_FORMAT_VERSION}，请升级智简匣`,
    };
  }

  const manifest = pkg.manifest;
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, error: '插件包缺少 manifest 字段' };
  }

  if (!isValidPluginId(manifest.id)) {
    return {
      ok: false,
      error: `插件 id 非法："${String(manifest.id)}"，只允许小写字母、数字和连字符（如 my-plugin）`,
    };
  }

  if (!isValidSemver(manifest.version)) {
    return {
      ok: false,
      error: `插件版本号非法："${String(manifest.version)}"，应使用语义化版本（如 1.0.0）`,
    };
  }

  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    return { ok: false, error: '插件清单缺少 name 字段' };
  }

  if (typeof manifest.description !== 'string' || manifest.description.trim().length === 0) {
    return { ok: false, error: '插件清单缺少 description 字段' };
  }

  const declaredMin = pkg.core?.minVersion ?? manifest.minCoreVersion;
  if (declaredMin !== undefined && !isValidSemver(declaredMin)) {
    return {
      ok: false,
      error: `插件声明的最低内核版本非法："${String(declaredMin)}"`,
    };
  }

  if (!isCoreCompatible(declaredMin, coreVersion)) {
    return {
      ok: false,
      error: `插件不兼容当前内核：需要内核版本 ≥ ${String(declaredMin)}，当前为 ${coreVersion}，请升级智简匣`,
    };
  }

  if (pkg.entry) {
    const kind = pkg.entry.kind;
    if (kind !== 'esm' && kind !== 'cjs' && kind !== 'url') {
      return { ok: false, error: `插件入口类型非法："${String(kind)}"` };
    }
    if (kind === 'url' && !pkg.entry.url) {
      return { ok: false, error: '插件入口为 url 类型时必须提供 url 字段' };
    }
    if ((kind === 'esm' || kind === 'cjs') && !pkg.entry.source) {
      return { ok: false, error: '插件入口缺少 source 字段' };
    }
  }

  return { ok: true, value: pkg as PluginPackage };
}

/**
 * 导出一个插件包为可下载的 JSON 文本。
 */
export function exportPluginPackage(
  manifest: PluginManifest,
  options: { entry?: PluginPackageEntry; assets?: Record<string, string> } = {},
): string {
  return serializePluginPackage(createPluginPackage(manifest, options));
}

/**
 * 生成浏览器端下载用的文件名。
 */
export function pluginPackageFileName(manifest: PluginManifest): string {
  return `${manifest.id}-${manifest.version}.plugin`;
}

/**
 * 在浏览器中触发下载 .plugin 文件。
 * 非浏览器环境返回 false。
 */
export function downloadPluginPackage(pkg: PluginPackage, fileName?: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const blob = new Blob([serializePluginPackage(pkg)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName ?? pluginPackageFileName(pkg.manifest);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * 智简匣 · 插件内核自检脚本
 *
 * 验证插件内核的核心行为（不依赖 React 运行时）：
 * 1. 注册表：注册 / 注销 / 查询 / 订阅
 * 2. 打包器：合法包通过、非法 id / 版本 / 内核不兼容被拒绝
 * 3. semver 比较
 * 4. 存储命名空间隔离
 * 5. 预装插件与可下载插件清单完整性
 *
 * 用法：node scripts/verify-plugins.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

/** 插件 id 规则 */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** semver 规则 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** 断言 */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** 断言相等 */
function checkEqual(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/**
 * 把 TS 源码转译为 CommonJS 并在沙箱中执行。
 * 用于测试 src/plugins 下的纯逻辑模块（不依赖 React）。
 */
/** 沙箱已加载模块的缓存（按绝对路径） */
const moduleCache = new Map();

/**
 * 加载单个 TS 模块并返回其 exports。
 * 相对依赖会被递归解析。
 */
function loadTsModuleFile(absolutePath) {
  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath);
  }

  const code = readFileSync(absolutePath, 'utf8');
  const js = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

  const moduleShim = { exports: {} };
  // 先占位，避免循环依赖时无限递归
  moduleCache.set(absolutePath, moduleShim.exports);

  const requireShim = (id) => {
    // 相对导入：同目录的 types / utils 等纯逻辑模块，递归加载
    if (id.startsWith('.')) {
      const base = dirname(absolutePath);
      const target = resolve(base, id);
      const candidates = [`${target}.ts`, `${target}.tsx`, join(target, 'index.ts')];
      for (const candidate of candidates) {
        try {
          return loadTsModuleFile(candidate);
        } catch {
          /* 尝试下一个候选 */
        }
      }
      throw new Error(`测试沙箱找不到相对依赖：${id}`);
    }
    if (id === 'react') {
      return {
        createElement: () => null,
        useState: () => [undefined, () => undefined],
        useEffect: () => undefined,
        useMemo: () => undefined,
        useCallback: () => undefined,
        useRef: () => ({ current: null }),
        forwardRef: (fn) => fn,
        createContext: () => ({ Provider: null, Consumer: null }),
        default: { createElement: () => null },
        __esModule: true,
      };
    }
    if (id.startsWith('@/components/ui/')) {
      const stub = new Proxy(() => null, { get: () => stub, apply: () => null });
      return { __esModule: true, default: stub };
    }
    if (id === 'framer-motion') {
      const stub = new Proxy(() => null, { get: () => stub });
      return { __esModule: true, motion: stub, AnimatePresence: stub };
    }
    if (id === 'lucide-react') {
      const stub = new Proxy(() => null, { get: () => stub });
      return { __esModule: true, default: stub };
    }
    throw new Error(`测试沙箱不支持依赖：${id}`);
  };

  const run = new Function('module', 'exports', 'require', js);
  run(moduleShim, moduleShim.exports, requireShim);

  moduleCache.set(absolutePath, moduleShim.exports);
  return moduleShim.exports;
}

/**
 * 加载 TS 模块并取出指定导出。
 */
function loadTsModule(file, exportNames) {
  const exports = loadTsModuleFile(join(ROOT, file));
  const result = {};
  for (const name of exportNames) {
    result[name] = exports[name];
  }
  return result;
}

/* -------------------------------------------------------------------------- */

console.log('\n[1/5] 注册表 PluginRegistry');
{
  const { PluginRegistry } = loadTsModule('src/plugins/registry.ts', ['PluginRegistry']);
  const registry = new PluginRegistry();
  const events = [];
  const unsubscribe = registry.subscribe((event) => events.push(event.type));

  const mod = { manifest: { id: 'demo-plugin', name: '演示', version: '1.0.0', description: 'd', category: 'c' }, Component: () => null };
  registry.register(mod);
  check('注册后可按 id 查询', registry.get('demo-plugin') === mod);
  checkEqual('注册后默认标记为已安装', registry.isInstalled('demo-plugin'), true);
  checkEqual('已安装列表包含该插件', registry.listInstalled().length, 1);
  check('变更事件已推送', events.includes('register'));

  let duplicateFailed = false;
  try {
    registry.register(mod);
  } catch {
    duplicateFailed = true;
  }
  check('重复注册同 id 会抛出异常', duplicateFailed);

  registry.register(mod, { replace: true });
  check('replace 可覆盖同 id 插件', registry.get('demo-plugin') === mod);

  registry.markUninstalled('demo-plugin');
  checkEqual('卸载后不再是已安装状态', registry.isInstalled('demo-plugin'), false);
  checkEqual('卸载后模块仍保留（可再次启用）', registry.has('demo-plugin'), true);

  checkEqual('unregister 会移除模块', registry.unregister('demo-plugin'), true);
  checkEqual('unregister 后模块不存在', registry.has('demo-plugin'), false);

  unsubscribe();
  const before = events.length;
  registry.register(mod);
  check('取消订阅后不再收到事件', events.length === before);
}

console.log('\n[2/5] 打包器 PluginPackage 校验');
{
  const pkg = loadTsModule('src/plugins/packager.ts', [
    'parsePluginPackage',
    'isValidPluginId',
    'isValidSemver',
    'compareSemver',
    'isCoreCompatible',
    'createPluginPackage',
    'serializePluginPackage',
  ]);

  const validManifest = {
    id: 'demo-plugin',
    name: '演示插件',
    version: '1.0.0',
    description: '一个演示插件',
    category: '工具',
  };

  // 正常包
  const good = pkg.serializePluginPackage(pkg.createPluginPackage(validManifest));
  const goodResult = pkg.parsePluginPackage(good);
  check('合法插件包解析成功', goodResult.ok === true, goodResult.ok ? '' : goodResult.error);
  checkEqual('解析后 manifest.id 正确', goodResult.ok && goodResult.value.manifest.id, 'demo-plugin');
  checkEqual('format 字段正确', goodResult.ok && goodResult.value.format, 'zhijianxia.plugin');
  checkEqual('formatVersion 字段正确', goodResult.ok && goodResult.value.formatVersion, 1);

  // 非法 JSON
  const badJson = pkg.parsePluginPackage('{ not json');
  checkEqual('非法 JSON 被拒绝', badJson.ok, false);
  check('非法 JSON 给出中文提示', !badJson.ok && badJson.error.includes('JSON'), badJson.ok ? '' : badJson.error);

  // format 不对
  const badFormat = pkg.parsePluginPackage(JSON.stringify({ format: 'other', formatVersion: 1, manifest: validManifest }));
  checkEqual('format 不匹配被拒绝', badFormat.ok, false);

  // formatVersion 过高
  const badVersion = pkg.parsePluginPackage(
    JSON.stringify({ format: 'zhijianxia.plugin', formatVersion: 99, manifest: validManifest }),
  );
  checkEqual('formatVersion 过高被拒绝', badVersion.ok, false);
  check(
    '版本过高提示要求升级',
    !badVersion.ok && badVersion.error.includes('升级'),
    badVersion.ok ? '' : badVersion.error,
  );

  // 非法 id
  const badId = pkg.parsePluginPackage(
    JSON.stringify({
      format: 'zhijianxia.plugin',
      formatVersion: 1,
      manifest: { ...validManifest, id: 'Bad_ID!' },
    }),
  );
  checkEqual('非法插件 id 被拒绝', badId.ok, false);
  check('非法 id 提示中文化', !badId.ok && badId.error.includes('id'));

  // 非法版本号
  const badSemver = pkg.parsePluginPackage(
    JSON.stringify({
      format: 'zhijianxia.plugin',
      formatVersion: 1,
      manifest: { ...validManifest, version: 'v1' },
    }),
  );
  checkEqual('非法版本号被拒绝', badSemver.ok, false);

  // 内核不兼容
  const badCore = pkg.parsePluginPackage(
    JSON.stringify({
      format: 'zhijianxia.plugin',
      formatVersion: 1,
      manifest: { ...validManifest, minCoreVersion: '9.0.0' },
      core: { minVersion: '9.0.0' },
    }),
  );
  checkEqual('内核版本不兼容被拒绝', badCore.ok, false);
  check(
    '不兼容提示含版本号',
    !badCore.ok && badCore.error.includes('9.0.0'),
    badCore.ok ? '' : badCore.error,
  );

  // semver 比较
  checkEqual('compareSemver: 1.0.0 < 1.0.1', pkg.compareSemver('1.0.0', '1.0.1'), -1);
  checkEqual('compareSemver: 2.0.0 > 1.9.9', pkg.compareSemver('2.0.0', '1.9.9'), 1);
  checkEqual('compareSemver: 相等', pkg.compareSemver('1.2.3', '1.2.3'), 0);
  checkEqual('isValidSemver 接受 1.0.0', pkg.isValidSemver('1.0.0'), true);
  checkEqual('isValidSemver 拒绝 1.0', pkg.isValidSemver('1.0'), false);
  checkEqual('isValidPluginId 接受 my-plugin', pkg.isValidPluginId('my-plugin'), true);
  checkEqual('isValidPluginId 拒绝 My_Plugin', pkg.isValidPluginId('My_Plugin'), false);
  checkEqual('isCoreCompatible: 1.0.0 兼容 1.0.0', pkg.isCoreCompatible('1.0.0', '1.0.0'), true);
  checkEqual('isCoreCompatible: 2.0.0 不兼容 1.0.0', pkg.isCoreCompatible('2.0.0', '1.0.0'), false);
}

console.log('\n[3/5] 存储命名空间隔离');
{
  // 存储模块依赖 window/localStorage，这里注入最小实现
  globalThis.window = {
    localStorage: (() => {
      const map = new Map();
      return {
        get length() {
          return map.size;
        },
        key: (i) => Array.from(map.keys())[i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
      };
    })(),
  };

  const { createPluginStorage } = loadTsModule('src/plugins/context.ts', ['createPluginStorage']);
  const a = createPluginStorage('plugin-a');
  const b = createPluginStorage('plugin-b');

  a.set('key', 'value-a');
  b.set('key', 'value-b');
  checkEqual('同 key 在不同命名空间互相隔离', a.get('key', ''), 'value-a');
  checkEqual('另一命名空间读到自己的值', b.get('key', ''), 'value-b');
  checkEqual('命名空间前缀正确', a.namespace, 'zhijianxia:plugin:plugin-a:');
  checkEqual('keys 只列出本命名空间', a.keys().includes('key'), true);

  // 共享命名空间
  a.set('shared:state', { running: true });
  checkEqual('shared: 前缀可跨插件读取', b.get('shared:state', null)?.running, true);

  // 订阅通知
  let notified = null;
  const off = b.subscribe('shared:state', (v) => {
    notified = v;
  });
  a.set('shared:state', { running: false });
  check('共享键变更能通知到其它插件', notified !== null && notified.running === false);
  off();

  a.remove('key');
  checkEqual('删除后回落到默认值', a.get('key', 'fallback'), 'fallback');

  delete globalThis.window;
}

console.log('\n[4/5] 插件清单完整性');
{
  const files = (await readdir(join(ROOT, 'src', 'plugins', 'builtin'))).filter((f) => f.endsWith('.tsx')).sort();
  const dlFiles = (await readdir(join(ROOT, 'src', 'plugins', 'downloadable'))).filter((f) => f.endsWith('.tsx')).sort();
  checkEqual('预装插件共 5 个', files.length, 5);
  checkEqual('可下载插件共 6 个', dlFiles.length, 6);

  // 校验每个插件 manifest 的关键字段
  const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
  const allFiles = [
    ...files.map((f) => join('src', 'plugins', 'builtin', f)),
    ...dlFiles.map((f) => join('src', 'plugins', 'downloadable', f)),
  ];
  for (const file of allFiles) {
    const code = await readFile(join(ROOT, file), 'utf8');
    const sourceFile = ts.createSourceFile('p.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let manifest = null;
    for (const st of sourceFile.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === 'manifest') manifest = d.initializer;
      }
    }
    check(`${file} 存在 manifest`, manifest !== null);
    if (!manifest) continue;
    const text = manifest.getText(sourceFile);
    const idMatch = text.match(/id:\s*'([^']+)'/);
    const versionMatch = text.match(/version:\s*'([^']+)'/);
    const nameMatch = text.match(/name:\s*'([^']+)'/);
    check(`${file} id 合法`, !!idMatch && ID_PATTERN.test(idMatch[1]), idMatch?.[1]);
    check(`${file} version 合法`, !!versionMatch && SEMVER_PATTERN.test(versionMatch[1]), versionMatch?.[1]);
    check(`${file} name 非空`, !!nameMatch && nameMatch[1].length > 0);
  }
}

console.log('\n[5/5] 已构建的 .plugin 产物');
{
  const dir = join(ROOT, 'dist-plugins');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.plugin')).sort();
  checkEqual('生成 6 个 .plugin 文件', files.length, 6);

  const indexRaw = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  checkEqual('index.json 收录 6 个插件', indexRaw.plugins.length, 6);
  checkEqual('index.json format 正确', indexRaw.format, 'zhijianxia.plugin');
  checkEqual('index.json formatVersion 正确', indexRaw.formatVersion, 1);

  for (const file of files) {
    const pkg = JSON.parse(await readFile(join(dir, file), 'utf8'));
    check(`${file} format 正确`, pkg.format === 'zhijianxia.plugin');
    check(`${file} manifest.id 合法`, ID_PATTERN.test(pkg.manifest.id));
    check(`${file} core.minVersion 存在`, typeof pkg.core?.minVersion === 'string');
  }
}

console.log(`\n结果：${passed} 项通过，${failed} 项失败\n`);
process.exit(failed > 0 ? 1 : 0);

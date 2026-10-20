/**
 * 智简匣 · 插件内核入口自检
 *
 * 验证 createPluginKernel 的实际行为：
 * 1. boot() 加载并注册全部预装插件
 * 2. load() 按 id 加载单个插件
 * 3. importPackage() 导入合法包 / 拒绝非法包
 * 4. uninstall() 触发卸载钩子并移除插件
 *
 * 用法：node scripts/verify-kernel.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const moduleCache = new Map();

/** 加载 TS 模块（带依赖递归与 React 存根） */
function loadTsModuleFile(absolutePath) {
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath);

  const code = readFileSync(absolutePath, 'utf8');
  const js = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

  const moduleShim = { exports: {} };
  moduleCache.set(absolutePath, moduleShim.exports);

  const requireShim = (id) => {
    if (id.startsWith('.')) {
      const base = dirname(absolutePath);
      const target = resolve(base, id);
      let lastError = null;
      for (const candidate of [`${target}.ts`, `${target}.tsx`, join(target, 'index.ts')]) {
        try {
          return loadTsModuleFile(candidate);
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`找不到相对依赖：${id}（${lastError?.message ?? '未知原因'}）`);
    }
    if (id === 'react' || id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') {
      const stub = new Proxy(() => null, { get: () => stub, apply: () => null });
      return {
        __esModule: true,
        default: stub,
        jsx: () => null,
        jsxs: () => null,
        jsxDEV: () => null,
        Fragment: stub,
        createElement: () => null,
        useState: () => [undefined, () => undefined],
        useEffect: () => undefined,
        useMemo: () => undefined,
        useCallback: () => undefined,
        useRef: () => ({ current: null }),
        forwardRef: (fn) => fn,
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
    throw new Error(`不支持的依赖：${id}`);
  };

  const run = new Function('module', 'exports', 'require', js);
  run(moduleShim, moduleShim.exports, requireShim);
  moduleCache.set(absolutePath, moduleShim.exports);
  return moduleShim.exports;
}

/* -------------------------------------------------------------------------- */

// 注入最小浏览器环境
const store = new Map();
globalThis.window = {
  localStorage: {
    get length() {
      return store.size;
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const { createPluginKernel } = loadTsModuleFile(join(ROOT, 'src', 'plugins', 'index.ts'));

console.log('\n[1/4] 内核启动 boot()');
const notifications = [];
const openedCards = [];
let backendRequired = 0;

const themeState = { mode: 'light', accent: '#0ea5a4', tokens: {}, packId: null };
const themeListeners = new Set();

const kernel = createPluginKernel({
  ai: {
    available: true,
    mode: 'local',
    chat: async () => ({ text: 'AI 输出' }),
  },
  theme: {
    getSnapshot: () => ({ ...themeState }),
    subscribe: (listener) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    setMode: (mode) => {
      themeState.mode = mode;
      themeListeners.forEach((l) => l());
    },
    setAccent: (hex) => {
      themeState.accent = hex;
      themeListeners.forEach((l) => l());
    },
    applyThemePack: (id) => {
      themeState.packId = id;
      themeListeners.forEach((l) => l());
    },
  },
  backendOnline: false,
  notify: (message, type) => notifications.push({ message, type }),
  requireBackend: () => {
    backendRequired += 1;
  },
  openCard: (id) => openedCards.push(id),
});

const booted = await kernel.boot();
// 数量按实际清单动态校验（下限保护）
check('boot() 注册了全部预装与可下载插件', booted.length >= 10, `实际 ${booted.length}`);
check('注册表可查询到 weather-card', kernel.registry.has('weather-card'));
check('注册表可查询到 vocabulary', kernel.registry.has('vocabulary'));
check(
  '预装插件默认已安装',
  kernel.registry.isInstalled('weather-card') && kernel.registry.isInstalled('memo-card'),
);
check(
  '可下载插件默认未安装',
  !kernel.registry.isInstalled('pomodoro'),
  '可下载插件应等待用户从广场安装',
);
check('内核版本号为 1.0.0', kernel.version === '1.0.0');

console.log('\n[2/4] 按需加载 load()');
const pomodoro = await kernel.load('pomodoro');
check('load("pomodoro") 返回模块', pomodoro.manifest.id === 'pomodoro');
check('load 后进入已安装状态', kernel.registry.isInstalled('pomodoro'));
check(
  'load 后注册表模块数不减少',
  kernel.registry.list().length >= booted.length,
  `实际 ${kernel.registry.list().length}`,
);

console.log('\n[3/4] 导入 .plugin 包');
const validPkg = JSON.stringify({
  format: 'zhijianxia.plugin',
  formatVersion: 1,
  manifest: {
    id: 'pomodoro',
    name: '番茄专注计时器',
    version: '1.0.0',
    description: '导入测试',
    category: '效率',
  },
  core: { minVersion: '1.0.0' },
});
const importOk = await kernel.importPackage(validPkg);
check('合法包导入成功', importOk.ok === true, importOk.ok ? '' : importOk.error);

const invalidIdPkg = JSON.stringify({
  format: 'zhijianxia.plugin',
  formatVersion: 1,
  manifest: { id: 'Bad ID', name: 'x', version: '1.0.0', description: 'd', category: 'c' },
  core: { minVersion: '1.0.0' },
});
const importBadId = await kernel.importPackage(invalidIdPkg);
check('非法 id 的包被拒绝', importBadId.ok === false);
check('拒绝提示为中文', !importBadId.ok && /[\u4e00-\u9fa5]/.test(importBadId.error), importBadId.ok ? '' : importBadId.error);

const futurePkg = JSON.stringify({
  format: 'zhijianxia.plugin',
  formatVersion: 99,
  manifest: { id: 'x-plugin', name: 'x', version: '1.0.0', description: 'd', category: 'c' },
});
const importFuture = await kernel.importPackage(futurePkg);
check('formatVersion 过高的包被拒绝', importFuture.ok === false);
check(
  '版本过高提示升级智简匣',
  !importFuture.ok && importFuture.error.includes('升级'),
  importFuture.ok ? '' : importFuture.error,
);

const unknownPkg = JSON.stringify({
  format: 'zhijianxia.plugin',
  formatVersion: 1,
  manifest: { id: 'not-bundled', name: 'x', version: '1.0.0', description: 'd', category: 'c' },
  core: { minVersion: '1.0.0' },
});
const importUnknown = await kernel.importPackage(unknownPkg);
check('未打包且无入口的插件被拒绝', importUnknown.ok === false);

console.log('\n[4/4] 插件上下文与主题写入口');
const ctx = kernel.createContext('weather-card');
check('上下文提供 ai 调度器', typeof ctx.ai.chat === 'function');
check('上下文提供命名空间隔离存储', ctx.storage.namespace === 'zhijianxia:plugin:weather-card:');
check('上下文提供通知能力', typeof ctx.notify === 'function');
check('上下文提供 openCard', typeof ctx.openCard === 'function');
check('上下文提供 requireBackend', typeof ctx.requireBackend === 'function');
check('上下文暴露 backendOnline', ctx.backendOnline === false);
check('上下文提供 setMode 写入口', typeof ctx.setMode === 'function');
check('上下文提供 setAccent 写入口', typeof ctx.setAccent === 'function');
check('上下文提供 applyThemePack 写入口', typeof ctx.applyThemePack === 'function');
check('主题只读快照含 mode', ctx.theme.mode === 'light');
check('主题只读快照含 accent', ctx.theme.accent === '#0ea5a4');
check('主题只读快照含 tokens', typeof ctx.theme.tokens === 'object');
check('主题只读快照含主题包清单', Array.isArray(ctx.theme.packs) && ctx.theme.packs.length === 5);

ctx.setMode('dark');
check('setMode 生效', ctx.theme.mode === 'dark');
ctx.setAccent('#ff0000');
check('setAccent 生效', ctx.theme.accent === '#ff0000');
ctx.applyThemePack('dusk');
check('applyThemePack 生效', ctx.theme.packId === 'dusk');
ctx.notify('测试通知', 'success');
check('notify 透传到内核', notifications.length === 1 && notifications[0].type === 'success');
ctx.requireBackend();
check('requireBackend 透传到内核', backendRequired === 1);
ctx.openCard('music-player');
check('openCard 透传到内核', openedCards[0] === 'music-player');

console.log('\n[5/5] 卸载 uninstall()');
await kernel.uninstall('pomodoro');
check('卸载后从注册表移除', !kernel.registry.has('pomodoro'));

console.log(`\n结果：${passed} 项通过，${failed} 项失败\n`);
process.exit(failed > 0 ? 1 : 0);

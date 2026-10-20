#!/usr/bin/env node
/**
 * 智简匣 · 插件打包脚本
 *
 * 作用：把 src/plugins/downloadable/ 下的可下载插件编译导出为 .plugin 文件，
 *       输出到 dist-plugins/ 目录，并生成 index.json 供前端「功能广场」读取。
 *
 * .plugin 格式（JSON，便于浏览器端 import / export）：
 * {
 *   "format": "zhijianxia.plugin",
 *   "formatVersion": 1,
 *   "manifest": { ...插件清单... },
 *   "core": { "minVersion": "1.0.0" },
 *   "entry": { "kind": "esm", "file": "xxx.tsx", "source": "..." }   // 可选
 * }
 *
 * 用法：
 *   node scripts/build-plugins.mjs              # 打包全部可下载插件
 *   node scripts/build-plugins.mjs --with-code  # 额外内联插件源码到 entry.source
 *   node scripts/build-plugins.mjs --out dist-plugins
 *
 * 注意：生产环境下插件代码由 Next 打包，因此 entry 字段默认不内联源码，
 *       仅在需要导出「可独立加载的第三方插件」时使用 --with-code。
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = join(ROOT, 'src', 'plugins', 'downloadable');

/** 插件包格式标识 */
const PLUGIN_FORMAT = 'zhijianxia.plugin';
/** 插件包格式版本 */
const PLUGIN_FORMAT_VERSION = 1;
/** 当前内核版本 */
const CORE_VERSION = '1.0.0';

/** 插件 id 规则 */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** semver 规则 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * 从 TSX 源码中静态提取 manifest 对象字面量。
 *
 * 做法：用 TypeScript 编译器 API 解析 AST，找到导出的 `manifest` 变量声明，
 *       再把其初始化表达式在隔离沙箱里求值。
 *       这样无需真正执行 React 组件代码，也不会触发任何副作用。
 *
 * @param {string} code TSX 源码
 * @returns {object} manifest 对象
 */
function extractManifest(code) {
  const sourceFile = ts.createSourceFile(
    'plugin.tsx',
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  let manifestExpr = null;

  /** 遍历顶层语句寻找导出的 manifest 变量 */
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'manifest') {
        manifestExpr = declaration.initializer;
        break;
      }
    }
    if (manifestExpr) break;
  }

  if (!manifestExpr) {
    throw new Error('未找到导出的 manifest 常量');
  }

  // 把表达式转成 CommonJS，再用隔离沙箱求值
  const exprText = manifestExpr.getText(sourceFile);
  const jsText = ts.transpileModule(
    `export default (${exprText});`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;

  // 在无副作用的沙箱中求值：manifest 是纯字面量，不引用任何外部变量
  const moduleShim = { exports: {} };
  // eslint-disable-next-line no-new-func
  const run = new Function('module', 'exports', jsText);
  run(moduleShim, moduleShim.exports);

  const result = moduleShim.exports.default;
  if (!result || typeof result !== 'object') {
    throw new Error('manifest 求值结果不是对象');
  }
  return result;
}

/**
 * 校验 manifest 的合法性。
 * @returns {string[]} 错误信息列表，空数组表示通过
 */
function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    return ['manifest 不是对象'];
  }
  if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) {
    errors.push(`id 非法："${manifest.id}"（只允许小写字母、数字与连字符）`);
  }
  if (typeof manifest.version !== 'string' || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push(`version 非法："${manifest.version}"（应为语义化版本，如 1.0.0）`);
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    errors.push('name 不能为空');
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    errors.push('description 不能为空');
  }
  if (typeof manifest.category !== 'string' || !manifest.category.trim()) {
    errors.push('category 不能为空');
  }
  if (
    manifest.minCoreVersion !== undefined &&
    (typeof manifest.minCoreVersion !== 'string' || !SEMVER_PATTERN.test(manifest.minCoreVersion))
  ) {
    errors.push(`minCoreVersion 非法："${manifest.minCoreVersion}"`);
  }

  return errors;
}

/** 解析命令行参数 */
function parseArgs(argv) {
  const args = {
    outDir: join(ROOT, 'dist-plugins'),
    withCode: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--with-code') {
      args.withCode = true;
    } else if (arg === '--out') {
      const next = argv[i + 1];
      if (next) {
        args.outDir = resolve(ROOT, next);
        i += 1;
      }
    }
  }

  return args;
}

/** 主流程 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1. 扫描可下载插件源文件
  let files = [];
  try {
    files = (await readdir(SRC_DIR)).filter((file) => file.endsWith('.tsx')).sort();
  } catch (error) {
    console.error(`[插件打包] 无法读取目录 ${SRC_DIR}：${error.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('[插件打包] 没有找到可打包的插件文件');
    return;
  }

  // 2. 清理输出目录
  await rm(args.outDir, { recursive: true, force: true });
  await mkdir(args.outDir, { recursive: true });

  console.log(`[插件打包] 开始打包 ${files.length} 个可下载插件 -> ${args.outDir}`);

  const index = {
    format: PLUGIN_FORMAT,
    formatVersion: PLUGIN_FORMAT_VERSION,
    core: { minVersion: CORE_VERSION },
    generatedAt: new Date().toISOString(),
    plugins: [],
  };

  let failed = 0;

  for (const file of files) {
    const filePath = join(SRC_DIR, file);
    const code = await readFile(filePath, 'utf8');

    let manifest;
    try {
      manifest = extractManifest(code);
    } catch (error) {
      console.error(`  ✗ ${file}：提取 manifest 失败 - ${error.message}`);
      failed += 1;
      continue;
    }

    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      console.error(`  ✗ ${file}：manifest 校验未通过`);
      errors.forEach((message) => console.error(`      - ${message}`));
      failed += 1;
      continue;
    }

    // 3. 组装插件包
    const pkg = {
      format: PLUGIN_FORMAT,
      formatVersion: PLUGIN_FORMAT_VERSION,
      manifest,
      core: {
        minVersion: manifest.minCoreVersion ?? CORE_VERSION,
      },
    };

    if (args.withCode) {
      // 内联源码，供第三方插件走 blob 动态加载
      pkg.entry = {
        kind: 'esm',
        file,
        source: code,
      };
    }

    const outFile = join(args.outDir, `${manifest.id}-${manifest.version}.plugin`);
    await writeFile(outFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

    index.plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      category: manifest.category,
      author: manifest.author ?? '智简匣',
      icon: manifest.icon ?? 'Puzzle',
      preview: manifest.preview ?? '🧩',
      tags: manifest.tags ?? [],
      offline: manifest.offline ?? true,
      builtin: manifest.builtin ?? false,
      minCoreVersion: manifest.minCoreVersion ?? CORE_VERSION,
      file: `${manifest.id}-${manifest.version}.plugin`,
    });

    console.log(`  ✓ ${manifest.id}@${manifest.version} -> ${manifest.id}-${manifest.version}.plugin`);
  }

  // 4. 输出广场清单
  await writeFile(join(args.outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`[插件打包] 已生成 index.json（${index.plugins.length} 个插件）`);

  if (failed > 0) {
    console.error(`[插件打包] 有 ${failed} 个插件打包失败`);
    process.exit(1);
  }

  console.log('[插件打包] 全部完成');
}

main().catch((error) => {
  console.error('[插件打包] 执行失败：', error);
  process.exit(1);
});

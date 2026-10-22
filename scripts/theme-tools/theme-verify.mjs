/**
 * 主题包导入自检 —— 用**项目自己的校验器**验证能否导入。
 *
 * ## 为什么必须复用项目源码
 *
 * 配色达标 ≠ 能导入。格式（信封四段 / 字段完整性 / 枚举值）是第一道关，
 * 而 `themePackOf()` 这条归一化路径才是用户点「导入」后真正执行的代码 ——
 * 若它抛错，用户就是白屏。
 *
 * 这里不复述校验规则，而是**直接加载项目的 packager.ts**，
 * 保证「验证过的」与「运行时跑的」是同一份代码。
 *
 * ## 怎么加载 TS
 *
 * 项目 TS 用无扩展名导入（`from './types'`），Node 原生 ESM 解析不了。
 * 项目里 scripts/verify-kernel.mjs 已有先例：用自带的 typescript
 * 编译器 API 现场转译。这里沿用同一手法，保持零新增依赖。
 *
 * 用法：node scripts/theme-tools/theme-verify.mjs
 */

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const THEME_DIR = join(ROOT, 'dist-themes');
const TMP_DIR = join(ROOT, '.theme-verify-tmp');

/* ---------- 用 TS 编译器 API 现场加载项目的 .ts ---------- */

/**
 * 转译并加载一个项目内的 .ts 文件。
 *
 * 两个坑都要处理：
 * 1. 转译后仍留有 `./types` 这类无扩展名相对导入 → Node 解析不了。
 *    解决办法不是打补丁（data: URL 里相对路径无解），而是把依赖子图
 *    按相同布局镜像到临时目录，让相对导入天然可解析。
 * 2. 镜像后的文件名必须是 `.js` —— Node 的 ESM 解析器**不会**去试 `.ts`。
 */
const mirror = new Map();

function mirrorFile(absPath) {
  if (mirror.has(absPath)) return mirror.get(absPath);

  const rel = absPath.slice(ROOT.length + 1).replace(/\.tsx?$/, '.js');
  const dest = join(TMP_DIR, rel);
  mirror.set(absPath, dest);

  const source = readFileSync(absPath, 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: absPath,
  });

  mkdirSync(dirname(dest), { recursive: true });
  // 写一份最小 package.json 声明 ESM —— 否则 Node 会因「模块类型未指定」
  // 发出 MODULE_TYPELESS_PACKAGE_JSON 警告并二次探测，噪音很大
  const pkgJson = join(TMP_DIR, 'package.json');
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, '{ "type": "module" }\n', 'utf8');
  }

  // 转译产物里的相对导入没有扩展名（'./types'），Node 解析不了
  // （它的 ESM 解析器**不会**去试 .ts / .tsx）→ 补成 './types.js'
  const patched = out.outputText.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*?)(\2)/g,
    (m, head, q, spec, tail) =>
      /\.(js|mjs|json)$/.test(spec) ? m : `${head}${q}${spec}.js${tail}`,
  );
  writeFileSync(dest, patched, 'utf8');

  // ⚠️ 必须**递归**镜像依赖：转译产物里的相对导入指向同目录的其它 .ts，
  // 不把它们一并转译过去，Node 就报 MODULE_NOT_FOUND。
  // （第一版只镜像了入口文件，漏了 types.ts。）
  for (const spec of collectRelativeSpecs(out.outputText)) {
    const dep = resolve(dirname(absPath), spec);
    for (const ext of ['.ts', '.tsx', '.js']) {
      if (existsSync(dep + ext)) {
        mirrorFile(dep + ext);
        break;
      }
    }
  }

  return dest;
}

/** 从转译产物里取出所有相对导入说明符 */
function collectRelativeSpecs(code) {
  const specs = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bexport\s*\*\s*from\s*)(['"])(\.[^'"]*?)\1/g;
  let m;
  while ((m = re.exec(code)) !== null) specs.push(m[2]);
  return specs;
}

async function loadTs(absPath) {
  const dest = mirrorFile(absPath);
  return import(pathToFileURL(dest).href);
}

const packager = await loadTs(join(ROOT, 'src', 'lib', 'theme', 'packager.ts'));

/* ---------- 校验 ---------- */

const files = readdirSync(THEME_DIR).filter((f) => f.endsWith('.theme'));
console.log(`校验 ${files.length} 个主题包（用项目 packager.ts）\n`);

let failed = 0;

for (const f of files) {
  const text = readFileSync(join(THEME_DIR, f), 'utf8');

  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    console.log(`✗ ${f}  不是合法 JSON`);
    failed += 1;
    continue;
  }

  const result = packager.validateThemePackage(pkg);
  if (!result.ok) {
    console.log(`✗ ${f}  校验失败：${result.error}`);
    failed += 1;
    continue;
  }

  // 走一遍归一化 —— 用户点「导入」后执行的就是这条路径
  let pack;
  try {
    pack = packager.themePackOf(result.value);
  } catch (err) {
    console.log(`✗ ${f}  归一化抛错：${err.message}`);
    failed += 1;
    continue;
  }

  console.log(`✓ ${f}`);
  console.log(`    ${pack.name}（${pack.id}）  分类=${pack.category}  作者=${pack.author ?? '未署名'}`);
  console.log(`    light: accent=${pack.light.accent}  bg=${pack.light.bg}  fg=${pack.light.fg}`);
  console.log(`    dark:  accent=${pack.dark.accent}  bg=${pack.dark.bg}  fg=${pack.dark.fg}`);
  console.log(
    `    卡片=${pack.card?.style ?? '(默认)'}  导航=${pack.nav?.style ?? '(默认)'}  ` +
      `壁纸=${pack.wallpaper ? '有' : '无'}  额外变量=${Object.keys(pack.cssVars ?? {}).join(',') || '无'}`,
  );
  console.log('');
}

rmSync(TMP_DIR, { recursive: true, force: true });

console.log('---');
if (failed) {
  console.log(`FAIL: ${failed} 个主题包无法导入`);
  process.exit(1);
}
console.log(`PASS: ${files.length} 个主题包全部通过导入校验`);
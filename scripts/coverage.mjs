/**
 * 单元测试覆盖率汇总与门禁
 *
 * 为什么不是直接 `c8 node scripts/xxx.mjs`：
 * 仓库里的「单元测试」是多个独立脚本（各自跑一种逻辑），单个脚本只覆盖自己那
 * 一份模块。要得到**合并后的真实覆盖率**，得让每个进程都往同一个
 * NODE_V8_COVERAGE 目录写原始数据，最后统一 report —— 这正是本脚本做的事。
 *
 * 覆盖范围（SCOPE）刻意只包含**纯逻辑模块**：
 *   - 能被 Node 直接 import、无 DOM / 无网络 / 无 fs 副作用；
 *   - 是「改错了会静默出错」的那一层（预算判定、搜索排序、包校验、亮暗判定）。
 *
 * 为什么不把整个 src/ 纳入门禁：UI 组件（105 个 TSX）只能靠浏览器端到端覆盖，
 * 把它们算进分母会让数字变成 4%（好看的是分子，没用的是结论）。
 * 真实口径见 README / CONTRIBUTING 里的说明 —— 不粉饰。
 *
 * 用法：
 *   npm run coverage             # 跑测试 + 出报告 + 卡门槛
 *   npm run coverage -- --no-check   # 只出报告，不卡门槛（本地调试用）
 */

import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_DIR = join(ROOT, '.coverage', 'tmp');
const OUT_DIR = join(ROOT, 'coverage');
const C8_BIN = join(ROOT, 'node_modules', 'c8', 'bin', 'c8.js');

/** 覆盖率统计范围：纯逻辑模块（每条都必须有对应测试） */
export const SCOPE = [
  'src/lib/theme/search.ts',
  'src/lib/ai/device-profile.ts',
  'src/lib/ai/device-tier.ts',
  'src/lib/ai/local-models.ts',
  'src/lib/i18n/messages.ts',
  'server/src/theme-store/scheme.js',
  'server/src/routes/registry-validate.js',
  'server/src/telemetry.js',
];

/** 参与覆盖率合并的单元测试脚本 */
const TEST_SCRIPTS = [
  'scripts/theme-search-test.mjs',
  'scripts/ai-budget-test.mjs',
  'scripts/theme-pack-test.mjs',
  'scripts/telemetry-test.mjs',
];

/** 门槛：与需求一致，四项都要求 ≥80% */
const THRESHOLDS = { lines: 80, branches: 80, functions: 80, statements: 80 };
const NO_CHECK = process.argv.includes('--no-check');

if (!existsSync(C8_BIN)) {
  console.error('未找到 c8。先执行：npm i -D c8');
  process.exit(1);
}

rmSync(join(ROOT, '.coverage'), { recursive: true, force: true });
mkdirSync(TEMP_DIR, { recursive: true });

// ---------- 1. 依次跑单元测试，原始 coverage 写进同一个目录 ----------
const failed = [];
for (const script of TEST_SCRIPTS) {
  process.stdout.write(`\n▶ ${script}\n`);
  const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', script], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_V8_COVERAGE: TEMP_DIR },
  });
  if (r.status !== 0) failed.push(script);
}

// 测试挂了就不必看覆盖率 —— 覆盖率再高，跑不过也是零
if (failed.length > 0) {
  console.error(`\n✗ 单元测试未通过：${failed.join(', ')}`);
  process.exit(1);
}

// ---------- 2. 合并并出报告 ----------
console.log('\n▶ 合并覆盖率');

const includeArgs = SCOPE.flatMap((f) => ['--include', f]);
const reportArgs = [
  C8_BIN,
  'report',
  '--temp-directory',
  TEMP_DIR,
  '--all',
  '--reporter=text',
  '--reporter=text-summary',
  '--reporter=json-summary',
  '--report-dir',
  OUT_DIR,
  ...includeArgs,
];

if (!NO_CHECK) {
  reportArgs.push(
    '--check-coverage',
    `--lines=${THRESHOLDS.lines}`,
    `--branches=${THRESHOLDS.branches}`,
    `--functions=${THRESHOLDS.functions}`,
    `--statements=${THRESHOLDS.statements}`,
  );
}

const report = spawnSync(process.execPath, reportArgs, { cwd: ROOT, stdio: 'inherit' });

// ---------- 3. 结论 ----------
const summaryPath = join(OUT_DIR, 'coverage-summary.json');
if (existsSync(summaryPath)) {
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const total = summary.total;
  const pct = (k) => total[k].pct;
  console.log('\n┌─ 覆盖范围（纯逻辑层）────────────────────────');
  for (const f of SCOPE) {
    const entry = Object.entries(summary).find(([k]) => k.endsWith(f.replace(/\//g, '\\')) || k.endsWith(f));
    if (entry) console.log(`│ ${f.padEnd(42)} 行 ${String(entry[1].lines.pct).padStart(5)}%`);
  }
  console.log('└──────────────────────────────────────────────');
  console.log(
    `合计：行 ${pct('lines')}% · 分支 ${pct('branches')}% · 函数 ${pct('functions')}% · 语句 ${pct('statements')}%`,
  );
  if (NO_CHECK) console.log('（--no-check：未卡门槛）');
}

if (report.status !== 0) {
  console.error('\n✗ 覆盖率未达门槛（行/分支/函数/语句 均需 ≥80%）');
  process.exit(1);
}
console.log('\n✓ 覆盖率达标');

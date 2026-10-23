/**
 * scripts/theme-ws-test.mjs —— 主题变更的实时推送测试
 *
 * 验证「放一个文件夹 → 数秒内广场自动出现」这条链路：
 * 1. 连上公开 WS 通道；
 * 2. 往主题目录丢一个主题文件夹；
 * 3. 断言收到了 added 事件；
 * 4. 删掉它，断言收到 removed 事件。
 */

// ws 是 CommonJS 包，用默认导入再解构
import wsPkg from '../server/node_modules/ws/index.js';
const { WebSocket } = wsPkg;
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'server', 'packages', 'themes');
const PORT = Number(process.env.PORT || 8787);
const SLUG = 'ws-probe-theme';

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}  ${detail ?? ''}`);
  }
}

const received = [];
const t0 = Date.now();

// 连上公开 WS 通道
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/public`);
await new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
  setTimeout(() => reject(new Error('连接超时')), 5000);
});
console.log('  ✓ 已连接公开 WS 通道 /ws/public');

ws.on('message', (raw) => {
  try {
    const data = JSON.parse(raw.toString());
    if (data.type === 'added' || data.type === 'changed' || data.type === 'removed') {
      received.push({ type: data.type, slug: data.slug, at: Date.now() });
      console.log(`  ← 收到事件：${data.type} ${data.slug} (+${Date.now() - t0}ms)`);
    }
  } catch {
    /* 忽略非 JSON */
  }
});

/** 等待某个 slug 的某类事件 */
async function waitFor(type, slug, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = received.find((e) => e.type === type && e.slug === slug);
    if (hit) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

console.log('');
console.log('[新增主题]');
const dir = path.join(THEMES_DIR, SLUG);
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, 'theme.json'),
  JSON.stringify(
    {
      id: SLUG,
      name: 'WS 探针主题',
      author: 'test',
      version: '1.0.0',
      protocol: 1,
      description: '用于验证实时推送',
      tags: ['测试'],
      category: '综合',
      colors: {
        '--bg': '#f7f8fa',
        '--fg': '#16181d',
        '--accent': '#5b8def',
        '--card': '#ffffff',
        '--border': '#e6e8ee',
      },
    },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(
  path.join(dir, 'theme.css'),
  ':root {\n  --bg: #f7f8fa;\n  --fg: #16181d;\n  --accent: #5b8def;\n}\n',
  'utf8',
);

check('新增目录后收到 added 事件', await waitFor('added', SLUG));

console.log('');
console.log('[删除主题]');
const deleteStart = Date.now();
rmSync(dir, { recursive: true, force: true });
check('删除目录后收到 removed 事件', await waitFor('removed', SLUG));

// ⚠️ 删除目录时不应先发一个 changed —— 那会让前端多刷一次。
// chokidar 的文件级 unlink 可能早于目录级 unlinkDir 到达，
// 若 watcher 靠「扫描结果」判断，就会误判成 changed。
const spurious = received.filter(
  (e) => e.slug === SLUG && e.type === 'changed' && e.at > deleteStart,
);
check(
  '删除时不产生多余的 changed 事件',
  spurious.length === 0,
  spurious.map((e) => e.type).join(','),
);

ws.close();
console.log('');
console.log('════════════════════════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('════════════════════════════════════════');
process.exit(fail > 0 ? 1 : 0);

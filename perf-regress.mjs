import { chromium } from 'playwright-core';

/**
 * 首屏性能回归测试（perf-profiler：先基线，再守住）
 *
 * 这个脚本就是「首屏不该带 AI 编排层」的**可执行规格**：
 * 它在 production build 上跑，若有人把 LangChain 重新用静态 import
 * 拉回首屏链（page → providers → plugin-store → scheduler → chain），
 * 首屏 JS 会从 ~558 KB 涨回 ~678 KB，测试变红。
 *
 * 用法：
 *   ZJ_DIST_DIR=.next-perf npx next build
 *   ZJ_DIST_DIR=.next-perf npx next start -p 3200
 *   node perf-regress.mjs http://localhost:3200
 *
 * 预算 640 KB：当前实测 558 KB 留 ~13% 余量，
 * 而「误用静态 import 引回 LangChain」的量级是 +120 KB，足以触发变红。
 */

const BASE = process.argv[2] || 'http://localhost:3200';
const BUDGET_KB = Number(process.env.ZJ_JS_BUDGET_KB || 640);

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  window.__longTasks = [];
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    /* ignore */
  }
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const data = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = {};
  for (const p of performance.getEntriesByType('paint')) {
    paints[p.name] = Math.round(p.startTime);
  }
  const resources = performance
    .getEntriesByType('resource')
    .map((r) => ({
      name: r.name,
      size: r.transferSize || r.encodedBodySize || 0,
      type: r.initiatorType,
    }))
    .filter((r) => r.size > 0);
  return {
    ttfb: nav ? Math.round(nav.responseStart) : 0,
    fcp: paints['first-contentful-paint'] || 0,
    longTasks: window.__longTasks,
    resources,
  };
});

const jsBytes = data.resources
  .filter((r) => r.type === 'script' || r.name.includes('.js'))
  .reduce((s, r) => s + r.size, 0);
const jsKB = jsBytes / 1024;

const bigJs = data.resources
  .filter((r) => r.type === 'script' || r.name.includes('.js'))
  .sort((a, b) => b.size - a.size)
  .slice(0, 3);

const longTotal = data.longTasks.reduce((a, b) => a + b, 0);
const longMax = data.longTasks.length ? Math.max(...data.longTasks) : 0;

console.log('=== 首屏性能 ===');
console.log(`  TTFB      ${data.ttfb} ms`);
console.log(`  FCP       ${data.fcp} ms`);
console.log(`  JS 总量   ${jsKB.toFixed(0)} KB (预算 ${BUDGET_KB} KB)`);
console.log(`  长任务    ${data.longTasks.length} 次 / 累计 ${longTotal} ms / 最大 ${longMax} ms`);
console.log('  最大 JS:');
for (const r of bigJs) {
  console.log(`    ${(r.size / 1024).toFixed(0).padStart(6)} KB  ${decodeURIComponent(r.name).split('/').pop().slice(0, 50)}`);
}

const failures = [];
if (jsKB > BUDGET_KB) {
  failures.push(`首屏 JS ${jsKB.toFixed(0)} KB 超出预算 ${BUDGET_KB} KB`);
}
if (data.fcp > 1200) {
  failures.push(`FCP ${data.fcp} ms 偏慢（阈值 1200 ms）`);
}
if (longMax > 300) {
  failures.push(`存在 ${longMax} ms 的主线程长任务（阈值 300 ms）`);
}

console.log('');
if (failures.length) {
  console.log('FAIL:');
  for (const f of failures) console.log(`  - ${f}`);
  await browser.close();
  process.exit(1);
}
console.log('PASS: 首屏性能在预算内');

await browser.close();
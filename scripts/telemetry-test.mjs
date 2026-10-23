/**
 * 遥测归一化 / 汇总 + 词典一致性测试
 *
 * 遥测这块最容易出两类问题，而且都不会立刻报错：
 *   1. 把不该存的东西存进库（用户输入、超长堆栈）→ 这里逐字段钉住长度与白名单；
 *   2. 汇总算错（p95 取错位、top 排序反了）→ 用可手算的样本验证。
 *
 * 顺带校验 i18n 词典：中文与英文必须 key 对齐、占位符一致 ——
 * 否则英文界面会出现 `{count} plugins` 或直接显示 key。
 *
 * 用法：node scripts/telemetry-test.mjs
 */

import { createRequire } from 'node:module';
import { DICTIONARIES, LOCALES, zh } from '../src/lib/i18n/messages.ts';

const require = createRequire(import.meta.url);
const { normalizeEvent, summarize, normalizePath, parseDsn } = require('../server/src/telemetry.js');

let pass = 0;
let fail = 0;
function check(ok, name, extra = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  →  ' + extra : ''}`);
}

// ========== 1. 输入形状 ==========
check(normalizeEvent(null).ok === false, 'null 被拒');
check(normalizeEvent([]).ok === false, '数组被拒');
check(normalizeEvent('boom').ok === false, '字符串被拒');
check(normalizeEvent({ level: 'error' }).ok === false, '错误事件缺 message 被拒');
check(normalizeEvent({ level: 'metric', name: 'lcp' }).ok === false, '指标事件缺 value 被拒');
check(normalizeEvent({ level: 'metric', name: 'lcp', value: 'abc' }).ok === false, '指标 value 非数字被拒');

const okError = normalizeEvent({
  level: 'error',
  name: 'TypeError',
  message: 'x is not a function',
  path: '/card/42?tab=ai',
});
check(okError.ok === true && okError.event.name === 'TypeError', '正常错误事件通过');
check(okError.event.path === '/card/:id', '路径里的数字段被抹成 :id，查询串被去掉', okError.event.path);
check(typeof okError.event.ts === 'number', '缺省 ts 自动补当前时间');

// ========== 2. 白名单与截断 ==========
const unknownLevel = normalizeEvent({ level: 'debug', message: 'hi' });
check(unknownLevel.ok && unknownLevel.event.level === 'error', '未知 level 归一到 error（宁可多记不丢）');

const longMessage = normalizeEvent({ level: 'error', message: 'x'.repeat(900) });
check(
  longMessage.ok && longMessage.event.message.length === 500 && longMessage.event.message.endsWith('…'),
  '超长 message 截断到 500 字并加省略号',
  String(longMessage.event.message.length),
);

const longContext = normalizeEvent({
  level: 'error',
  message: 'boom',
  context: { blob: 'y'.repeat(5000) },
});
check(
  longContext.ok && longContext.event.context.length === 1000,
  '超长 context 序列化后截断到 1000 字',
  String(longContext.event.context.length),
);

const circular = { name: 'circular' };
circular.self = circular;
const circularEvent = normalizeEvent({ level: 'error', message: 'boom', context: circular });
check(
  circularEvent.ok && circularEvent.event.context === null,
  '无法序列化的 context 被丢弃，但主事件仍然保留',
);

const noName = normalizeEvent({ level: 'warn', message: 'careful' });
check(noName.ok && noName.event.name === 'unknown', '缺 name 时回落为 unknown');

const trimmed = normalizeEvent({ level: 'error', name: '  E  ', message: '  有空格  ' });
check(trimmed.ok && trimmed.event.name === 'E' && trimmed.event.message === '有空格', 'name / message 两侧空白被裁掉');

// 指标数值允许字符串形式的数字（客户端可能从 dataset 读到）
const metric = normalizeEvent({ level: 'metric', name: 'lcp', value: '1234' });
check(metric.ok && metric.event.value === 1234, '指标 value 支持数字字符串');

// ========== 3. 汇总 ==========
const sample = [
  { level: 'error', name: 'E', message: 'a' },
  { level: 'error', name: 'E', message: 'a' },
  { level: 'error', name: 'E', message: 'b' },
  { level: 'warn', name: 'W', message: 'c' },
  { level: 'metric', name: 'lcp', message: '', value: 1000 },
  { level: 'metric', name: 'lcp', message: '', value: 2000 },
  { level: 'metric', name: 'lcp', message: '', value: 3000 },
  { level: 'metric', name: 'cls', message: '', value: 0.1 },
];
const s = summarize(sample);
check(s.total === 8, '总数正确', String(s.total));
check(s.byLevel.error === 3 && s.byLevel.warn === 1 && s.byLevel.metric === 4, '按级别计数正确');
check(s.topMessages[0]?.message === 'a' && s.topMessages[0]?.count === 2, 'topMessages 按出现次数降序');
check(s.metrics.lcp.count === 3 && s.metrics.lcp.max === 3000, '指标统计 count / max 正确');
check(s.metrics.lcp.p50 === 2000 && s.metrics.lcp.p95 === 3000, '指标 p50 / p95 取值正确', `${s.metrics.lcp.p50}/${s.metrics.lcp.p95}`);

const single = summarize([{ level: 'metric', name: 'fid', message: '', value: 42 }]);
check(single.metrics.fid.p50 === 42 && single.metrics.fid.p95 === 42, '单样本 p50 = p95 = 该值');

const empty = summarize([]);
check(empty.total === 0 && Object.keys(empty.metrics).length === 0, '空列表不抛错');
check(summarize(null).total === 0, '非数组输入按空处理');

// topMessages 最多 10 条
const many = Array.from({ length: 15 }, (_, i) => ({ level: 'error', name: 'E', message: `m${i}` }));
check(summarize(many).topMessages.length === 10, 'topMessages 最多返回 10 条');

// ========== 4. 路径归一化 ==========
check(normalizePath('/api/themes/abyss-glass/cover') === '/api/themes/abyss-glass/cover', '非数字段保持原样');
check(normalizePath('/api/friends/12') === '/api/friends/:id', '数字 id 被抹掉');
check(normalizePath('') === '/', '空路径回落到 /');
check(normalizePath('/a#hash?x=1') === '/a', 'hash 与查询串都被去掉');

// ========== 5. Sentry DSN 解析 ==========
const dsn = parseDsn('https://abc123@o1.ingest.sentry.io/456');
check(
  dsn && dsn.key === 'abc123' && dsn.endpoint === 'https://o1.ingest.sentry.io/api/456/store/',
  'DSN 解析出 Store 端点',
  dsn?.endpoint,
);
check(parseDsn('') === null && parseDsn('not-a-url') === null, '空/非法 DSN 返回 null');
check(parseDsn('https://host/456') === null, '缺 key 的 DSN 返回 null');

// ========== 6. i18n 词典一致性 ==========
check(LOCALES.length === 2 && LOCALES.includes('zh') && LOCALES.includes('en'), '支持中英两种语言');
for (const locale of LOCALES) {
  const dict = DICTIONARIES[locale];
  const keys = Object.keys(dict);
  check(keys.length === Object.keys(zh).length, `${locale} 词典 key 数量与中文一致`, String(keys.length));
  check(
    keys.every((k) => typeof dict[k] === 'string' && dict[k].trim().length > 0),
    `${locale} 词典没有空文案`,
  );
}

// 占位符必须两侧一致：否则切换语言后 `{count}` 会原样显示出来
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const mismatched = Object.keys(zh).filter(
  (key) => placeholders(zh[key]) !== placeholders(DICTIONARIES.en[key]),
);
check(mismatched.length === 0, '中英词典的占位符完全一致', mismatched.join(', '));

check(
  Object.keys(zh).length >= 20,
  '词典已覆盖状态栏与设置项',
  `${Object.keys(zh).length} 条`,
);

console.log('\n════════════════════════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('════════════════════════════════════════');
process.exit(fail === 0 ? 0 : 1);

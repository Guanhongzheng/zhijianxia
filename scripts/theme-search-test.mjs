/**
 * 主题广场「意图搜索」行为测试
 *
 * 直接加载 `src/lib/theme/search.ts`（Node 22.6+ 的类型擦除，无需构建或 tsx）。
 * 语料用**真实的 `server/packages/themes`**，不是手写 fixture ——
 * 主题作者改了 tags / description，这里能立刻发现排序跑偏。
 *
 * 重点验证的不是「能搜到」，而是**词表级语义确实生效**：
 * 查询用的词在全部主题元数据里根本不出现（如「深色」「极简」），
 * 却仍能命中对应主题 —— 这才说明走的是概念映射，不是子串匹配。
 *
 * 用法：node scripts/theme-search-test.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuery, searchThemes } from '../src/lib/theme/search.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = join(ROOT, 'server', 'packages', 'themes');

/** 读真实主题目录，转成检索用的结构 */
function loadThemes() {
  if (!existsSync(THEMES_DIR)) return [];
  const themes = [];
  for (const entry of readdirSync(THEMES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(THEMES_DIR, entry.name, 'theme.json');
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    themes.push({
      slug: entry.name,
      name: raw.name ?? entry.name,
      description: raw.description ?? '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      category: raw.category ?? '',
      author: raw.author ?? '',
    });
  }
  return themes;
}

let pass = 0;
let fail = 0;
function check(ok, name, extra = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  →  ' + extra : ''}`);
}

const themes = loadThemes();
console.log(`语料：${themes.length} 个主题（${themes.map((t) => t.slug).join(', ')}）\n`);

const slugs = (list) => list.map((m) => m.item.slug);
const top = (q) => slugs(searchThemes(themes, q))[0];
const all = (q) => slugs(searchThemes(themes, q));

/** 某个词是否真的出现在全部主题元数据里（用于证明「不是子串匹配」） */
const appearsAnywhere = (word) =>
  themes.some((t) =>
    [t.name, t.description, t.category ?? '', t.author ?? '', ...t.tags, t.slug]
      .join(' ')
      .includes(word),
  );

// ========== 1. 空查询与纯停用词：不过滤、不排序 ==========
check(
  searchThemes(themes, '').length === themes.length &&
    slugs(searchThemes(themes, '')).join() === themes.map((t) => t.slug).join(),
  '空查询不过滤且保持原顺序',
);

const stopOnly = parseQuery('帮我找一款主题包');
check(
  stopOnly.empty && searchThemes(themes, '帮我找一款主题包').length === themes.length,
  '只有停用词时视为「没搜索」（不过滤）',
  `empty=${stopOnly.empty} concepts=[${stopOnly.concepts.map((c) => c.label)}] terms=[${stopOnly.terms}]`,
);
check(
  all('好看的主题').length === themes.length && parseQuery('好看的主题').empty,
  '主观词「好看」不参与匹配，但也不该把结果杀成 0 条（视为没搜索）',
  `命中 ${all('好看的主题').length} 条`,
);

// ========== 2. 概念映射：查询词在元数据里完全不出现 ==========
check(
  !appearsAnywhere('深色') && all('深色').length > 0,
  '「深色」这个说法在全部元数据里都不存在，仍能命中（证明走概念映射）',
  `命中 ${all('深色').join(', ')}`,
);
check(
  !appearsAnywhere('极简') && all('极简').length > 0,
  '「极简」同样不存在于元数据，仍能命中（极简 → 简约族）',
  `命中 ${all('极简').join(', ')}`,
);
check(
  !appearsAnywhere('夜景') && top('夜景风格') !== undefined,
  '「夜景」→ 暗色族（多跳同义词）',
  `首项 ${top('夜景风格')}`,
);

// ========== 3. 复合意图：多个概念同时命中应排在最前 ==========
const multi = all('暗色的简约主题');
check(multi.length > 0 && multi[0] === 'abyss-glass', '「暗色的简约主题」首项为 abyss-glass', multi.join(', '));
check(multi.includes('ink-dai'), '「暗色的简约主题」包含 ink-dai（同为暗色）', multi.join(', '));
const parsedMulti = parseQuery('暗色的简约主题');
check(
  parsedMulti.concepts.some((c) => c.id === 'dark') &&
    parsedMulti.concepts.some((c) => c.id === 'minimal') &&
    parsedMulti.terms.length === 0,
  '「暗色的简约主题」被解析为 2 个概念、0 个自由词',
  `concepts=[${parsedMulti.concepts.map((c) => c.label)}] terms=[${parsedMulti.terms}]`,
);

// ========== 4. 各维度的首个结果 ==========
check(top('毛玻璃') !== undefined, '「毛玻璃」有命中', all('毛玻璃').join(', '));
check(top('亮色高饱和') === 'lime-kick', '「亮色高饱和」首项为 lime-kick', all('亮色高饱和').join(', '));
check(top('水墨') === 'ink-dai', '「水墨」首项为 ink-dai', all('水墨').join(', '));
check(top('描边') === 'crimson-rose', '「描边」首项为 crimson-rose', all('描边').join(', '));
check(top('夜间护眼') !== undefined && all('夜间护眼').includes('abyss-glass'), '「夜间护眼」命中 abyss-glass', all('夜间护眼').join(', '));

// ========== 5. 自由关键词（词典之外）仍能命中 ==========
check(top('极光') === 'abyss-glass', '「极光」作为自由关键词命中 abyss-glass', all('极光').join(', '));
check(top('深空琉璃') === 'abyss-glass', '「深空琉璃」按名称命中', all('深空琉璃').join(', '));

// ========== 6. 英文与边界匹配 ==========
check(all('glass').includes('abyss-glass'), '英文 `glass` 命中 slug abyss-glass', all('glass').join(', '));
check(
  all('ink').every((s) => s !== 'lime-kick') && all('ink').length > 0,
  '英文 `ink` 不会误命中含 `k` 的无关词（按词边界匹配）',
  all('ink').join(', '),
);

// ========== 7. 无匹配与控制台可解释性 ==========
check(all('赛博朋克蒸汽波').length === 0, '完全无关的查询返回空', String(all('赛博朋克蒸汽波').length));
const reasonsOf = searchThemes(themes, '暗色的极光')[0]?.reasons ?? [];
check(reasonsOf.length > 0, '命中结果带可读的理由', `[${reasonsOf}]`);

// ========== 8. 阈值与排序：分数必须降序 ==========
const scored = searchThemes(themes, '毛玻璃 亮色');
check(
  scored.every((m, i) => i === 0 || scored[i - 1].score >= m.score),
  '结果按分数降序',
  scored.map((m) => `${m.item.slug}:${m.score.toFixed(1)}`).join(' '),
);

console.log('\n════════════════════════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('════════════════════════════════════════');
process.exit(fail === 0 ? 0 : 1);

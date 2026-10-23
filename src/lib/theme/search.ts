/**
 * lib/theme/search.ts —— 主题广场的「意图搜索」
 *
 * ## 为什么不搬回向量检索
 *
 * 旧 theme-plaza 工程用 Transformers.js 跑句向量（`frontend/lib/semantic.ts`），
 * 随那个工程一起删掉了。重写前先算了一笔账：
 *
 * 1. **下载成本与收益不成比例**：能跑中文的句向量模型最小也要 ~25 MB
 *    （bge-small-zh q8），而广场当前只有 5 个主题 —— 为了 5 条记录下 25 MB，
 *    对「本地离线优先」的产品是明显的负收益；
 * 2. **失败面大**：向量模型要走 ORT 建 session，本仓库在 ORT 上踩过的坑
 *    已经很多（WebGPU 单缓冲上限、wasm 内存、缓存分片……），
 *    而搜索是「锦上添花」的能力，不值得让它成为新的错误来源；
 * 3. **语料本身是结构化的**：主题作者写了 tags（暗色 / 毛玻璃 / 描边…）、
 *    category 和一段说得清的 description。这类语料用「概念词典 + 字段加权」
 *    就能拿到可解释的结果，且瞬时、零下载、可单测。
 *
 * 所以这里做的是**词表级语义**：把「深色 / 夜间 / 深空」归一到「暗色」，
 * 把「极简 / 干净 / 留白」归一到「简约」，再按字段权重打分排序。
 *
 * ## 边界（要诚实）
 *
 * - 它不是通用语义理解：超出词典的表达（「像咖啡馆那种感觉」）搜不到，
 *   会退化成**关键词子串匹配** —— 与改造前完全一致，不会更差；
 * - 词典是产品语汇，不是语言学完备集。新主题用了新词，往 `CONCEPTS`
 *   里加一条 alias 即可，不需要改算法；
 * - 主题量级上到 200+ 之后再加向量重排，届时在 `searchThemes` 后接一个
 *   rerank 即可，本模块的接口不用动。
 */

/** 参与检索的主题字段（`PlazaTheme` 结构上兼容它，故可直接传入） */
export interface SearchableTheme {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  category?: string;
  author?: string;
}

/** 一个「概念」= 一组同义表达 + 给用户看的短名 */
export interface ThemeConcept {
  id: string;
  /** 展示名（搜索框下方会显示「理解为：暗色 · 简约」） */
  label: string;
  /** 同义表达，命中最短的一个即可激活概念 */
  aliases: string[];
}

export interface ThemeMatch<T> {
  item: T;
  score: number;
  /** 命中理由（概念名或自由关键词），用于向用户解释排序 */
  reasons: string[];
}

export interface ParsedThemeQuery {
  concepts: ThemeConcept[];
  /** 词典外剩下的自由关键词 */
  terms: string[];
  /** 无有效意图（空串，或只有「的 / 主题 / 帮我找」这类停用词） */
  empty: boolean;
}

/**
 * 概念词典。
 *
 * 收录标准：**同一件事的不同说法**，且确实会出现在主题元数据里。
 * 不收「好看 / 高级」这类主观词 —— 它们无法对应到任何主题属性。
 */
const CONCEPTS: readonly ThemeConcept[] = [
  {
    id: 'dark',
    label: '暗色',
    aliases: ['暗色', '深色', '暗黑', '暗夜', '夜色', '夜景', '夜间', '黑夜', '深空', '午夜', 'dark', 'night'],
  },
  {
    id: 'light',
    label: '亮色',
    aliases: ['亮色', '浅色', '明亮', '纯白', '白色', '日间', '白天', '清爽', '白', 'light', 'bright'],
  },
  {
    id: 'glass',
    label: '毛玻璃',
    aliases: ['毛玻璃', '玻璃', '磨砂', '半透明', '模糊', 'glass', 'frosted', 'blur'],
  },
  {
    id: 'minimal',
    label: '简约',
    // 「通透 / 留白 / 极淡」在中文界面语境里就是「不堆装饰」，
    // 与 glass 的「通透」重叠是有意的：一条查询可以同时激活两个概念。
    aliases: ['简约', '极简', '简洁', '干净', '留白', '素雅', '朴素', '克制', '通透', '极淡', 'minimal', 'simple', 'clean'],
  },
  {
    id: 'outline',
    label: '描边',
    aliases: ['描边', '边框', '边界', '轮廓', 'outline', 'border'],
  },
  {
    id: 'saturated',
    label: '高饱和',
    aliases: ['高饱和', '鲜艳', '浓烈', '亮眼', '饱和', 'saturated', 'vivid'],
  },
  {
    id: 'warm',
    label: '暖色',
    aliases: ['暖色', '温暖', '暖调', '朱砂', '绯红', '绯', '红', '暖', 'warm', 'red'],
  },
  {
    id: 'cool',
    label: '冷色',
    aliases: ['冷色', '冷调', '清冷', '蓝色', '蓝', '石青', 'cool', 'blue'],
  },
  {
    id: 'ink',
    label: '东方水墨',
    aliases: ['水墨', '东方', '宣纸', '国风', '松烟', 'ink', 'oriental'],
  },
  {
    id: 'immersive',
    label: '沉浸',
    aliases: ['沉浸', '氛围', '影音', '影院', 'immersive'],
  },
  {
    id: 'contrast',
    label: '高对比',
    aliases: ['高对比', '对比度', '清晰', '锐利', 'contrast'],
  },
  {
    id: 'eyecare',
    label: '护眼',
    aliases: ['护眼', '护目', '不刺眼', 'eye-friendly'],
  },
];

/**
 * 停用词：不承载「找什么样的主题」的信息。
 * 注意 `风格` 也进来了 —— 「水墨风格」里的「风格」只是量词性的尾巴。
 */
const STOPWORDS = new Set([
  '的', '了', '吧', '呢', '啊', '和', '与', '或', '带', '有', '很', '太', '最', '更', '是', '在', '用', '要',
  '我', '想', '想要', '找', '找找', '帮我', '请', '推荐', '一个', '一款', '一点', '一些', '比较',
  '主题', '主题包', '皮肤', '界面', '风格', '感觉', '那种', '有没有', '还有', '好看',
]);

/**
 * 可以直接从中文串里「挖掉」的虚词。
 *
 * 中文查询没有空格（`暗色的简约主题`），按分隔符切词只会得到一整个长串，
 * 停用词永远匹配不到 —— 必须在切分**之前**先做子串剔除。
 *
 * 只收「不会出现在别的词内部」的字：
 * `的 / 了 / 吧 / 呢 / 啊` 安全；而 `和 / 有 / 要 / 带` 会把「柔和」「所有」
 * 挖成残词，所以它们只做**整词**停用（走 `STOPWORDS`），不做子串剔除。
 * 更长的词排前面，避免 `主题` 先把 `主题包` 切碎。
 */
const SUBSTRING_STOPWORDS = [
  '主题包', '有没有', '看起来',
  '主题', '皮肤', '界面', '风格', '感觉', '那种', '帮我', '推荐', '想要', '一个', '一款', '一点', '一些', '比较',
  '的', '了', '吧', '呢', '啊',
].sort((a, b) => b.length - a.length);

/**
 * 字段权重。
 *
 * 依据：作者在 `theme.json` 里写 tags / category 是**刻意的自我标注**，
 * 描述是自然语言（噪声更大），名称最凝练。所以 tags 与 name 权重最高。
 */
const CONCEPT_WEIGHTS = {
  name: 3,
  tags: 2.5,
  category: 2,
  slug: 1.2,
  description: 1.2,
  author: 0.3,
} as const;

const TERM_WEIGHTS = {
  name: 2,
  tags: 1.5,
  category: 1,
  slug: 1,
  description: 0.8,
  author: 0.2,
} as const;

/**
 * 单个概念的贡献上限。
 *
 * 不设上限时，一个概念在 name+tags+category+desc 全都出现会拿到 8.7 分，
 * 直接把「命中两个概念的更相关主题」压下去 —— 于是「暗色的简约主题」
 * 会变成「暗色堆料最多的主题」，而不是「又暗又简约的主题」。
 */
const CONCEPT_CAP = 3.5;

/** 是否纯 ASCII（决定要不要按词边界匹配） */
const ASCII_ONLY = /^[\x20-\x7e]+$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判定 `text` 是否包含 `needle`。
 *
 * - 中文：直接子串匹配（无需分词，词典里的词都是完整的语义单元）；
 * - 英文：按「非字母数字」做边界，避免 `art` 命中 `heart`、
 *   `ink` 命中 `thinking`（slug `link-xxx` 之类会踩到）。
 */
function hit(text: string, needle: string): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();
  const word = needle.toLowerCase();
  if (!word) return false;
  if (!ASCII_ONLY.test(word)) return haystack.includes(word);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}($|[^a-z0-9])`).test(haystack);
}

/**
 * 解析查询串。
 *
 * 同一个词可能同时激活多个概念（如「通透」），这是刻意保留的：
 * 用户说「通透」时既想要轻盈的配色、也想要轻量的装饰。
 */
export function parseQuery(query: string): ParsedThemeQuery {
  const raw = (query ?? '').trim().toLowerCase();
  if (!raw) return { concepts: [], terms: [], empty: true };

  const concepts: ThemeConcept[] = [];
  let rest = raw;

  for (const concept of CONCEPTS) {
    const matched = concept.aliases.filter((alias) => hit(raw, alias));
    if (matched.length === 0) continue;
    concepts.push(concept);
    // 命中的别名从剩余文本摘掉，剩下的才当自由关键词 —— 否则「暗色的简约」
    // 会既走概念、又被当成字面词二次计分。
    for (const alias of matched) rest = rest.split(alias).join(' ');
  }

  // 中文没有空格，虚词必须先按子串挖掉，否则「的极光」会被当成一个词
  for (const word of SUBSTRING_STOPWORDS) rest = rest.split(word).join(' ');

  const terms = rest
    .split(/[^\p{L}\p{N}]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !STOPWORDS.has(s));

  return { concepts, terms, empty: concepts.length === 0 && terms.length === 0 };
}

/** 给单个主题打分 */
export function scoreTheme(
  theme: SearchableTheme,
  parsed: ParsedThemeQuery,
): { score: number; reasons: string[] } {
  if (parsed.empty) return { score: 0, reasons: [] };

  const fields = {
    name: theme.name ?? '',
    tags: (theme.tags ?? []).join(' '),
    category: theme.category ?? '',
    slug: theme.slug ?? '',
    description: theme.description ?? '',
    author: theme.author ?? '',
  };
  type Field = keyof typeof fields;
  const fieldNames = Object.keys(fields) as Field[];

  let score = 0;
  const reasons: string[] = [];

  for (const concept of parsed.concepts) {
    let sum = 0;
    for (const field of fieldNames) {
      if (concept.aliases.some((alias) => hit(fields[field], alias))) {
        sum += CONCEPT_WEIGHTS[field];
      }
    }
    if (sum > 0) {
      score += Math.min(sum, CONCEPT_CAP);
      reasons.push(concept.label);
    }
  }

  for (const term of parsed.terms) {
    let sum = 0;
    for (const field of fieldNames) {
      if (hit(fields[field], term)) sum += TERM_WEIGHTS[field];
    }
    if (sum > 0) {
      score += sum;
      reasons.push(term);
    }
  }

  return { score, reasons };
}

/**
 * 检索并排序。
 *
 * - 空查询 / 只有停用词 → 原样返回（不过滤、不排序），保持「没搜索」的语义；
 * - 有意图 → 只返回得分 > 0 的主题，按分数降序；同分保持传入顺序（稳定）。
 */
export function searchThemes<T extends SearchableTheme>(
  themes: readonly T[],
  query: string,
): ThemeMatch<T>[] {
  const parsed = parseQuery(query);

  if (parsed.empty) {
    return themes.map((item) => ({ item, score: 0, reasons: [] }));
  }

  return themes
    .map((item, index) => {
      const { score, reasons } = scoreTheme(item, parsed);
      return { item, score, reasons, index };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, score, reasons }) => ({ item, score, reasons }));
}

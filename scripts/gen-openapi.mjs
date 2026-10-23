/**
 * 从路由源码生成 OpenAPI 3.1 文档
 *
 * 为什么是「解析源码」而不是手写 YAML：
 * 手写一定会漂移 —— 加了接口忘了改文档，文档慢慢就变成历史遗迹。
 * 这里的做法是：路由声明就是唯一事实来源，`npm run api:docs` 重新生成，
 * 契约测试再断言「源码里每条路由都出现在文档里」，漂移会被 CI 拦下。
 *
 * 局限（有意接受，不假装完美）：
 *   - 只解析 `router.get/post/put/patch/delete('<path>')` 这一种写法；
 *   - 请求体的字段结构不反射（JS 没有类型信息），需要时在
 *     `docs/openapi.meta.json` 里人工补充；
 *   - 鉴权只判断是否出现 `requireAuth` / `requireAdmin`。
 *
 * 用法：
 *   npm run api:docs        # 生成 docs/openapi.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_DIR = join(ROOT, 'server', 'src', 'routes');
const INDEX_FILE = join(ROOT, 'server', 'src', 'index.js');
const OUT_FILE = join(ROOT, 'docs', 'openapi.json');
const META_FILE = join(ROOT, 'docs', 'openapi.meta.json');

/** 资源名 → 中文说明（用于自动生成 summary 与 tag） */
const RESOURCE_LABELS = {
  auth: { tag: '账号', label: '账号' },
  notices: { tag: '公告', label: '公告' },
  friends: { tag: '好友', label: '好友' },
  groups: { tag: '群组', label: '群组' },
  messages: { tag: '消息', label: '消息' },
  ai: { tag: 'AI', label: 'AI' },
  registry: { tag: '包仓库', label: '插件包' },
  themes: { tag: '主题', label: '主题' },
};

/**
 * 路径末段 → 动作说明。
 * 同一个路径不同方法语义不同（GET /members 是读取，POST 是添加），
 * 所以支持按方法细化；写成字符串表示该方法通用。
 */
const ACTIONS = {
  login: '登录',
  register: '注册',
  logout: '登出',
  me: { get: '读取当前登录用户', patch: '更新当前登录用户' },
  config: { get: '读取 AI 配置', put: '更新 AI 配置' },
  chat: '对话',
  stream: '流式对话（SSE）',
  image: '生成图像',
  speech: '语音合成',
  request: '发送好友申请',
  accept: '接受好友申请',
  reject: '拒绝好友申请',
  members: { get: '读取群成员', post: '添加群成员', delete: '移除群成员' },
  plugins: { get: '读取插件包', post: '上传插件包', delete: '删除插件包' },
  cover: '读取主题封面',
  download: '下载主题包',
  'theme-file': '导出主题文件',
  wallpaper: '读取主题壁纸',
  previews: '读取主题预览图',
  sync: '触发同步',
};

const VERBS = {
  get: '读取',
  post: '创建',
  put: '更新',
  patch: '更新',
  delete: '删除',
};

/** 收集路由：解析 index.js 的挂载前缀 + 各 routes 文件的声明 */
export function collectRoutes() {
  const indexSrc = readFileSync(INDEX_FILE, 'utf8');

  // const authRoutes = require('./routes/auth');
  const varToFile = new Map();
  for (const m of indexSrc.matchAll(/const\s+(\w+)\s*=\s*require\('\.\/routes\/([\w-]+)'\)/g)) {
    varToFile.set(m[1], m[2]);
  }

  // app.use('/api/auth', authRoutes);
  const mountPrefix = new Map();
  for (const m of indexSrc.matchAll(/app\.use\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/g)) {
    const file = varToFile.get(m[2]);
    if (file) mountPrefix.set(file, m[1]);
  }

  const routes = [];
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const name = basename(file, '.js');
    const prefix = mountPrefix.get(name);
    if (prefix === undefined) continue; // 未被 index.js 挂载的文件（如 registry-validate）

    const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/);
      if (!m) return;
      // 路由路径自带 /api 前缀的（themes.js 挂在根上），直接使用
      const fullPath = m[2].startsWith('/api') ? m[2] : `${prefix}${m[2]}`.replace(/\/$/, '') || '/';
      routes.push({
        method: m[1],
        path: fullPath,
        file: `server/src/routes/${file}`,
        line: i + 1,
        auth: /requireAuth/.test(line),
        admin: /requireAdmin/.test(line),
      });
    });
  }

  // index.js 里内联的健康检查
  if (indexSrc.includes("app.get('/api/health'")) {
    routes.push({
      method: 'get',
      path: '/api/health',
      file: 'server/src/index.js',
      line: indexSrc.slice(0, indexSrc.indexOf("app.get('/api/health'")).split('\n').length,
      auth: false,
      admin: false,
    });
  }

  // 去重（同方法同路径只保留首次声明）
  const seen = new Set();
  return routes
    .filter((r) => {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

/** 由路径推导 tag 与自动 summary */
function describe(route) {
  if (route.path === '/api/health') return { tag: '系统', summary: '健康检查' };

  const segments = route.path.split('/').filter(Boolean);
  const apiIdx = segments.indexOf('api');
  const resourceSeg = segments[apiIdx + 1] ?? '';
  // themes.js 挂在根上，路径形如 /api/themes/...
  const resource = RESOURCE_LABELS[resourceSeg] ? resourceSeg : 'themes';
  const meta = RESOURCE_LABELS[resource];

  // registry 下同时管插件包与主题，标签按第二段细分（分组仍归「包仓库」）
  let label = meta.label;
  if (resourceSeg === 'registry') {
    const sub = segments[apiIdx + 2];
    if (sub === 'themes') label = '主题';
    else if (sub === 'plugins') label = '插件包';
  }

  // 动作：路径里最后一段字面量（跳过 :param）
  const literals = segments.filter((s) => !s.startsWith(':'));
  const last = literals[literals.length - 1];
  const rawAction = ACTIONS[last];
  const action = typeof rawAction === 'string' ? rawAction : rawAction?.[route.method];
  const trailingParam = segments[segments.length - 1]?.startsWith(':');

  let summary;
  if (action) summary = action;
  else if (route.method === 'get') summary = trailingParam ? `${label}详情` : `${label}列表`;
  else summary = `${VERBS[route.method]}${label}`;

  return { tag: meta.tag, summary };
}

/** 把 Express 的 :param 转成 OpenAPI 的 {param} */
function toOpenApiPath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParams(path) {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

/** 生成完整的 OpenAPI 文档对象 */
export function buildDocument(routes) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const meta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8')) : {};

  /** @type {Record<string, any>} */
  const paths = {};
  const tagSet = new Map();

  for (const route of routes) {
    const { tag, summary } = describe(route);
    const override = meta[`${route.method.toUpperCase()} ${route.path}`] ?? {};
    const oaPath = toOpenApiPath(route.path);
    paths[oaPath] ??= {};

    const params = pathParams(route.path);
    paths[oaPath][route.method] = {
      tags: [override.tag ?? tag],
      summary: override.summary ?? summary,
      ...(override.description ? { description: override.description } : {}),
      operationId: `${route.method}${oaPath.replace(/[^A-Za-z0-9]+/g, '_')}`,
      ...(params.length > 0 ? { parameters: params } : {}),
      ...(route.auth ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      ...(override.requestBody ? { requestBody: override.requestBody } : {}),
      responses: {
        200: { description: '成功' },
        ...(route.auth ? { 401: { description: '未登录或登录已过期' } } : {}),
        400: { description: '参数不合法' },
        ...(route.admin ? { 403: { description: '需要管理员权限' } } : {}),
      },
      'x-zj-source': `${route.file}:${route.line}`,
    };
    tagSet.set(override.tag ?? tag, true);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${pkg.description.split('（')[0]} · 后端接口`,
      version: pkg.version,
      description: [
        '本文件由 `npm run api:docs` 从路由源码自动生成，**请勿手工编辑**。',
        '需要补充说明时改 `docs/openapi.meta.json`，再重新生成。',
        '',
        '鉴权方式：先 `POST /api/auth/login` 拿到 token，再在请求头带 `Authorization: Bearer <token>`。',
      ].join('\n'),
    },
    servers: [
      { url: 'http://127.0.0.1:8787', description: '本地后端（默认端口）' },
      { url: 'http://localhost:8787', description: '本地后端（localhost）' },
    ],
    tags: [...tagSet.keys()].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque',
          description: '登录接口返回的 token',
        },
      },
    },
  };
}

/** 生成并写盘；返回 { doc, routes } */
export function generate() {
  const routes = collectRoutes();
  const doc = buildDocument(routes);
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return { doc, routes };
}

// 直接运行时执行生成
if (process.argv[1] && process.argv[1].endsWith('gen-openapi.mjs')) {
  const { doc, routes } = generate();
  const count = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  console.log(`已生成 docs/openapi.json：${count} 个操作 / ${routes.length} 条路由 / ${doc.tags.length} 个分组`);
}

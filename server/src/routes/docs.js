'use strict';

/**
 * docs.js —— 接口文档通道
 *
 * GET /api/openapi.json  机器可读的 OpenAPI 3.1 描述（Postman / SDK 生成器可导入）
 * GET /api/docs          人可读的查看页（纯内联 HTML，不依赖 CDN —— 局域网/离线可用）
 *
 * 文档本身由 `npm run api:docs` 从路由源码生成并提交到仓库。
 * 这里**只读不生成**：服务运行时不应该改工作区文件。
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const router = express.Router();

/** 生成产物路径：<repo>/docs/openapi.json */
const DOC_FILE = path.join(__dirname, '..', '..', '..', 'docs', 'openapi.json');

/**
 * 读一次缓存起来，但**按 mtime 失效**。
 *
 * 最早写成「进程内永久缓存」，代价是 `npm run api:docs` 之后必须重启后端才生效 ——
 * 而「改了路由重新生成文档」恰恰是开发时最常做的事。
 */
let cached = null;
let cachedMtime = 0;
function loadDoc() {
  const stat = fs.statSync(DOC_FILE);
  if (cached && stat.mtimeMs === cachedMtime) return cached;
  cached = JSON.parse(fs.readFileSync(DOC_FILE, 'utf8'));
  cachedMtime = stat.mtimeMs;
  return cached;
}

router.get('/api/openapi.json', (req, res) => {
  try {
    res.json(loadDoc());
  } catch {
    res.status(503).json({
      error: '接口文档尚未生成，请在仓库根目录执行 npm run api:docs',
    });
  }
});

/** HTML 转义：文档里的路径与摘要都可能包含尖括号 */
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const METHOD_COLORS = {
  get: '#0b7285',
  post: '#2b8a3e',
  put: '#9c6c00',
  patch: '#9c6c00',
  delete: '#a61e4d',
};

router.get('/api/docs', (req, res) => {
  let doc;
  try {
    doc = loadDoc();
  } catch {
    res
      .status(503)
      .type('html')
      .send('<!doctype html><meta charset="utf-8"><p>接口文档尚未生成，请执行 <code>npm run api:docs</code>。</p>');
    return;
  }

  // 按 tag 分组，组内按路径排序
  /** @type {Map<string, {method: string, path: string, op: any}[]>} */
  const groups = new Map();
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const tag = op.tags?.[0] ?? '其它';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push({ method, path: p, op });
    }
  }

  const section = (tag, rows) => `
    <section>
      <h2>${esc(tag)} <span class="count">${rows.length}</span></h2>
      <table>
        ${rows
          .map(
            ({ method, path, op }) => `
          <tr>
            <td><span class="m" style="background:${METHOD_COLORS[method] ?? '#555'}">${method.toUpperCase()}</span></td>
            <td class="path">${esc(path)}</td>
            <td>${esc(op.summary ?? '')}</td>
            <td class="auth">${op.security?.length ? '需登录' : ''}</td>
            <td class="src">${esc(op['x-zj-source'] ?? '')}</td>
          </tr>`,
          )
          .join('')}
      </table>
    </section>`;

  const body = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([tag, rows]) => section(tag, rows.sort((a, b) => a.path.localeCompare(b.path))))
    .join('');

  const opCount = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);

  res.type('html').send(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.info.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0 auto; max-width: 1080px; padding: 32px 20px 64px; color: #1f2933; background: #fbfcfd; }
  @media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } table { background: #161b22 !important; } th { background: #1f2630 !important; } td { border-color: #262d38 !important; } .path { color: #79c0ff !important; } .src { color: #6e7681 !important; } }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 15px; margin: 28px 0 8px; display: flex; align-items: center; gap: 8px; }
  .count { font-weight: 400; font-size: 12px; opacity: .6; }
  p.sub { margin: 0 0 4px; opacity: .72; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  th { text-align: left; font-size: 12px; background: #f3f5f7; padding: 8px 10px; font-weight: 600; }
  td { padding: 7px 10px; border-top: 1px solid #eef1f4; vertical-align: top; }
  .m { display: inline-block; min-width: 56px; text-align: center; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: .3px; padding: 2px 6px; }
  .path { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; color: #0b4f9c; word-break: break-all; }
  .auth { opacity: .65; font-size: 12px; white-space: nowrap; }
  .src { opacity: .5; font-size: 11.5px; font-family: ui-monospace, Consolas, monospace; white-space: nowrap; }
  .note { margin-top: 32px; font-size: 12.5px; opacity: .7; line-height: 1.8; }
  code { background: rgba(127,127,127,.14); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
  <h1>${esc(doc.info.title)}</h1>
  <p class="sub">v${esc(doc.info.version)} · 共 ${opCount} 个操作 · OpenAPI ${esc(doc.openapi)}</p>
  <p class="sub">鉴权：先 <code>POST /api/auth/login</code> 取 token，之后请求头带 <code>Authorization: Bearer &lt;token&gt;</code>。</p>
  ${body}
  <p class="note">
    本页由路由源码生成，不要手工编辑。<br>
    机器可读版本：<a href="/api/openapi.json">/api/openapi.json</a>（可导入 Postman / Swagger Editor）。<br>
    改了路由请执行 <code>npm run api:docs</code> 重新生成，否则契约测试会红。
  </p>
</body>
</html>`);
});

module.exports = router;

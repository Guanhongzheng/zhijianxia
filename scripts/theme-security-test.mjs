/**
 * scripts/theme-security-test.mjs —— 主题接口的路径穿越安全测试
 *
 * ⚠️ 为什么必须用**原始 socket** 测
 *
 * curl 与 fetch 都会在**客户端**把 `..` 规范化掉：
 *   fetch('/api/themes/x/previews/..')  实际发出 '/api/themes/x/'
 * 用它们测「服务端是否防护了穿越」根本测不出来 ——
 * 攻击已被客户端消解了，服务端收到时已是合法路径。
 *
 * 所以这里用 node:net 逐字节发送真实请求，
 * 模拟攻击者直接构造 HTTP 报文的情形。
 */

import net from 'node:net';

const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';

let pass = 0;
let fail = 0;

/**
 * 判断响应是否为图片。
 *
 * 同时校验 Content-Type 与**文件魔数** —— 只信 Content-Type 的话，
 * 服务端返回 JSON 错误页也会被误判为图片。
 *
 * 刻意不绑定具体格式：主题仓库的封面可能是 png / jpg / webp，
 * 格式演进时这个断言不需要跟着改。
 *
 * @param {{ headers: string, body: string }} res
 */
function isImage(res) {
  if (!/content-type:\s*image\//i.test(res.headers)) return false;
  const body = res.body;
  // PNG: 89 50 4E 47
  if (body.startsWith('\x89PNG')) return true;
  // JPEG: FF D8 FF
  if (body.startsWith('\xFF\xD8\xFF')) return true;
  // WebP: "RIFF" .... "WEBP"
  if (body.slice(0, 4) === 'RIFF' && body.slice(8, 12) === 'WEBP') return true;
  // GIF: "GIF8"
  if (body.startsWith('GIF8')) return true;
  return false;
}

/** 用原始 socket 发一个请求，返回 { status, body, headers } */
function rawRequest(rawPath) {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, HOST, () => {
      sock.write(
        `GET ${rawPath} HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nConnection: close\r\n\r\n`,
      );
    });
    // ⚠️ 必须累加 **Buffer** —— 用字符串拼接会把二进制按 UTF-8 解码，
    // 图片字节序列会被破坏（0x89 变成 U+FFFD），魔数永远比对不上。
    const chunks = [];
    sock.on('data', (d) => {
      chunks.push(d);
    });
    sock.on('end', () => {
      const buf = Buffer.concat(chunks);
      const status = Number((buf.toString('latin1').split(' ')[1] || '0').trim());
      // ⚠️ 二进制响应（图片）里可能出现 \r\n\r\n，
      // 所以只能按**第一个**分隔符切，不能用 split('\r\n\r\n') 全部切。
      const sep = buf.indexOf('\r\n\r\n');
      const headers = sep >= 0 ? buf.toString('latin1', 0, sep) : buf.toString('latin1');
      // body 用 latin1 解码 —— 二进制字节不会被 UTF-8 替换成 U+FFFD，
      // 这样图片魔数才能被逐字节比对。
      const body = sep >= 0 ? buf.toString('latin1', sep + 4) : '';
      resolve({ status, body, headers });
    });
    sock.on('error', (e) => resolve({ status: 0, body: `ERR ${e.message}`, headers: '' }));
  });
}

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}  ${detail ?? ''}`);
  }
}

/** 断言：400 且响应体不含文件内容 */
async function expect400(rawPath, label) {
  const r = await rawRequest(rawPath);
  const leaked =
    r.body.includes('root:') ||
    r.body.includes('passwd') ||
    r.body.includes('Windows') ||
    r.body.includes('node_modules');
  check(label, r.status === 400 && !leaked, `status=${r.status} body=${r.body.slice(0, 90)}`);
}

console.log('════════════════════════════════════════');
console.log('  主题接口 · 路径穿越安全测试');
console.log('════════════════════════════════════════');
console.log('');

/* ---------------- 编码穿越 ---------------- */
console.log('[编码穿越]');
await expect400('/api/themes/..%2F..%2Fetc/passwd', 'slug 编码穿越');
await expect400('/api/themes/..%2F..%2Fetc/passwd/cover', 'cover 编码穿越');
await expect400('/api/themes/win11-light/previews/..%2F..%2F..%2Fetc%2Fpasswd', 'preview 编码穿越');
await expect400('/api/themes/a%2Fb', 'slug 含编码斜杠');
await expect400('/api/themes/a%5Cb', 'slug 含编码反斜杠');
await expect400('/api/themes/a%00b', 'slug 含 NUL');
await expect400('/api/themes/win11-light/wallpaper/..%2F..%2Fetc%2Fpasswd', 'wallpaper 编码穿越');

/* ---------------- 双编码 ---------------- */
console.log('');
console.log('[双编码]');
await expect400('/api/themes/%252e%252e%252f%252e%252e%252fetc/passwd', '双编码穿越');
await expect400('/api/themes/x/previews/%252e%252e%252f%252e%252e%252fetc', '双编码（preview）');

/* ---------------- 字面 .. ---------------- */
console.log('');
console.log('[字面 ..]');
await expect400('/api/themes/../etc/passwd', '字面 .. 穿越');
await expect400('/api/themes/win11-light/previews/..', 'preview 字面 ..');
await expect400('/api/themes/win11-light/previews/../theme.json', 'preview 相对路径');

/* ---------------- 合法路径仍要能用 ---------------- */
console.log('');
console.log('[合法路径]');
const ok = await rawRequest('/api/themes');
check('GET /api/themes 返回 200', ok.status === 200, `status=${ok.status}`);

const cover = await rawRequest('/api/themes/abyss-glass/cover');
check(
  'GET /api/themes/abyss-glass/cover 返回 200 且是图片',
  cover.status === 200 && isImage(cover),
  `status=${cover.status} type=${/content-type:\s*(\S+)/i.exec(cover.headers)?.[1] ?? '?'}`,
);

const preview = await rawRequest('/api/themes/abyss-glass/previews/screen-1.webp');
check(
  'GET 预览图返回 200 且是图片',
  preview.status === 200 && isImage(preview),
  `status=${preview.status}`,
);

const notFound = await rawRequest('/api/themes/no-such-theme-xyz');
check('不存在的 slug 返回 404', notFound.status === 404, `status=${notFound.status}`);

const badSlug = await rawRequest('/api/themes/.hidden');
check('非法 slug 返回 400 或 404（不得 200）', badSlug.status !== 200, `status=${badSlug.status}`);

console.log('');
console.log('════════════════════════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('════════════════════════════════════════');

process.exit(fail > 0 ? 1 : 0);

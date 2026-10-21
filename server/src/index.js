'use strict';

/**
 * index.js —— 智简匣后端服务主入口
 *
 * 技术栈：Express 4 + ws 8 + node:sqlite（内置模块，零原生编译）
 * 启动：node server/src/index.js
 * 环境变量：
 *   PORT  端口，默认 8787
 *   HOST  监听地址，默认 0.0.0.0
 */

const express = require('express');
const cors = require('cors');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { DB_FILE } = require('./db');
const { initDatabase } = require('./init-db');
const hub = require('./ws/hub');

const authRoutes = require('./routes/auth');
const noticeRoutes = require('./routes/notices');
const friendRoutes = require('./routes/friends');
const groupRoutes = require('./routes/groups');
const messageRoutes = require('./routes/messages');
const aiRoutes = require('./routes/ai-proxy');
const registryRoutes = require('./routes/registry');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

// CORS 全放行：局域网场景，前端可能来自 http://localhost:3000
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));

// 确保表结构存在（首次启动自动初始化，无需手动执行 init-db）
initDatabase();

// ---------- 路由挂载 ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'zhijianxia-server',
    time: Date.now(),
    online: hub.onlineUids(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/registry', registryRoutes);

/**
 * 主题资源静态服务：/theme-assets/<theme-id>/assets/<file>
 *
 * 对应 theme.json 中 `"wallpaper": "assets/wallpaper.webp"`
 * 这类相对路径，实际读取 `/theme-assets/pure-light/assets/wallpaper.webp`。
 *
 * 用静态托管而非逐个接口，是因为壁纸 / BGM 都是静态二进制，
 * 让浏览器自行管理缓存与 Range 请求更合适。
 */
app.use(
  '/theme-assets',
  express.static(path.join(__dirname, '..', 'packages', 'themes'), {
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      const rel = path.relative(
        path.join(__dirname, '..', 'packages', 'themes'),
        filePath
      );
      // rel 形如 pure-light/assets/wallpaper.webp
      if (!rel.split(path.sep).includes('assets')) {
        res.status(404);
        return;
      }
      // 前端启用了跨域隔离（COEP: require-corp，用于 WebGPU / 多线程 WASM），
      // 跨源资源必须显式允许嵌入，否则壁纸会被浏览器拦截。
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  }),
);

// 未匹配的接口
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 统一错误处理：只返回中文提示，不抛堆栈
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法的 JSON' });
  }
  console.error('[server] 未捕获错误：', err);
  return res.status(500).json({ error: '服务器内部错误，请稍后重试' });
});

// ---------- HTTP + WebSocket ----------
const server = http.createServer(app);
hub.attach(server);
hub.startHeartbeat(30000);

/**
 * 收集所有局域网 IPv4 地址，方便用户在前端设置里填写后端地址
 * @returns {{name:string, address:string}[]}
 */
function listLanAddresses() {
  const nets = os.networkInterfaces();
  const result = [];
  for (const [name, addresses] of Object.entries(nets)) {
    for (const addr of addresses || []) {
      // Node 18+ family 为 'IPv4'/'IPv6'，老版本为数字 4
      const isIPv4 = addr.family === 'IPv4' || addr.family === 4;
      if (isIPv4 && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
}

server.listen(PORT, HOST, () => {
  const lan = listLanAddresses();
  const line = '─'.repeat(52);

  console.log('');
  console.log(line);
  console.log('  智简匣 · 后端服务已启动');
  console.log(line);
  console.log(`  本机访问   : http://127.0.0.1:${PORT}`);
  console.log(`  健康检查   : http://127.0.0.1:${PORT}/api/health`);
  console.log(`  WebSocket  : ws://127.0.0.1:${PORT}/ws?token=xxx&uid=ZJ-XXXXXX`);
  if (lan.length === 0) {
    console.log('  局域网地址 : 未检测到局域网 IPv4（请检查网络连接）');
  } else {
    console.log('  局域网地址（填入前端「后端设置」）：');
    for (const item of lan) {
      console.log(`    · ${item.address.padEnd(16)} (${item.name})  ->  http://${item.address}:${PORT}`);
    }
  }
  console.log(`  数据库文件 : ${DB_FILE}`);
  console.log(line);
  console.log('');
});

// 优雅退出
function shutdown(signal) {
  console.log(`\n[server] 收到 ${signal}，正在关闭服务...`);
  hub.close();
  server.close(() => process.exit(0));
  // 兜底：3 秒后强制退出
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;

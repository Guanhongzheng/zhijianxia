# 容器内的进程编排：前端（Next standalone）+ 可选后端（Express）
#
# 为什么用 Node 脚本而不是 `concurrently` / `pm2`：
# 只为一个「起两个进程、一起收信号」的需求引入运行时依赖不值得，
# 而且这个脚本要能在最小镜像里跑（无 shell 工具链）。

import { spawn } from 'node:child_process';

const WEB_PORT = process.env.ZJ_WEB_PORT || '3000';
const WITH_SERVER = process.env.ZJ_WITH_SERVER !== '0';

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function start(name, args) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ...(name === 'web' ? { PORT: WEB_PORT } : {}) },
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // 任一进程退出都让容器整体退出，交给编排系统重启，
    // 而不是留一个「半死」的容器继续接流量。
    console.error(`[start] ${name} 退出（code=${code}, signal=${signal}），容器停止`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 3000).unref();
  process.exitCode = code;
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

if (WITH_SERVER) start('server', ['server/src/index.js']);
start('web', ['web/server.js']);

console.log(`[start] 前端 http://0.0.0.0:${WEB_PORT}${WITH_SERVER ? ' · 后端 :8787' : '（未启动后端）'}`);

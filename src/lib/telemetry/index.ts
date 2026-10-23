/**
 * 前端错误与性能采集（无依赖，自建上报）
 *
 * 设计约束：
 *   - **不打第三方域名**：事件发到自家后端 /api/telemetry，局域网内闭环；
 *   - **不阻塞**：批量 + `sendBeacon`，页面关闭也不丢最后一批；
 *   - **可关闭**：`localStorage['zhijianxia:telemetry'] = 'off'` 即完全停用；
 *   - **不采集隐私**：无用户 id、无输入内容；路径里的数字段在服务端会被抹掉。
 *
 * 采集内容：
 *   1. 未捕获异常与未处理的 Promise 拒绝；
 *   2. Web Vitals 的三个核心指标（LCP / CLS / INP 近似值）。
 */

export type TelemetryLevel = 'error' | 'warn' | 'info' | 'metric';

export interface TelemetryEvent {
  level: TelemetryLevel;
  name: string;
  message: string;
  value?: number;
  context?: Record<string, unknown>;
  path?: string;
  ts: number;
}

const STORAGE_KEY = 'zhijianxia:telemetry';
/** 与 src/lib/backend/client.ts 的 LAN_CONFIG_KEY 保持一致 */
const LAN_CONFIG_KEY = 'zj-lan-config';
const DEFAULT_BACKEND_PORT = 8787;
const MAX_QUEUE = 50;
const MAX_BATCH = 20;
const FLUSH_INTERVAL_MS = 15_000;

/**
 * 上报地址必须跟随「后端地址」设置。
 *
 * 早期写成相对路径 `/api/telemetry`，实际打到了前端 dev server（3000），
 * 后端根本没收到 —— 而这类失败是静默的，只能靠对库表计数才发现。
 */
function resolveEndpoint(): string {
  let host = 'localhost';
  let port = DEFAULT_BACKEND_PORT;
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(LAN_CONFIG_KEY);
      if (raw) {
        const cfg = JSON.parse(raw) as { host?: string; port?: number };
        if (typeof cfg.host === 'string' && cfg.host.trim()) host = cfg.host.trim();
        if (Number.isFinite(cfg.port)) port = Number(cfg.port);
      }
    } catch {
      // 配置坏了就用默认地址，不要因此让采集崩掉
    }
  }
  return `http://${host}:${port}/api/telemetry`;
}

const queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** 是否启用（默认启用；显式写 'off' 才关闭） */
export function isTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setTelemetryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // 存不下就只影响本次会话
  }
}

function currentPath(): string {
  if (typeof location === 'undefined') return '/';
  return location.pathname;
}

function enqueue(event: TelemetryEvent): void {
  if (!isTelemetryEnabled()) return;
  // 队列满时丢最早的：宁可缺历史，也不要让内存无限长
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(event);
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : new Error(String(error));
  enqueue({
    level: 'error',
    name: err.name || 'Error',
    message: err.message || '未知错误',
    context: {
      ...context,
      // 只留前 6 行栈，足够定位，也避免把整包 bundle 路径塞进库里
      stack: err.stack?.split('\n').slice(0, 6).join('\n'),
    },
    path: currentPath(),
    ts: Date.now(),
  });
}

export function reportWarn(message: string, context?: Record<string, unknown>): void {
  enqueue({ level: 'warn', name: 'warn', message, context, path: currentPath(), ts: Date.now() });
}

export function reportMetric(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  enqueue({ level: 'metric', name, message: '', value, path: currentPath(), ts: Date.now() });
}

/** 发送一批（优先 sendBeacon，页面卸载时也能发出去） */
function flush(useBeacon = false): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  const payload = JSON.stringify({ events: batch });
  const endpoint = resolveEndpoint();

  try {
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // 故意用 text/plain：跨域 beacon 若声明 application/json 会触发预检，
      // 而 beacon 无法完成预检，请求会被直接丢弃。服务端两种都接受。
      const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // 后端未开启是常态（前端可独立运行）—— 这类失败必须静默
    });
  } catch {
    // 同上：采集失败绝不影响应用
  }
}

/** Web Vitals 的轻量采集（不引 web-vitals 依赖） */
function observeVitals(): void {
  if (typeof PerformanceObserver === 'undefined') return;

  try {
    // LCP：最大内容绘制，单位毫秒
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
      if (last) reportMetric('lcp', Math.round(last.startTime));
    }).observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit);
  } catch {
    // Safari 老版本不支持该 entry 类型
  }

  try {
    // CLS：累计布局偏移（无单位，越小越好）
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
      reportMetric('cls', Math.round(cls * 1000) / 1000);
    }).observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit);
  } catch {
    // 同上
  }

  try {
    // INP 近似：首次输入延迟（真实 INP 需要持续采样，这里取最差一次作为保守估计）
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { processingStart: number })[]) {
        reportMetric('fid', Math.round(entry.processingStart - entry.startTime));
      }
    }).observe({ type: 'first-input', buffered: true } as PerformanceObserverInit);
  } catch {
    // 同上
  }
}

let installed = false;

/**
 * 启动采集。重复调用无副作用；返回卸载函数（主要供测试使用）。
 */
export function initTelemetry(): () => void {
  if (typeof window === 'undefined' || installed || !isTelemetryEnabled()) {
    return () => {};
  }
  installed = true;
  started = true;

  const onError = (event: ErrorEvent) => {
    reportError(event.error ?? event.message, { source: 'window.onerror' });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, { source: 'unhandledrejection' });
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush(true);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onHidden);

  observeVitals();
  timer = setInterval(() => flush(), FLUSH_INTERVAL_MS);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    document.removeEventListener('visibilitychange', onHidden);
    if (timer) clearInterval(timer);
    flush(true);
    installed = false;
    started = false;
  };
}

/** 供调试与「立即上报」按钮使用 */
export function flushTelemetry(): void {
  flush();
}

/** 是否已经开始采集（调试用） */
export function isStarted(): boolean {
  return started;
}

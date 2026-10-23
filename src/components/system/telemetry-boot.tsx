'use client';

/**
 * 采集启动器：一个只跑副作用的空组件。
 *
 * 单独成组件是为了让 `layout.tsx` 保持服务端组件 —— 采样逻辑必须在浏览器里跑，
 * 但没必要因此把整棵树变成客户端。
 *
 * 卸载时会 `flush(true)`（走 sendBeacon），所以路由切换/关闭页面不丢最后一批事件。
 */

import { useEffect } from 'react';
import { initTelemetry } from '@/lib/telemetry';

export function TelemetryBoot() {
  useEffect(() => initTelemetry(), []);
  return null;
}

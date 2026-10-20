/**
 * WebSocket 客户端 —— 局域网实时通信（好友在线状态、群聊消息）。
 * 后端未启动时不建立连接，状态由 store 维护。
 */

import { backendWsUrl, type LanConfig } from './client';

export interface WsMessage {
  type: string;
  payload?: unknown;
  [key: string]: unknown;
}

export interface WsHandlers {
  onMessage?: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onPresence?: (online: string[]) => void;
}

export class LanSocket {
  private ws: WebSocket | null = null;
  private cfg: LanConfig;
  private token: string | null;
  private uid: string | null;
  private handlers: WsHandlers;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private retryCount = 0;

  constructor(
    cfg: LanConfig,
    token: string | null,
    uid: string | null,
    handlers: WsHandlers = {},
  ) {
    this.cfg = cfg;
    this.token = token;
    this.uid = uid;
    this.handlers = handlers;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.closedByUser = false;

    const url = `${backendWsUrl(this.cfg)}?token=${encodeURIComponent(this.token ?? '')}&uid=${encodeURIComponent(this.uid ?? '')}`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retryCount = 0;
      this.handlers.onOpen?.();
    };

    this.ws.onmessage = (ev) => {
      let data: WsMessage;
      try {
        data = JSON.parse(String(ev.data)) as WsMessage;
      } catch {
        return;
      }
      if (data.type === 'presence') {
        const online = Array.isArray(data.online)
          ? (data.online as string[])
          : [];
        this.handlers.onPresence?.(online);
      }
      this.handlers.onMessage?.(data);
    };

    this.ws.onerror = () => {
      this.handlers.onError?.();
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.handlers.onClose?.();
      if (!this.closedByUser && this.cfg.autoReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // 退避重连：1s → 2s → 4s → 8s，最多 8s
    const delay = Math.min(8000, 1000 * 2 ** this.retryCount);
    this.retryCount += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /** 发送消息（未连接时静默丢弃） */
  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  /** 发送聊天消息 */
  sendChat(scope: 'direct' | 'group', target: string, body: string) {
    return this.send({ type: 'message', scope, target, body });
  }

  /** 发送正在输入 */
  sendTyping(target: string) {
    return this.send({ type: 'typing', target });
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

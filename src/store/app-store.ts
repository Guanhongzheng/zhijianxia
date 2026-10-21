'use client';

import { create } from 'zustand';
import {
  API_CONFIG_KEY,
  DEFAULT_API_CONFIG,
  DEFAULT_LAN_CONFIG,
  type ApiConfig,
  type LanConfig,
} from '@/lib/backend/client';
import {
  fetchFriends,
  fetchGroups,
  fetchNotices,
  type Friend,
  type Group,
  type Notice,
} from '@/lib/backend/api';
import { readLocal, writeLocal } from '@/lib/utils';

/** 登录令牌在 localStorage 中的键（与 auth-store 保持一致） */
const TOKEN_KEY = 'zj-token';
/** 局域网配置在 localStorage 中的键 */
const LAN_CONFIG_KEY_LOCAL = 'zj-lan-config';

// ---------------------------------------------------------------------------
// 应用级状态：后端连接、局域网配置、API 配置、公告、好友、群聊、插件
// ---------------------------------------------------------------------------

export interface AppState {
  // ---- 局域网 / 后端 ----
  lan: LanConfig;
  api: ApiConfig;
  /** 后端是否在线 */
  backendOnline: boolean;
  /** 正在检测后端 */
  checking: boolean;
  /** 后端检测轮询句柄 */
  setLan: (cfg: Partial<LanConfig>) => void;
  setApi: (cfg: Partial<ApiConfig>) => void;
  checkBackend: () => Promise<boolean>;

  // ---- 公告 ----
  notices: Notice[];
  noticesLoading: boolean;
  noticesLoaded: boolean;
  loadNotices: () => Promise<void>;
  refreshNotices: () => Promise<void>;

  // ---- 好友 ----
  /** 已建立的好友 */
  friends: Friend[];
  /** 收到的待处理好友请求 */
  friendRequests: Friend[];
  friendsLoading: boolean;
  onlineUids: string[];
  loadFriends: () => Promise<void>;
  setOnlineUids: (uids: string[]) => void;

  // ---- 群聊 ----
  groups: Group[];
  groupsLoading: boolean;
  loadGroups: () => Promise<void>;

  // ---- UI ----
  /** 当前打开的卡片弹窗 ID */
  activeCard: string | null;
  openCard: (id: string | null) => void;
  /**
   * 页面跳转信号 —— 由业务模块（如退出登录）触发，
   * AppShell 监听后滚动到对应页。0 = 欢迎页，1 = 功能汇总页。
   */
  pageJump: { index: 0 | 1; token: number } | null;
  jumpToPage: (index: 0 | 1) => void;
  /** 提示消息 */
  toast: { id: number; text: string; type: 'info' | 'success' | 'error' } | null;
  notify: (text: string, type?: 'info' | 'success' | 'error') => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // ---- 局域网 / 后端 ----
  lan: readLocal<LanConfig>(LAN_CONFIG_KEY_LOCAL, DEFAULT_LAN_CONFIG),
  api: readLocal<ApiConfig>(API_CONFIG_KEY, DEFAULT_API_CONFIG),
  backendOnline: false,
  checking: false,

  setLan: (cfg) => {
    const next = { ...get().lan, ...cfg };
    writeLocal(LAN_CONFIG_KEY_LOCAL, next);
    set({ lan: next });
  },

  setApi: (cfg) => {
    const next = { ...get().api, ...cfg };
    writeLocal(API_CONFIG_KEY, next);
    set({ api: next });
  },

  checkBackend: async () => {
    set({ checking: true });
    try {
      const { pingBackend } = await import('@/lib/backend/client');
      const online = await pingBackend(get().lan);
      set({ backendOnline: online, checking: false });
      return online;
    } catch {
      set({ backendOnline: false, checking: false });
      return false;
    }
  },

  // ---- 公告 ----
  notices: [],
  noticesLoading: false,
  noticesLoaded: false,

  loadNotices: async () => {
    set({ noticesLoading: true });
    try {
      const list = await fetchNotices(get().lan);
      set({ notices: list, noticesLoading: false, noticesLoaded: true });
    } catch {
      set({ notices: [], noticesLoading: false, noticesLoaded: true });
    }
  },

  refreshNotices: async () => {
    await get().loadNotices();
  },

  // ---- 好友 ----
  friends: [],
  friendRequests: [],
  friendsLoading: false,
  onlineUids: [],

  loadFriends: async () => {
    const lan = get().lan;
    const token = readLocal<string | null>(TOKEN_KEY, null);
    if (!token) {
      set({ friends: [], friendRequests: [], friendsLoading: false });
      return;
    }
    set({ friendsLoading: true });
    try {
      const list = await fetchFriends(lan, token);
      set({
        friends: list.friends,
        friendRequests: list.incoming,
        friendsLoading: false,
      });
    } catch {
      set({ friends: [], friendRequests: [], friendsLoading: false });
    }
  },

  setOnlineUids: (uids) => set({ onlineUids: uids }),

  // ---- 群聊 ----
  groups: [],
  groupsLoading: false,

  loadGroups: async () => {
    const lan = get().lan;
    const token = readLocal<string | null>(TOKEN_KEY, null);
    if (!token) {
      set({ groups: [], groupsLoading: false });
      return;
    }
    set({ groupsLoading: true });
    try {
      const list = await fetchGroups(lan, token);
      set({ groups: list, groupsLoading: false });
    } catch {
      set({ groups: [], groupsLoading: false });
    }
  },

  // ---- UI ----
  activeCard: null,
  openCard: (id) => set({ activeCard: id }),

  pageJump: null,

  jumpToPage: (index) => {
    // 自增 token 保证连续跳转到同一页也能触发
    set({ pageJump: { index, token: Date.now() } });
  },

  toast: null,
  notify: (text, type = 'info') => {
    const id = Date.now();
    set({ toast: { id, text, type } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3200);
  },
}));

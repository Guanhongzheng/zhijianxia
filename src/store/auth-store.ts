'use client';

import { create } from 'zustand';
import {
  fetchMe,
  login as apiLogin,
  register as apiRegister,
  updateProfile,
  type UserProfile,
} from '@/lib/backend/api';
import { BackendOfflineError } from '@/lib/backend/client';
import { readLocal, writeLocal } from '@/lib/utils';
import { useAppStore } from './app-store';

export const TOKEN_KEY = 'zj-token';
export const USER_KEY = 'zj-user';
export const LAN_CONFIG_KEY_LOCAL = 'zj-lan-config';

interface AuthState {
  /** 是否已登录 */
  logged: boolean;
  /** 当前用户资料 */
  user: UserProfile | null;
  /** 登录令牌 */
  token: string | null;
  /** 登录弹窗是否打开 */
  loginDialogOpen: boolean;
  /** 是否为管理员 */
  isAdmin: boolean;
  /** 正在提交登录表单 */
  submitting: boolean;
  /** 表单错误文案 */
  error: string | null;

  /** 从本地存储恢复登录态 */
  restore: () => Promise<void>;
  /** 打开/关闭登录弹窗 */
  openLogin: (reason?: string) => void;
  closeLogin: () => void;
  /** 登录 */
  login: (nickname: string, password: string) => Promise<boolean>;
  /** 注册 */
  register: (nickname: string, password: string) => Promise<boolean>;
  /** 退出登录 */
  logout: () => void;
  /** 更新个人资料 */
  updateUser: (payload: { nickname?: string; bio?: string }) => Promise<boolean>;
  /** 供其它模块判断角色权限 */
  canManage: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  logged: false,
  user: null,
  token: null,
  loginDialogOpen: false,
  isAdmin: false,
  submitting: false,
  error: null,

  restore: async () => {
    const token = readLocal<string | null>(TOKEN_KEY, null);
    const user = readLocal<UserProfile | null>(USER_KEY, null);

    // 本地缓存可能被旧版本写入异常结构，校验后再使用
    const validUser =
      user && typeof user.uid === 'string' && user.uid.length > 0
        ? user
        : null;

    if (validUser) {
      writeLocal(USER_KEY, validUser);
      set({
        token,
        user: validUser,
        logged: true,
        isAdmin: validUser.role === 'admin',
      });
    } else if (user) {
      // 缓存结构损坏，清理后要求重新登录
      writeLocal(USER_KEY, null);
    }

    if (token) {
      // 静默校验令牌有效性，并用服务端最新资料覆盖本地缓存
      const lan = useAppStore.getState().lan;
      try {
        const fresh = await fetchMe(lan, token);
        if (fresh?.uid) {
          writeLocal(USER_KEY, fresh);
          set({ user: fresh, isAdmin: fresh.role === 'admin' });
        }
      } catch {
        /* 令牌失效时保持本地状态，用户可自行重新登录 */
      }
    }
  },

  openLogin: (reason) => {
    set({ loginDialogOpen: true, error: reason ?? null });
  },

  closeLogin: () => {
    set({ loginDialogOpen: false, error: null });
  },

  login: async (nickname, password) => {
    const { lan } = useAppStore.getState();
    set({ submitting: true, error: null });
    try {
      const res = await apiLogin(lan, nickname, password);
      writeLocal(TOKEN_KEY, res.token);
      writeLocal(USER_KEY, res.user);
      set({
        logged: true,
        user: res.user,
        token: res.token,
        isAdmin: res.user.role === 'admin',
        submitting: false,
        loginDialogOpen: false,
        error: null,
      });
      return true;
    } catch (err) {
      const msg =
        err instanceof BackendOfflineError
          ? '后端服务未开启，请启动后端服务后再使用该功能'
          : err instanceof Error
            ? err.message
            : '登录失败，请稍后重试';
      set({ submitting: false, error: msg });
      return false;
    }
  },

  register: async (nickname, password) => {
    const { lan } = useAppStore.getState();
    set({ submitting: true, error: null });
    try {
      const res = await apiRegister(lan, nickname, password);
      writeLocal(TOKEN_KEY, res.token);
      writeLocal(USER_KEY, res.user);
      set({
        logged: true,
        user: res.user,
        token: res.token,
        isAdmin: res.user.role === 'admin',
        submitting: false,
        loginDialogOpen: false,
        error: null,
      });
      return true;
    } catch (err) {
      const msg =
        err instanceof BackendOfflineError
          ? '后端服务未开启，请启动后端服务后再使用该功能'
          : err instanceof Error
            ? err.message
            : '注册失败，请稍后重试';
      set({ submitting: false, error: msg });
      return false;
    }
  },

  logout: () => {
    writeLocal(TOKEN_KEY, null);
    writeLocal(USER_KEY, null);
    set({ logged: false, user: null, token: null, isAdmin: false });
  },

  updateUser: async (payload) => {
    const { lan } = useAppStore.getState();
    const token = get().token;
    if (!token) return false;
    try {
      const fresh = await updateProfile(lan, token, payload);
      writeLocal(USER_KEY, fresh);
      set({ user: fresh });
      return true;
    } catch {
      return false;
    }
  },

  canManage: () => get().user?.role === 'admin',
}));


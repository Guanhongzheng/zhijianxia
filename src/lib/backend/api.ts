/**
 * 后端 API 封装 —— 对应 server/src/routes 下的实际接口。
 * 所有接口在调用前需确保后端在线（由 store 的 backendOnline 判定）。
 */

import {
  backendFetch,
  type LanConfig,
  BackendOfflineError,
} from './client';

// ---------- 通用类型 ----------

export interface UserProfile {
  uid: string;
  nickname: string;
  avatarColor?: string;
  bio?: string;
  role: 'admin' | 'user';
  createdAt?: number | string;
}

export interface Notice {
  id: number;
  title: string;
  body: string;
  authorUid: string;
  createdAt: number | string;
  updatedAt?: number | string;
}

export interface Friend {
  id: number;
  uid: string;
  nickname: string;
  avatarColor?: string;
  bio?: string;
  online?: boolean;
  status?: 'pending' | 'accepted' | 'rejected';
  createdAt?: number | string;
}

export interface Group {
  id: number;
  groupId: string;
  name: string;
  ownerUid: string;
  members?: GroupMember[];
  createdAt?: number | string;
}

export interface GroupMember {
  uid: string;
  nickname: string;
  avatarColor?: string;
  role?: 'owner' | 'member';
}

export interface ChatMessage {
  id: number;
  scope: 'direct' | 'group';
  target: string;
  senderUid: string;
  body: string;
  createdAt: number | string;
}

// ---------- 认证 ----------

export interface AuthResult {
  token: string;
  user: UserProfile;
}

export async function register(
  cfg: LanConfig,
  nickname: string,
  password: string,
): Promise<AuthResult> {
  return backendFetch<AuthResult>(cfg, '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, password }),
  });
}

export async function login(
  cfg: LanConfig,
  nickname: string,
  password: string,
): Promise<AuthResult> {
  return backendFetch<AuthResult>(cfg, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, password }),
  });
}

export async function fetchMe(
  cfg: LanConfig,
  token: string,
): Promise<UserProfile> {
  return backendFetch<UserProfile>(cfg, '/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateProfile(
  cfg: LanConfig,
  token: string,
  payload: { nickname?: string; bio?: string },
): Promise<UserProfile> {
  return backendFetch<UserProfile>(cfg, '/api/auth/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

// ---------- 公告 ----------

export async function fetchNotices(cfg: LanConfig): Promise<Notice[]> {
  const res = await backendFetch<{ notices: Notice[] } | Notice[]>(
    cfg,
    '/api/notices',
  );
  return Array.isArray(res) ? res : (res.notices ?? []);
}

export async function createNotice(
  cfg: LanConfig,
  token: string,
  payload: { title: string; body: string },
): Promise<Notice> {
  return backendFetch<Notice>(cfg, '/api/notices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function updateNotice(
  cfg: LanConfig,
  token: string,
  id: number,
  payload: { title: string; body: string },
): Promise<Notice> {
  return backendFetch<Notice>(cfg, `/api/notices/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteNotice(
  cfg: LanConfig,
  token: string,
  id: number,
): Promise<void> {
  await backendFetch(cfg, `/api/notices/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------- 好友 ----------

export async function fetchFriends(cfg: LanConfig, token: string): Promise<Friend[]> {
  const res = await backendFetch<{ friends: Friend[] } | Friend[]>(
    cfg,
    '/api/friends',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return Array.isArray(res) ? res : (res.friends ?? []);
}

export async function requestFriend(
  cfg: LanConfig,
  token: string,
  uid: string,
): Promise<Friend> {
  return backendFetch<Friend>(cfg, '/api/friends/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ uid }),
  });
}

export async function acceptFriend(
  cfg: LanConfig,
  token: string,
  id: number,
): Promise<void> {
  await backendFetch(cfg, `/api/friends/${id}/accept`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function rejectFriend(
  cfg: LanConfig,
  token: string,
  id: number,
): Promise<void> {
  await backendFetch(cfg, `/api/friends/${id}/reject`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function removeFriend(
  cfg: LanConfig,
  token: string,
  uid: string,
): Promise<void> {
  await backendFetch(cfg, `/api/friends/${uid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------- 群聊 ----------

export async function fetchGroups(cfg: LanConfig, token: string): Promise<Group[]> {
  const res = await backendFetch<{ groups: Group[] } | Group[]>(cfg, '/api/groups', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return Array.isArray(res) ? res : (res.groups ?? []);
}

export async function createGroup(
  cfg: LanConfig,
  token: string,
  name: string,
  memberUids: string[] = [],
): Promise<Group> {
  return backendFetch<Group>(cfg, '/api/groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, memberUids }),
  });
}

export async function fetchGroup(
  cfg: LanConfig,
  token: string,
  groupId: string,
): Promise<Group> {
  return backendFetch<Group>(cfg, `/api/groups/${groupId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function addGroupMember(
  cfg: LanConfig,
  token: string,
  groupId: string,
  uid: string,
): Promise<void> {
  await backendFetch(cfg, `/api/groups/${groupId}/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ uid }),
  });
}

export async function removeGroupMember(
  cfg: LanConfig,
  token: string,
  groupId: string,
  uid: string,
): Promise<void> {
  await backendFetch(cfg, `/api/groups/${groupId}/members/${uid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function deleteGroup(
  cfg: LanConfig,
  token: string,
  groupId: string,
): Promise<void> {
  await backendFetch(cfg, `/api/groups/${groupId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ---------- 消息 ----------

export async function fetchMessages(
  cfg: LanConfig,
  token: string,
  scope: 'direct' | 'group',
  target: string,
): Promise<ChatMessage[]> {
  const res = await backendFetch<{ messages: ChatMessage[] } | ChatMessage[]>(
    cfg,
    `/api/messages?scope=${encodeURIComponent(scope)}&target=${encodeURIComponent(target)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return Array.isArray(res) ? res : (res.messages ?? []);
}

// ---------- AI 转发 ----------

export interface BackendAiConfig {
  apiUrl: string;
  model: string;
  timeout: number;
  temperature: number;
  /** 是否已配置密钥（后端不返回明文） */
  hasKey: boolean;
}

/** 读取后端 AI 配置（管理员） */
export async function fetchBackendAiConfig(
  cfg: LanConfig,
  token: string,
): Promise<BackendAiConfig> {
  return backendFetch<BackendAiConfig>(cfg, '/api/ai/config', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** 保存后端 AI 配置（管理员，Key 加密存储） */
export async function saveBackendAiConfig(
  cfg: LanConfig,
  token: string,
  payload: {
    apiUrl: string;
    model: string;
    timeout: number;
    temperature: number;
    apiKey?: string;
  },
): Promise<BackendAiConfig> {
  return backendFetch<BackendAiConfig>(cfg, '/api/ai/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

/** 通过后端转发调用外部模型 */
export async function backendChat(
  cfg: LanConfig,
  token: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  const res = await backendFetch<{ content?: string; reply?: string }>(
    cfg,
    '/api/ai/chat',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages }),
      timeout: 60_000,
    },
  );
  return res.content ?? res.reply ?? '';
}

/**
 * 直接测试外部 API 连通性（不经过后端）。
 * 前端本地模式下用于验证填写的地址与密钥是否有效。
 */
export async function testApiConnection(
  config: {
    apiUrl: string;
    apiKey: string;
    model: string;
    timeout: number;
    temperature: number;
  },
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, config.timeout));
  try {
    const res = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: config.temperature,
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`接口返回异常（${res.status}）：${text.slice(0, 120)}`);
    }
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('API 测试超时，请检查网络与超时设置');
    }
    throw err instanceof Error ? err : new Error('API 测试失败');
  } finally {
    clearTimeout(timer);
  }
}

export { BackendOfflineError };

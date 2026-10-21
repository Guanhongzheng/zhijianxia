/**
 * 后端 API 封装 —— 对应 server/src/routes 下的实际接口。
 *
 * ⚠️ 契约约定：后端统一使用「包装结构」返回单条资源
 *    （如 `{ user }`、`{ notice }`、`{ group }`、`{ friends, incoming, outgoing }`）。
 *    本模块负责把包装结构**解包**成前端领域模型，调用方无需关心包装层。
 *    scripts/contract-test.mjs 会断言这套契约，修改任一侧都要同步。
 */

import {
  backendFetch,
  type LanConfig,
  BackendOfflineError,
} from './client'
import type {
  ApiCapability,
  ApiCatalog,
  ApiProtocol,
} from '@/lib/ai/api-providers';

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
  /** 已建立的好友没有 id（后端 briefUser 不返回 id），仅待处理请求有 */
  id?: number;
  uid: string;
  nickname: string;
  avatarColor?: string;
  bio?: string;
  online?: boolean;
  status?: 'pending' | 'accepted' | 'rejected';
  /** 待处理请求的发起时间 */
  createdAt?: number | string;
  /** 好友关系建立时间 */
  since?: number | string;
}

/** 好友列表：后端分三段返回 */
export interface FriendList {
  /** 已建立的好友 */
  friends: Friend[];
  /** 收到的待处理请求（已展平 from 字段） */
  incoming: Friend[];
  /** 发出的待处理请求（已展平 to 字段） */
  outgoing: Friend[];
}

export interface Group {
  groupId: string;
  name: string;
  ownerUid: string;
  /** 成员数量（后端 groupSummary 提供） */
  memberCount?: number;
  /** 成员列表（仅详情接口返回） */
  members?: GroupMember[];
  createdAt?: number | string;
}

export interface GroupMember {
  uid: string;
  nickname: string;
  avatarColor?: string;
  bio?: string;
  joinedAt?: number | string;
  /** 是否群主（后端 isOwner） */
  isOwner?: boolean;
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

// ---------- 解包工具 ----------

/** 从包装结构中取出用户：兼容 { user } 与裸对象 */
function unwrapUser(data: unknown): UserProfile {
  const obj = (data ?? {}) as { user?: UserProfile } & Partial<UserProfile>;
  const user = (obj.user ?? obj) as UserProfile;
  return {
    uid: user.uid ?? '',
    nickname: user.nickname ?? '未知用户',
    avatarColor: user.avatarColor,
    bio: user.bio,
    role: user.role === 'admin' ? 'admin' : 'user',
    createdAt: user.createdAt,
  };
}

/** 从包装结构中取出公告：兼容 { notice } 与裸对象 */
function unwrapNotice(data: unknown): Notice {
  const obj = (data ?? {}) as { notice?: Notice } & Partial<Notice>;
  const notice = (obj.notice ?? obj) as Notice;
  return {
    id: notice.id ?? 0,
    title: notice.title ?? '',
    body: notice.body ?? '',
    authorUid: notice.authorUid ?? '',
    createdAt: notice.createdAt ?? Date.now(),
    updatedAt: notice.updatedAt,
  };
}

/** 从包装结构中取出群组：兼容 { group } 与裸对象 */
function unwrapGroup(data: unknown, members?: GroupMember[]): Group {
  const obj = (data ?? {}) as { group?: Group } & Partial<Group>;
  const group = (obj.group ?? obj) as Group;
  return {
    groupId: group.groupId ?? '',
    name: group.name ?? '',
    ownerUid: group.ownerUid ?? '',
    memberCount: group.memberCount ?? members?.length,
    members: members ?? group.members,
    createdAt: group.createdAt,
  };
}

/** 归一化群成员：把后端 isOwner 映射为 role */
function normalizeMember(raw: {
  uid?: string;
  nickname?: string;
  avatar_color?: string;
  avatarColor?: string;
  bio?: string;
  joined_at?: number;
  joinedAt?: number;
  isOwner?: boolean;
  role?: 'owner' | 'member';
}): GroupMember {
  const isOwner = raw.isOwner ?? raw.role === 'owner';
  return {
    uid: raw.uid ?? '',
    nickname: raw.nickname ?? '未知成员',
    avatarColor: raw.avatarColor ?? raw.avatar_color,
    bio: raw.bio,
    joinedAt: raw.joinedAt ?? raw.joined_at,
    isOwner,
    role: isOwner ? 'owner' : 'member',
  };
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
  const data = await backendFetch<unknown>(cfg, '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, password }),
  });
  const obj = (data ?? {}) as { token?: string; user?: UserProfile };
  return { token: obj.token ?? '', user: unwrapUser(data) };
}

export async function login(
  cfg: LanConfig,
  nickname: string,
  password: string,
): Promise<AuthResult> {
  const data = await backendFetch<unknown>(cfg, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, password }),
  });
  const obj = (data ?? {}) as { token?: string; user?: UserProfile };
  return { token: obj.token ?? '', user: unwrapUser(data) };
}

export async function fetchMe(
  cfg: LanConfig,
  token: string,
): Promise<UserProfile> {
  const data = await backendFetch<unknown>(cfg, '/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrapUser(data);
}

export async function updateProfile(
  cfg: LanConfig,
  token: string,
  payload: { nickname?: string; bio?: string },
): Promise<UserProfile> {
  const data = await backendFetch<unknown>(cfg, '/api/auth/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return unwrapUser(data);
}

// ---------- 公告 ----------

export async function fetchNotices(cfg: LanConfig): Promise<Notice[]> {
  const data = await backendFetch<{ notices?: Notice[] } | Notice[]>(
    cfg,
    '/api/notices',
  );
  const list = Array.isArray(data) ? data : (data.notices ?? []);
  return list.map((n) => unwrapNotice(n));
}

export async function createNotice(
  cfg: LanConfig,
  token: string,
  payload: { title: string; body: string },
): Promise<Notice> {
  const data = await backendFetch<unknown>(cfg, '/api/notices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return unwrapNotice(data);
}

export async function updateNotice(
  cfg: LanConfig,
  token: string,
  id: number,
  payload: { title: string; body: string },
): Promise<Notice> {
  const data = await backendFetch<unknown>(cfg, `/api/notices/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return unwrapNotice(data);
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

export async function fetchFriends(
  cfg: LanConfig,
  token: string,
): Promise<FriendList> {
  const data = await backendFetch<unknown>(cfg, '/api/friends', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const obj = (data ?? {}) as {
    friends?: unknown[];
    incoming?: unknown[];
    outgoing?: unknown[];
  };

  /** 展开待处理请求的 from / to 包装 */
  const expand = (
    item: unknown,
    field: 'from' | 'to',
  ): Friend | null => {
    if (!item || typeof item !== 'object') return null;
    const rec = item as {
      id?: number;
      from?: Record<string, unknown>;
      to?: Record<string, unknown>;
      createdAt?: number;
      created_at?: number;
    };
    const person = rec[field] ?? {};
    const uid = String(person.uid ?? '');
    if (!uid) return null;
    return {
      id: rec.id,
      uid,
      nickname: String(person.nickname ?? '未知用户'),
      avatarColor: (person.avatarColor ?? person.avatar_color) as
        | string
        | undefined,
      bio: (person.bio as string | undefined) ?? '',
      status: 'pending',
      createdAt: rec.createdAt ?? rec.created_at,
    };
  };

  const friends: Friend[] = (obj.friends ?? []).map((raw) => {
    const f = raw as {
      uid?: string;
      nickname?: string;
      avatarColor?: string;
      avatar_color?: string;
      bio?: string;
      status?: Friend['status'];
      since?: number;
    };
    return {
      uid: f.uid ?? '',
      nickname: f.nickname ?? '未知用户',
      avatarColor: f.avatarColor ?? f.avatar_color,
      bio: f.bio ?? '',
      status: f.status ?? 'accepted',
      since: f.since,
    };
  });

  const incoming = (obj.incoming ?? [])
    .map((item) => expand(item, 'from'))
    .filter((f): f is Friend => f !== null);
  const outgoing = (obj.outgoing ?? [])
    .map((item) => expand(item, 'to'))
    .filter((f): f is Friend => f !== null);

  return { friends, incoming, outgoing };
}

export async function requestFriend(
  cfg: LanConfig,
  token: string,
  uid: string,
): Promise<{ status: string }> {
  const data = await backendFetch<{ ok?: boolean; status?: string }>(
    cfg,
    '/api/friends/request',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ uid }),
    },
  );
  return { status: data.status ?? 'pending' };
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

export async function fetchGroups(
  cfg: LanConfig,
  token: string,
): Promise<Group[]> {
  const data = await backendFetch<{ groups?: unknown[] } | unknown[]>(
    cfg,
    '/api/groups',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const list = Array.isArray(data) ? data : (data.groups ?? []);
  return list.map((g) => unwrapGroup(g));
}

export async function createGroup(
  cfg: LanConfig,
  token: string,
  name: string,
  memberUids: string[] = [],
): Promise<Group> {
  const data = await backendFetch<unknown>(cfg, '/api/groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, memberUids }),
  });
  return unwrapGroup(data);
}

export async function fetchGroup(
  cfg: LanConfig,
  token: string,
  groupId: string,
): Promise<Group> {
  const data = await backendFetch<unknown>(cfg, `/api/groups/${groupId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const obj = (data ?? {}) as { group?: unknown; members?: unknown[] };
  const members = (obj.members ?? []).map((m) =>
    normalizeMember(m as Parameters<typeof normalizeMember>[0]),
  );
  return unwrapGroup(obj.group ?? data, members);
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
  const data = await backendFetch<{ messages?: ChatMessage[] } | ChatMessage[]>(
    cfg,
    `/api/messages?scope=${encodeURIComponent(scope)}&target=${encodeURIComponent(target)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return Array.isArray(data) ? data : (data.messages ?? []);
}

// ---------- AI 转发 ----------

export interface BackendAiConfig {
  /** 完整请求地址（后端字段名为 base，这里统一为 apiUrl） */
  apiUrl: string;
  model: string;
  timeout: number;
  temperature: number;
  /** 是否已配置密钥（后端不返回明文） */
  hasKey: boolean;
  /** 按能力分类的运行配置（后端新增，缺失时视为空） */
  capabilities?: Partial<Record<ApiCapability, CapabilityConfig>>;
  /** 共享服务商清单（后端原样返回，前端直接渲染选择器） */
  catalog?: ApiCatalog;
}

/** 单个能力分类的配置 */
export interface CapabilityConfig {
  /** 服务商 id */
  provider: string;
  /** 协议类型 */
  protocol: ApiProtocol;
  /** 接口基础地址 */
  base: string;
  /** 模型 id */
  model: string;
  /** 是否已配置密钥 */
  hasKey: boolean;
}

/** 读取后端 AI 配置（管理员） */
export async function fetchBackendAiConfig(
  cfg: LanConfig,
  token: string,
): Promise<BackendAiConfig> {
  const data = await backendFetch<{
    base?: string;
    model?: string;
    timeout?: number;
    temperature?: number;
    hasKey?: boolean;
    capabilities?: Partial<Record<ApiCapability, CapabilityConfig>>;
    catalog?: ApiCatalog;
  }>(cfg, '/api/ai/config', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    apiUrl: data.base ?? '',
    model: data.model ?? '',
    timeout: data.timeout ?? 30000,
    temperature: data.temperature ?? 0.7,
    hasKey: data.hasKey ?? false,
    capabilities: data.capabilities,
    catalog: data.catalog,
  };
}

/**
 * 保存某个能力分类的 API 配置 —— 需要管理员。
 * 不传 capability 时更新 chat 主配置（保持历史行为）。
 */
export async function saveCapabilityConfig(
  cfg: LanConfig,
  token: string,
  payload: {
    capability: ApiCapability;
    provider?: string;
    protocol?: ApiProtocol;
    base?: string;
    model?: string;
    apiKey?: string;
  },
): Promise<void> {
  await backendFetch(cfg, '/api/ai/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

/** 后端生成图像（依赖后端转发，需 image 能力已配置） */
export async function backendGenerateImage(
  cfg: LanConfig,
  token: string,
  payload: { prompt: string; capability?: ApiCapability; model?: string },
): Promise<string> {
  const res = await backendFetch<{ image?: string }>(cfg, '/api/ai/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    timeout: 120_000,
  });
  return res.image ?? '';
}

/** 后端语音能力：转写或合成 */
export async function backendSpeech(
  cfg: LanConfig,
  token: string,
  payload: {
    action: 'transcribe' | 'synthesize';
    capability?: ApiCapability;
    model?: string;
    audio?: string;
    text?: string;
    voice?: string;
  },
): Promise<{ text?: string; audio?: string }> {
  return backendFetch<{ text?: string; audio?: string }>(cfg, '/api/ai/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    timeout: 120_000,
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
  const data = await backendFetch<{
    base?: string;
    model?: string;
    timeout?: number;
    temperature?: number;
    hasKey?: boolean;
  }>(cfg, '/api/ai/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // 后端字段名为 base
    body: JSON.stringify({
      base: payload.apiUrl,
      model: payload.model,
      timeout: payload.timeout,
      temperature: payload.temperature,
      ...(payload.apiKey ? { apiKey: payload.apiKey } : {}),
    }),
  });
  return {
    apiUrl: data.base ?? '',
    model: data.model ?? '',
    timeout: data.timeout ?? 30000,
    temperature: data.temperature ?? 0.7,
    hasKey: data.hasKey ?? false,
  };
}

/**
 * 通过后端转发调用外部模型。
 * 后端会自动把 base 规整成 .../chat/completions 完整地址。
 */
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
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(3000, config.timeout),
  );
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

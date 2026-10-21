/**
 * 智简匣 · 前后端接口契约测试
 * 直接打后端，断言「后端真实返回结构」与「前端适配层期望结构」一致。
 * 这是本次崩溃（avatarColor 读取 undefined.length）的根因防线。
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.ZJ_API || 'http://localhost:8787';

const results = [];
function check(ok, name, extra = '') {
  results.push({ ok, name, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  →  ' + extra : ''}`);
}

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

(async () => {
  // 准备两个测试账号
  const stamp = Date.now().toString().slice(-6);
  const aNick = `ct_a_${stamp}`;
  const bNick = `ct_b_${stamp}`;

  const regA = await req('/api/auth/register', {
    method: 'POST',
    body: { nickname: aNick, password: 'ct123456' },
  });
  const regB = await req('/api/auth/register', {
    method: 'POST',
    body: { nickname: bNick, password: 'ct123456' },
  });

  check(regA.status === 201 && regA.data?.token, 'A 注册成功');
  check(regB.status === 201 && regB.data?.token, 'B 注册成功');
  const tokenA = regA.data?.token;
  const tokenB = regB.data?.token;
  const uidA = regA.data?.user?.uid;
  const uidB = regB.data?.user?.uid;

  // ========== 1. auth/me —— 本次崩溃的直接来源 ==========
  const me = await req('/api/auth/me', { token: tokenA });
  check(
    me.data && typeof me.data === 'object' && 'user' in me.data,
    'GET /api/auth/me 返回 { user } 包装结构（前端需解包）',
    Object.keys(me.data || {}).join(','),
  );
  check(
    me.data?.user?.uid === uidA,
    '包装内 user.uid 正确',
    String(me.data?.user?.uid),
  );

  const patchMe = await req('/api/auth/me', {
    method: 'PATCH',
    token: tokenA,
    body: { bio: '契约测试' },
  });
  check(
    patchMe.data && 'user' in patchMe.data,
    'PATCH /api/auth/me 返回 { user } 包装结构',
    Object.keys(patchMe.data || {}).join(','),
  );

  // ========== 2. 公告 ==========
  const notices = await req('/api/notices');
  check(
    Array.isArray(notices.data?.notices),
    'GET /api/notices 返回 { notices: [] }',
  );

  // 管理员建公告
  const adminLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { nickname: '管理员', password: 'admin123' },
  });
  const adminToken = adminLogin.data?.token;
  const created = await req('/api/notices', {
    method: 'POST',
    token: adminToken,
    body: { title: '契约测试公告', body: '正文' },
  });
  check(
    created.data && 'notice' in created.data && typeof created.data.notice?.id === 'number',
    'POST /api/notices 返回 { notice } 包装且含 id',
    JSON.stringify(created.data).slice(0, 90),
  );

  const noticeId = created.data?.notice?.id;
  const updated = await req(`/api/notices/${noticeId}`, {
    method: 'PUT',
    token: adminToken,
    body: { title: '契约测试公告2', body: '正文2' },
  });
  check(
    updated.data && 'notice' in updated.data,
    'PUT /api/notices/:id 返回 { notice } 包装',
  );

  // ========== 3. 好友 ==========
  const friends = await req('/api/friends', { token: tokenA });
  check(
    friends.data && Array.isArray(friends.data.friends) &&
      Array.isArray(friends.data.incoming) &&
      Array.isArray(friends.data.outgoing),
    'GET /api/friends 返回 { friends, incoming, outgoing } 三段',
    Object.keys(friends.data || {}).join(','),
  );
  check(
    friends.data?.friends?.length === 0,
    '初始好友列表为空',
  );

  // B 向 A 发好友请求
  const friendReq = await req('/api/friends/request', {
    method: 'POST',
    token: tokenB,
    body: { uid: uidA },
  });
  check(
    friendReq.data && 'friend' in friendReq.data,
    'POST /api/friends/request 返回含 friend',
    JSON.stringify(friendReq.data).slice(0, 80),
  );

  const friendsA2 = await req('/api/friends', { token: tokenA });
  const incoming = friendsA2.data?.incoming?.[0];
  check(
    incoming && typeof incoming.id === 'number' && incoming.from?.uid === uidB,
    'incoming 项形状为 { id, from:{uid,...} }（前端需展平 from）',
    JSON.stringify(incoming).slice(0, 90),
  );

  const accept = await req(`/api/friends/${incoming.id}/accept`, {
    method: 'PUT',
    token: tokenA,
  });
  check(
    accept.data?.ok === true && accept.data?.status === 'accepted',
    'PUT /api/friends/:id/accept 返回 { ok, status }',
  );

  const friendsA3 = await req('/api/friends', { token: tokenA });
  check(
    friendsA3.data?.friends?.some((f) => f.uid === uidB),
    '接受后对方出现在 friends 中',
  );
  check(
    friendsA3.data?.friends?.[0]?.id === undefined,
    'accepted 好友项无 id 字段（前端 id 必须可选）',
    JSON.stringify(friendsA3.data?.friends?.[0]),
  );

  // ========== 4. 群聊 ==========
  const groups = await req('/api/groups', { token: tokenA });
  check(
    Array.isArray(groups.data?.groups),
    'GET /api/groups 返回 { groups: [] }',
  );

  const group = await req('/api/groups', {
    method: 'POST',
    token: tokenA,
    body: { name: '契约测试群', memberUids: [uidB] },
  });
  check(
    group.data && 'group' in group.data && typeof group.data.group?.groupId === 'string',
    'POST /api/groups 返回 { group } 包装且含 groupId',
    JSON.stringify(group.data).slice(0, 90),
  );
  const groupId = group.data?.group?.groupId;

  const groupDetail = await req(`/api/groups/${groupId}`, { token: tokenA });
  check(
    groupDetail.data && 'group' in groupDetail.data && Array.isArray(groupDetail.data.members),
    'GET /api/groups/:groupId 返回 { group, members }',
    Object.keys(groupDetail.data || {}).join(','),
  );
  check(
    typeof groupDetail.data?.group?.memberCount === 'number',
    '群摘要含 memberCount（前端应读它而非 members.length）',
    String(groupDetail.data?.group?.memberCount),
  );
  check(
    groupDetail.data?.members?.[0]?.isOwner !== undefined,
    '成员项含 isOwner（前端 role 需由它推导）',
    JSON.stringify(groupDetail.data?.members?.[0]).slice(0, 80),
  );

  // ========== 5. 消息 ==========
  const msgs = await req(
    `/api/messages?scope=group&target=${encodeURIComponent(groupId)}`,
    { token: tokenA },
  );
  check(
    Array.isArray(msgs.data?.messages),
    'GET /api/messages 返回 { messages: [] }',
  );

  // ========== 6. AI 配置 ==========
  const aiCfg = await req('/api/ai/config', { token: adminToken });
  check(
    aiCfg.data && 'base' in aiCfg.data,
    'GET /api/ai/config 返回字段名为 base（非 apiUrl）',
    Object.keys(aiCfg.data || {}).join(','),
  );
  check(
    aiCfg.data?.hasKey === false,
    'AI 配置不返回明文 Key（仅 hasKey）',
  );

  const aiSave = await req('/api/ai/config', {
    method: 'PUT',
    token: adminToken,
    body: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', timeout: 30000, temperature: 0.7 },
  });
  check(
    aiSave.data && 'base' in aiSave.data,
    'PUT /api/ai/config 接受 base 字段并回显',
    JSON.stringify(aiSave.data).slice(0, 80),
  );

  const aiChat = await req('/api/ai/chat', {
    method: 'POST',
    token: adminToken,
    body: { messages: [{ role: 'user', content: 'ping' }] },
  });
  check(
    aiChat.status !== 401,
    'POST /api/ai/chat 鉴权通过（无 Key 时应为 400/502 而非 401）',
    `status=${aiChat.status}`,
  );

  // 群聊 WS 广播必须带真实自增 id —— 前端靠它去重，
  // 缺失会导致前端拿 createdAt 冒充 id，React key 冲突 + 消息重复
  const hubSrc = readFileSync(
    new URL('../server/src/ws/hub.js', import.meta.url),
    'utf8'
  );
  check(
    /id:\s*messageId/.test(hubSrc) && /lastInsertRowid/.test(hubSrc),
    '群聊 WS 广播 payload 带数据库自增 id（前端据此去重，避免 key 冲突）',
    'hub.js 含 id: messageId + lastInsertRowid'
  );

  // @langchain/core@1.2.x 的主入口 dist 是空壳（__exportAll({})），
  // 运行时导不出任何符号。必须从子路径导入，否则构建通过但运行时报错。
  const chainSrc = readFileSync(
    new URL('../src/lib/ai/chain.ts', import.meta.url),
    'utf8'
  );
  const badImport = chainSrc.match(/from '@langchain\/core'/);
  check(
    !badImport,
    'LangChain 一律从子路径导入（主入口为空壳包）',
    badImport ? "存在 from '@langchain/core' 主入口导入" : '无主入口导入'
  );
  check(
    /@langchain\/core\/runnables/.test(chainSrc) &&
      /@langchain\/core\/output_parsers/.test(chainSrc) &&
      /@langchain\/core\/messages/.test(chainSrc),
    'LangChain 链使用了 runnables / output_parsers / messages 子路径',
    '子路径导入齐全'
  );

  // 运行时探测：WebGPU 优先，且 dtype 必须与 device 配套
  const runtimeSrc = readFileSync(
    new URL('../src/lib/ai/runtime.ts', import.meta.url),
    'utf8'
  );
  check(
    /navigator/.test(runtimeSrc) && /requestAdapter/.test(runtimeSrc),
    '运行时探测包含 navigator.gpu 与 requestAdapter 调用',
    'WebGPU 探测逻辑存在'
  );
  const engineSrc = readFileSync(
    new URL('../src/lib/ai/local-engine.ts', import.meta.url),
    'utf8'
  );
  check(
    /device:\s*rt\.device === 'webgpu' \? 'webgpu' : 'wasm'/.test(engineSrc) &&
      /dtype:\s*rt\.dtype/.test(engineSrc),
    'pipeline 显式传入 device 与 dtype（WebGPU 走 q4f16 / WASM 走 q4）',
    'device + dtype 已接线'
  );

  // WebGPU 上不能用 fp16：会加载完整半精度权重（体积数倍于 q4），
  // 且部分算子在 WebGPU EP 上不受支持，表现为抛出无法解读的裸数字
  const rtSrc2 = readFileSync(
    new URL('../src/lib/ai/runtime.ts', import.meta.url),
    'utf8'
  );
  const assignsFp16 = /dtype\s*=\s*'fp16'/.test(rtSrc2);
  check(
    !assignsFp16 && /dtype = webgpuUsable \? 'q4f16' : 'q4'/.test(rtSrc2),
    'WebGPU 运行时使用 q4f16 而非 fp16',
    assignsFp16 ? '仍存在 dtype=fp16 赋值' : 'WebGPU→q4f16，WASM→q4'
  );

  // 降级阶梯：WebGPU(q4f16) → WebGPU(q4) → WASM(q4)
  check(
    /dtype: 'q4',\s*\n\s*fallbackReason: 'q4f16 初始化失败/.test(engineSrc),
    'WebGPU 内部保留 q4 降级档（部分显卡 fp16 算子不全）',
    '降级阶梯含 GPU 内 q4 档'
  );

  // 底层有时抛裸数字/裸对象，describeError 必须如实展开而非丢弃
  check(
    /describeNonError/.test(engineSrc) &&
      /底层库抛出了未包装的错误码/.test(engineSrc),
    'describeError 能处理非 Error 值（裸数字/裸对象）',
    'describeNonError 已实现'
  );

  // 清理
  await req(`/api/groups/${groupId}`, { method: 'DELETE', token: tokenA });
  await req(`/api/notices/${noticeId}`, { method: 'DELETE', token: adminToken });

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n===== 契约测试：${results.length - failed.length}/${results.length} 通过 =====`,
  );
  if (failed.length) {
    failed.forEach((f) => console.log('  FAILED: ' + f.name + '  ' + f.extra));
    process.exit(1);
  }
})();

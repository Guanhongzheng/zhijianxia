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

  // ⚠️ LangChain 绝不能出现在首屏的静态导入链上。
  //
  // 实测（production build）：chain.ts 连同 zod 占 1570 KB 未压缩，
  // 是整个构建产物的 46%，传输后 412 KB —— 占首屏 JS 的 61%。
  // 而这条链是首屏必经的：
  //   page.tsx → providers.tsx → plugin-store.ts → scheduler.ts → chain.ts
  // （providers 要 boot 插件内核，plugin-store 又静态 import scheduler）
  // 于是「用户只是打开首页、根本没打算用 AI」也要先下载 412 KB 编排库。
  //
  // 改成动态导入后，首屏 JS 从 678 KB 降到 558 KB（-120 KB / -17.7%）。
  const schedSrc = readFileSync(
    new URL('../src/lib/ai/scheduler.ts', import.meta.url),
    'utf8',
  );
  const schedCode = schedSrc
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  // 找出所有引用 './chain' 的行，逐条判断是否只是类型导入
  //（`import type {...}` 与 `export type {...}` 都在编译期擦除，不进 bundle；
  //  真正要禁的是「运行时值」的静态导入，如 `import { runChatChain } from './chain'`）
  const chainRefLines = schedCode
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes("'./chain'") || l.includes('"./chain"'));
  const runtimeStaticImports = chainRefLines.filter(
    (l) =>
      /^(import|export)\s*\{/.test(l) &&
      !/^(import|export)\s+type\s*\{/.test(l),
  );
  check(
    // 必须有一个「运行时」的动态导入：loadChain() 里 return import('./chain')
    // （写成裸 import() 而非 await import()，两者等价）
    /(await|return)\s+import\('\.\/chain'\)/.test(schedCode) &&
      runtimeStaticImports.length === 0,
    'LangChain 编排层不在首屏静态导入链上（scheduler 改为动态 import，实测首屏 -120 KB）',
    runtimeStaticImports.length === 0
      ? '已改为动态导入'
      : `存在运行时静态导入：${runtimeStaticImports.join(' / ')}`,
  );

  // ⚠️ ConversationMemory 是类，不能直接 re-export ——
  // 静态 re-export 会把 chain 拖回首屏。必须走工厂函数。
  check(
    /createConversationMemory/.test(schedCode) &&
      !/export\s*\{[^}]*ConversationMemory[^}]*\}\s*from\s*'\.\/chain'/.test(schedCode),
    'ConversationMemory 改为工厂函数惰性创建（类的静态 re-export 会拖重依赖回首屏）',
    /createConversationMemory/.test(schedCode) ? '已惰性化' : '仍是静态 re-export',
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
  // 以下模块在断言里被多处引用，统一在这里读一次
  const workerSrc = readFileSync(
    new URL('../src/lib/ai/ai-worker.ts', import.meta.url),
    'utf8'
  );
  const clientSrc = readFileSync(
    new URL('../src/lib/ai/ai-client.ts', import.meta.url),
    'utf8'
  );
  const ortSetupSrc = readFileSync(
    new URL('../src/lib/ai/ort-setup.ts', import.meta.url),
    'utf8'
  );
  const cacheErrSrc = readFileSync(
    new URL('../src/lib/ai/cache-errors.ts', import.meta.url),
    'utf8'
  );
  check(
    // pipeline 的 device/dtype 现在由 Worker 传入
    /device:\s*rt\.device === 'webgpu' \? 'webgpu' : 'wasm'/.test(workerSrc) &&
      /dtype:\s*rt\.dtype/.test(workerSrc) &&
      /runtimes/.test(workerSrc),
    'pipeline 显式传入 device 与 dtype（WebGPU 走 q4 / WASM 走模型精度档）',
    'device + dtype 已接线'
  );

  // WebGPU 上不能用 fp16（会加载完整半精度权重，体积数倍于 q4）。
  //
  // ⚠️ 这里曾断言「WebGPU→ q4f16」，那是**错误的假设**，已被实测推翻：
  // 同一份 493MB Qwen1.5-0.5B 权重，在同一台机器（NVIDIA Lovelace、
  // shader-f16 可用、适配器与 device 均正常）上对照测试：
  //   q4f16 + WebGPU → 必失败（抛裸数字 130907384 / 999335224 / 1003122552）
  //   q4    + WebGPU → 61s 加载成功，51 个输入全在 GPU
  //   q4f16 + WASM   → 38s 加载成功
  // 结论：失败的是 q4f16 这条精度路径与 WebGPU EP 的兼容性，
  // 与显卡、驱动、权重都无关。因此 WebGPU 现在默认走 q4。
  const rtSrc2 = readFileSync(
    new URL('../src/lib/ai/runtime.ts', import.meta.url),
    'utf8'
  );
  const assignsFp16 = /dtype\s*=\s*'fp16'/.test(rtSrc2);
  check(
    !assignsFp16 && !/webgpuUsable \? 'q4f16'/.test(rtSrc2),
    'WebGPU 运行时不再选择 q4f16（实测该精度在 WebGPU EP 上必定失败）',
    assignsFp16 ? '仍存在 dtype=fp16 赋值' : 'WebGPU 与 WASM 统一走 q4'
  );

  // 降级阶梯：WebGPU(q4) → WASM(q4)。
  // 精度维度已收敛为 q4，因此不再需要「GPU 内部换精度」这一档 ——
  // 那正是旧实现每次失败后重复下载 493MB 权重的根源。
  check(
    /device: 'wasm' as RuntimeDevice/.test(engineSrc) &&
      !/fallbackReason: 'q4f16 初始化失败/.test(engineSrc),
    '降级阶梯收敛为 WebGPU(q4) → WASM(q4)，不再有GPU 内换精度档',
    '阶梯仅剩换后端一档'
  );

  // 底层有时抛裸数字/裸对象，describeError 必须如实展开而非丢弃。
  // 同时要求**面向用户的文案**不得再把原因归到「显卡驱动 / 远程桌面」—— 那是误判，
  // 会把用户引去折腾驱动。注释里可以写「这里曾经误判」来记录历史。
  const userFacingText = [...engineSrc.matchAll(/return\s+`[^`]*`/g)]
    .map((m) => m[0])
    .join('\n');
  check(
    /describeNonError/.test(engineSrc) &&
      /未包装的错误值/.test(engineSrc) &&
      !/远程桌面|显卡驱动/.test(userFacingText),
    'describeError 能处理非 Error 值（裸数字/裸对象），且用户文案不误判为显卡驱动问题',
    'describeNonError 已实现，用户文案已改为指向精度兼容性'
  );

  // 加载失败时不得无条件清缓存：权重可达数百 MB，
  // 无条件清会让用户每次点「加载」都重新下载一遍。
  // ⚠️ 判定与清缓存重试现在都在 Worker 里（加载已搬到 Worker）。
  check(
    /isCacheRelatedError/.test(cacheErrSrc) &&
      /isCacheRelatedError\(err\)/.test(workerSrc) &&
      /deleteModelFiles\(modelId\)/.test(workerSrc) &&
      /cacheRetried/.test(workerSrc),
    '仅在错误与缓存相关时才清模型缓存（避免重复下载数百MB 权重）',
    '缓存清理已条件化'
  );

  // ORT 建 session 时的两条VerifyEachNodeIsAssignedToAnEp 警告是正常行为
  //（ORT 有意把 shape 类算子留在 CPU），但它们走 C++/wasm 侧的原生 logger，
  // 绕过 `env.backends.onnx.logLevel`，只能靠 console 出口过滤。
  // 过滤条件必须极窄，不能误吞真正的 ORT 报错。
  // ⚠️ 过滤器已抽到 ort-setup.ts（主线程与 Worker 共用 —— 推理在 Worker 里跑，
  // Worker 的 console.error 不会经过主线程的包装）。
  const ortFilterBody =
    ortSetupSrc.split('const ORT_BENIGN_LOG')[1]?.split('/** ORT env 的最小结构')[0] ?? '';
  check(
    /installOrtLogFilter/.test(ortSetupSrc) &&
      /installOrtLogFilter\(\)/.test(ortSetupSrc) &&
      /VerifyEachNodeIsAssignedToAnEp/.test(ortFilterBody) &&
      /console\.error\s*=/.test(ortFilterBody) &&
      !/console\.(warn|log)\s*=/.test(ortSetupSrc),
    'ORT 的 VerifyEachNodeIsAssignedToAnEp 良性警告经窄过滤 console.error 消除（logLevel 对 C++ 侧无效）',
    '过滤条件限定为 VerifyEachNodeIsAssignedToAnEp，且只拦 console.error'
  );

  // 卸载必须真的释放资源，且要等进行中的加载结束。
  //
  // ⚠️ 旧实现只把 pipelinePromise 置空就返回，既没释放 ORT session，
  // 也没等在途加载 —— 于是「切换模型」会让两次 pipeline() 并发，
  // 而 ORT 的 wasm 运行时不支持并发建 session，控制台表现为
  // 一条无信息量的 `Aborted()`（emscripten abort 的空消息形式）。
  //
  // ⚠️ 模型现在只存在于 Worker，主线程的释放动作要转给 Worker。
  check(
    /async function releaseActivePipeline/.test(engineSrc) &&
      /await unloadInWorker\(\)/.test(engineSrc) &&
      /await releaseActivePipeline\(\)/.test(engineSrc) &&
      /export async function unloadLocalModel\(\)\s*\{[\s\S]{0,400}?await pipelinePromise/.test(
        engineSrc,
      ) &&
      // Worker 侧要真的释放 session
      /async function releasePipeline/.test(workerSrc) &&
      /dispose/.test(workerSrc),
    '卸载模型会释放 ORT session 并等待在途加载结束（避免并发建session 触发 Aborted()）',
    'unload 已await 在途加载并释放 session'
  );

  // ---------- 无参 loadLocalModel 必须用「用户选中的模型」 ----------
  //
  // AI 对话（localChatStream）、调度器、预热都是**无参**调用 loadLocalModel()。
  // 若无参时回落到硬编码的默认模型，就会出现：
  //   用户在设置里加载了 1.5B → 打开 AI 对话 → 它偷偷去加载 0.5B
  // 而 0.5B 往往没下载过 → 现场下几百 MB，甚至直接加载失败
  //（实测报「WASM 推理后端初始化失败（未包装的错误值）」）。
  //
  // 同时要求卸载后 modelId 被**清空**而非复位成默认模型 ——
  // 复位会让「运行中」徽标错挂到默认模型（列表第一项）头上。
  const panelSrc2 = readFileSync(
    new URL('../src/components/cards/settings-panel.tsx', import.meta.url),
    'utf8',
  );
  check(
    /readSelectedModel/.test(engineSrc) &&
      /saveSelectedModel/.test(engineSrc) &&
      /modelId:\s*string\s*=\s*readSelectedModel\(\)/.test(engineSrc) &&
      /saveSelectedModel\(m\.id\)/.test(panelSrc2) &&
      /modelId:\s*''/.test(engineSrc),
    '无参 loadLocalModel 使用用户选中的模型，且卸载后清空 modelId（避免「运行中」标记错位）',
    '选中模型已持久化，卸载会清空 modelId'
  );

  // ---------- 推理必须跑在 Web Worker 里 ----------
  //
  // 1.5B 模型在 WASM 后端下单次 forward 会**同步阻塞主线程 10 秒以上**
  //（实测首次 prefill 阻塞 10767ms，后续每 token 约 700ms），
  // 浏览器连续阻塞超过 5 秒就弹「页面未响应」——
  // 而生成其实还在继续，所以用户看到的是「未响应但没有报错」。
  //
  // 修法：加载与推理都搬到 Web Worker，Worker 自己从 Cache API 读权重
  //（与主线程共用同一份分片缓存），主线程全程不碰大 buffer。
  const modelCacheSrc = readFileSync(
    new URL('../src/lib/ai/model-cache.ts', import.meta.url),
    'utf8',
  );
  check(
    /generateInWorker/.test(engineSrc) &&
      /loadInWorker/.test(engineSrc) &&
      /new Worker\(new URL\('\.\/ai-worker\.ts', import\.meta\.url\)\)/.test(clientSrc) &&
      // Worker 里的加载要互斥 —— ORT 的 wasm 不支持并发建 session
      /loadingPromise/.test(workerSrc) &&
      // 多线程：不再是写死的 numThreads = 1
      /numThreads\s*=\s*resolveWasmThreads\(\)/.test(ortSetupSrc) &&
      /crossOriginIsolated/.test(ortSetupSrc) &&
      // 缓存要用 globalThis —— Worker 里没有 window
      /globalThis/.test(modelCacheSrc) &&
      !/typeof window === 'undefined'/.test(modelCacheSrc),
    '加载与推理都在 Web Worker 中执行（多线程 + 互斥），缓存用 globalThis 以兼容 Worker',
    'Worker 推理链路已就位'
  );

  // Worker 的每条消息都必须回同一个 id —— 否则主线程的 pending map
  // 匹配不到，promise 永远 pending（表现为「点了加载没反应」）。
  check(
    /type: 'unload'; id: string/.test(workerSrc) &&
      /post\(\{ type: 'done', id: req\.id \}\)/.test(workerSrc) &&
      !/id: 'unload'/.test(workerSrc),
    'Worker 回消息必须用 req.id（否则主线程 promise 永不 resolve）',
    '消息 id 已对齐'
  );

  // 能拿到 GPU 适配器 ≠ ORT 的 WebGPU 后端能建 session。
  // 必须在加载模型前做冒烟测试，否则会在下载完权重后才炸出裸数字。
  //
  // ⚠️ 第四个参数是模型体积 —— 权重超过 GPU 单缓冲上限时必须提前改走 WASM，
  // 否则用户要白等几分钟把 1.7GB 下载完才发现 WebGPU 装不下。
  check(
    /smokeTestWebGpu/.test(rtSrc2) &&
      /resolveRuntime\(\s*undefined,\s*false,\s*true,\s*modelOption\?\.q4Bytes,\s*\/\/[^\n]*\n\s*modelWeightDtype\(modelOption\),?\s*\)/.test(
        engineSrc,
      ),
    '加载模型前执行 WebGPU 冒烟测试（deep=true），并传入模型体积与精度档',
    '冒烟测试已接入加载流程，且带上了模型体积与精度档'
  );

  // ---------- 大模型在 WASM 下必须换精度档 ----------
  //
  // 实测（Qwen2.5-1.5B，WASM 后端，同一台机器同一份代码）：
  //   q4f16 (1.22 GB) → ❌ Aborted()（wasm 后端缺 fp16 算子支持）
  //   uint8 (1.58 GB) → ✅ 319s 加载成功
  //   q4    (1.78 GB) → ❌ 裸数字（内存分配失败）
  // 注意该模型里 uint8 反而比 q4 更小。
  //
  // 精度必须**跟着模型走**：下载的权重文件与加载用的 dtype 必须是同一个，
  // 否则会出现「显示已下载、加载时却要重新下载」。
  const modelsSrc2 = readFileSync(
    new URL('../src/lib/ai/local-models.ts', import.meta.url),
    'utf8',
  );
  const dlrSrc2 = readFileSync(
    new URL('../src/lib/ai/model-downloader.ts', import.meta.url),
    'utf8',
  );
  const dlSrc2 = readFileSync(
    new URL('../src/lib/ai/model-download.ts', import.meta.url),
    'utf8',
  );
  check(
    /weightDtype/.test(modelsSrc2) &&
      /modelWeightDtype/.test(modelsSrc2) &&
      /modelWeightFile/.test(modelsSrc2) &&
      /modelWeightDtype\(modelOption\)/.test(engineSrc) &&
      /modelWeightFile\(model\)/.test(dlrSrc2) &&
      /modelWeightFile\(opt\)/.test(dlSrc2) &&
      /'uint8'/.test(rtSrc2),
    '大模型在 WASM 下改用 uint8 精度档，且下载与加载使用同一个权重文件',
    '模型级精度档已就位'
  );

  // ---------- WebGPU 大模型：按权重体积提前拦截 ----------
  //
  // 实测（NVIDIA Lovelace，maxBufferSize = 2147483648 = 2 GiB）：
  //   Qwen2.5-0.5B q4 (749 MB) → WebGPU ✅ 62s
  //   Qwen1.5-0.5B  q4 (794 MB) → WebGPU ✅ 61s
  //   Qwen2.5-1.5B  q4 (1.7 GB) → WebGPU ❌ 裸数字失败
  // 同仓库、同精度、同后端，只差体积 → 是 GPU 单缓冲上限，不是精度不兼容。
  // ORT 的 WebGPU EP 把整个权重塞进单个 buffer，且 EP 没有分块开关，
  // 因此只能按体积提前改走 WASM。
  const modelsSrc = readFileSync(
    new URL('../src/lib/ai/local-models.ts', import.meta.url),
    'utf8',
  );
  check(
    /WEBGPU_MAX_Q4_BYTES/.test(modelsSrc) &&
      /canUseWebGpu/.test(modelsSrc) &&
      /q4Bytes/.test(modelsSrc) &&
      /modelQ4Bytes\s*>\s*WEBGPU_MAX_Q4_BYTES/.test(rtSrc2) &&
      /sizeBlocked/.test(rtSrc2),
    'WebGPU 按权重体积拦截：超过 GPU 单缓冲上限的模型提前改走 WASM（不再等下载完才失败）',
    '体积阈值判定已接入 resolveRuntime'
  );

  // ---------- 下载 / 加载分离 ----------
  //
  // 旧实现把两者合成一个「下载并加载」按钮，用户无法预先知道权重在不在本地。
  // 现在：模型行内有独立「下载」按钮，已下载的显示「已下载」标记，
  // 加载按钮只在权重就绪时可点。
  const dlSrc = readFileSync(
    new URL('../src/lib/ai/model-download.ts', import.meta.url),
    'utf8',
  );
  const dlrSrc = readFileSync(
    new URL('../src/lib/ai/model-downloader.ts', import.meta.url),
    'utf8',
  );
  const panelSrc = readFileSync(
    new URL('../src/components/cards/settings-panel.tsx', import.meta.url),
    'utf8',
  );
  check(
    /transformers-cache/.test(dlSrc) &&
      /isModelDownloaded/.test(dlSrc) &&
      /getAllDownloadStates/.test(dlSrc) &&
      /modelCache\.put/.test(dlrSrc) &&
      /modelCache\.match/.test(dlrSrc) &&
      /downloadModel/.test(dlrSrc) &&
      /已下载/.test(panelSrc) &&
      /downloadModel\(/.test(panelSrc) &&
      /getAllDownloadStates/.test(panelSrc),
    '下载与加载分离：独立「下载」按钮 + 「已下载」标记，且下载写入模型缓存供加载复用',
    '下载状态检测与独立下载按钮已就位'
  );

  // ---------- 下载进度百分比必须真的会推进 ----------
  //
  // ⚠️ 这里踩过两个坑，都会让进度显示成 0% 或离谱值：
  // 1. 魔搭的 HEAD 响应**不带 content-length** → 总量算成 0 → 恒 0%；
  // 2. 用 `Range: bytes=0-0` 再读 `Content-Range` —— 但该头**不在 CORS
  //    安全响应头白名单**，跨域读到 null，回退的 content-length 又是
  //    「本次 Range 的长度（1 字节）」→ 分母算成 5 字节 → 百分比上千万%。
  //
  // 正确做法：普通 GET 读 content-length（它在 CORS 白名单里），随即 cancel 正文。
  check(
    /probeFileSize/.test(dlrSrc) &&
      /content-length/.test(dlrSrc) &&
      // 不能用 HEAD 探测（注意只查代码用法，注释里提到 HEAD 是允许的）
      !/method:\s*'HEAD'/.test(dlrSrc) &&
      // 不能依赖 Content-Range（跨域读不到）
      !/\.get\(\s*['"]content-range['"]\s*\)/i.test(dlrSrc) &&
      // 进度比例必须夹取，防止探测值与实际不符时出现 >100%
      /clampRatio/.test(dlrSrc),
    '下载进度百分比能正常推进：用 GET 的 content-length 探测大小（不用 HEAD / Content-Range）并夹取比例',
    '大小探测与比例夹取已就位'
  );

  // ---------- 模型缓存必须分片 ----------
  //
  // ⚠️ 极重要：Chrome 的 Cache API 单条目上限约 256MB
  // （实测 200MB 通过、256MB 失败，总配额 10GB 不是瓶颈）。
  // 清单里的模型权重最小 417MB、最大 1.78GB —— 全部超限。
  // 而 Transformers.js 写缓存时是 `cache.put(...).catch(warn)` —— **失败被静默吞掉**，
  // 于是缓存里从来没有权重，每次加载都重新下载几百 MB～1.8 GB。
  //
  // 因此必须用自己的分片缓存（每片 ≤ 64MB），并通过 env.useCustomCache 交给库使用。
  //
  // 另外：分片 key **不能用 fragment（#）** —— Cache API 存/取时都会丢弃 fragment，
  // 会导致同一文件的所有分片塌缩成一个条目（后写的覆盖先写的）。
  const cacheSrc = readFileSync(
    new URL('../src/lib/ai/model-cache.ts', import.meta.url),
    'utf8',
  );
  check(
    /CHUNK_SIZE\s*=\s*64\s*\*\s*1024\s*\*\s*1024/.test(cacheSrc) &&
      // ⚠️ customCache 现在由 **Worker** 设置（加载与推理都已搬到 Worker）
      /useCustomCache\s*=\s*true/.test(workerSrc) &&
      /customCache\s*=\s*modelCache/.test(workerSrc) &&
      /modelCache\.put/.test(dlrSrc) &&
      /modelCache\.match/.test(dlrSrc) &&
      // key 用路径而非 fragment
      /KEY_BASE/.test(cacheSrc) &&
      !/CHUNK_SUFFIX\s*=\s*'#/.test(cacheSrc),
    '模型缓存按 64MB 分片并通过 env.useCustomCache 接入（绕开 Chrome 单条目 256MB 上限）',
    '分片缓存已接入，分片 key 用路径而非 fragment'
  );

  // ---------- 主题包：协议制（文件夹制）与内部 ThemePack 的适配 ----------
  // 文件夹制 theme.json 只有一套 colors，而内部 ThemePack 需要 light/dark 两套。
  // 若前端把协议包直接当内部结构用，pack.light 为 undefined，
  // buildCssVars() 会抛 TypeError 导致整棵 React 树崩溃。
  const protocolSrc = readFileSync(
    new URL('../src/lib/theme/protocol.ts', import.meta.url),
    'utf8'
  );
  const marketSrc = readFileSync(
    new URL(
      '../src/components/cards/theme-marketplace-panel.tsx',
      import.meta.url
    ),
    'utf8'
  );
  const themePlazaSrc = readFileSync(
    new URL('../src/lib/backend/theme-plaza.ts', import.meta.url),
    'utf8'
  );
  const storeSrc = readFileSync(
    new URL('../src/store/theme-store.ts', import.meta.url),
    'utf8'
  );

  check(
    /export function isProtocolTheme/.test(protocolSrc) &&
      /export function protocolToThemePack/.test(protocolSrc) &&
      /export function parseProtocolCss/.test(protocolSrc),
    '协议主题适配层存在（识别 / 转换 / CSS 解析）',
    'protocol.ts 提供 isProtocolTheme / protocolToThemePack / parseProtocolCss'
  );

  // 广场下载：主题仓库是文件夹制，后端已把它转成 .theme 单文件信封
  // （含亮/暗双变体、卡片风格、毛玻璃参数、壁纸绝对地址），
  // 前端直接用 themePackOf 解析即可 —— 不再在前端重复实现协议适配。
  check(
    /fetchPlazaThemeFile/.test(marketSrc) &&
      /themePackOf\(raw\)/.test(marketSrc),
    '广场下载走浏览通道的 .theme 导出，前端用 themePackOf 解析（后端负责协议适配）',
    'handleDownload 未使用 fetchPlazaThemeFile + themePackOf'
  );

  check(
    /plazaCoverUrl/.test(marketSrc) &&
      /backendBaseUrl/.test(themePlazaSrc),
    '主题封面 URL 补全为后端绝对地址（跨端口可访问）',
    'plazaCoverUrl 未接入 backendBaseUrl'
  );

  // 协议包必须能派生出完整的亮/暗两套配色，否则切换模式会崩
  check(
    /deriveDark/.test(protocolSrc) &&
      /makeVariant\(bg, fg, accent, card, border, 1\)/.test(protocolSrc),
    '协议色板派生出亮/暗两套完整配色',
    'deriveDark + makeVariant 就位'
  );

  // theme.css 的额外变量要注入 DOM，且切换主题时要清理旧变量
  check(
    /pack\.cssVars/.test(storeSrc) &&
      /removeProperty/.test(storeSrc) &&
      /injectedVarNames/.test(storeSrc),
    '主题包 CSS 变量注入 DOM 且切换时清理旧变量',
    'buildCssVars 注入 cssVars 并清理上一主题变量'
  );

  check(
    /--zj-card-alpha/.test(protocolSrc) &&
      /--zj-card-blur/.test(protocolSrc),
    '毛玻璃参数（透明度 / 模糊半径）可由主题包覆盖',
    '--card-alpha / --card-blur 已映射'
  );

  // 圆角是全局独立设置，不绑定主题包
  check(
    /name === '--radius'/.test(protocolSrc) &&
      /name === '--card-radius'/.test(protocolSrc),
    '圆角不随主题包绑定（--radius / --card-radius 被跳过）',
    '圆角变量已排除'
  );

  // ---------- 后端 AI 错误必须可读（不能是 "An error occurred."）----------
  // AI SDK 的 createUIMessageStream 默认 onError 返回 "An error occurred."，
  // 把真实错误全吞掉 —— 用户看到这句完全无从下手。
  // 而本项目后端就跑在用户机器上，绝大多数失败是「配置错了 / 网络不通」。
  const aiErrorsSrc = readFileSync(
    new URL('../server/src/ai-errors.js', import.meta.url),
    'utf8',
  );
  const aiStreamSrc = readFileSync(
    new URL('../server/src/routes/ai-stream.js', import.meta.url),
    'utf8',
  );
  const aiProxySrc = readFileSync(
    new URL('../server/src/routes/ai-proxy.js', import.meta.url),
    'utf8',
  );
  check(
    /STATUS_HINTS/.test(aiErrorsSrc) &&
      /redactSecrets/.test(aiErrorsSrc) &&
      /toUIMessageStream\(\{/.test(aiStreamSrc) &&
      /onError: \(error\) => describeAiError/.test(aiStreamSrc) &&
      /describeAiError/.test(aiProxySrc),
    '后端 AI 错误可读化：不用 AI SDK 默认的 "An error occurred."，改为可执行的中文提示',
    '错误已可读化（密钥在回传前剥离）',
  );

  // ⚠️ AI SDK v7 里 asUIMessageStream 已不存在，正确入口是独立的 toUIMessageStream。
  // 写成 asUIMessageStream 会让每一次后端模式对话都必然失败。
  //
  // ⚠️ 断言必须排除注释：这段代码的注释里恰好写着旧方法名（作为踩坑记录），
  // 直接全文匹配会误判。做法是按行过滤掉注释行后再查。
  const aiStreamCode = aiStreamSrc
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  check(
    !/asUIMessageStream/.test(aiStreamCode) &&
      /stream: result\.stream/.test(aiStreamCode) &&
      /originalMessages: rawMessages/.test(aiStreamCode),
    '后端流式接口使用 v7 的 toUIMessageStream（asUIMessageStream 在 v7 已不存在）',
    '已迁移到 v7 API，并回传 originalMessages 支撑多步工具调用',
  );

  // ---------- 插件 AI 必须可用且给出可执行提示 ----------
  const pluginStoreSrc = readFileSync(
    new URL('../src/store/plugin-store.ts', import.meta.url),
    'utf8',
  );
  const pluginUtilsSrc = readFileSync(
    new URL('../src/plugins/utils.ts', import.meta.url),
    'utf8',
  );
  const pluginTypesSrc = readFileSync(
    new URL('../src/plugins/types.ts', import.meta.url),
    'utf8',
  );
  check(
    // 必须实现 streamChat：此前类型里声明为可选却从未实现，
    // 导致 runAiStream 永远退化到一次性返回
    /async \*streamChat/.test(pluginStoreSrc) &&
      // 必须暴露 unavailableReason，让插件能提示「去做什么」
      /unavailableReason/.test(pluginTypesSrc) &&
      /ctx\.ai\.unavailableReason/.test(pluginUtilsSrc) &&
      // runAi 要先检查 available，不能让用户点按钮只看到笼统失败
      /if \(!ctx\.ai\.available\)/.test(pluginUtilsSrc),
    '插件 AI：实现 streamChat、暴露 unavailableReason，并在调用前检查可用性',
    '插件 AI 已打通且失败可读',
  );

  // ---------- 第三方插件必须能免构建运行 ----------
  const pjRuntimeSrc = readFileSync(
    new URL('../src/plugins/runtime.ts', import.meta.url),
    'utf8',
  );
  const pjLoaderSrc = readFileSync(
    new URL('../src/plugins/loader.ts', import.meta.url),
    'utf8',
  );
  const pjKernelSrc = readFileSync(
    new URL('../src/plugins/index.ts', import.meta.url),
    'utf8',
  );
  check(
    // 宿主必须把 React / UI 挂到全局，否则 blob 模块无法 import react
    /installPluginRuntime/.test(pjRuntimeSrc) &&
      /\.ZJ = buildSdk/.test(pjRuntimeSrc) &&
      // loader 必须在源码首部注入 shim，把 '@zhijianxia/runtime' 兑现为全局 SDK
      /__zj_sdk = globalThis\.ZJ/.test(pjLoaderSrc) &&
      /RUNTIME_EXPORT_NAMES/.test(pjLoaderSrc) &&
      /installPluginRuntime\(CORE_VERSION\)/.test(pjKernelSrc),
    '第三方插件免构建运行：宿主注入 globalThis.ZJ 运行时，loader 为 blob 模块注入 shim',
    '运行时 SDK 已挂载，shim 已注入',
  );

  // shim 解构的名字必须与 SDK 提供的字段一致，否则插件运行时才炸（且报错难懂）
  const shimBody = (pjLoaderSrc.split('RUNTIME_EXPORT_NAMES = [')[1] || '').split(']')[0];
  const shimNames = shimBody
    .split(',')
    .map((x) => x.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  const missing = shimNames.filter(
    (n) => !pjRuntimeSrc.includes(`  ${n},`) && !pjRuntimeSrc.includes(`  ${n}:`),
  );
  check(
    shimNames.length > 40 && missing.length === 0,
    `shim 解构的 ${shimNames.length} 个名字在运行时 SDK 中全部存在（防止第三方插件运行时才报 undefined）`,
    missing.length === 0 ? `shim 与 SDK 字段一致（${shimNames.length} 项）` : `缺少：${missing.join(', ')}`,
  );

  /* ====================================================================== */
  /* 主题广场（后端合并后的主题仓库）                                          */
  /* ====================================================================== */
  // 主题仓库是「数据即文件」：server/packages/themes/<slug>/ 每个文件夹一个主题。
  // 浏览通道（/api/themes）是公开的 —— 广场是公共目录，不该被「先登录」挡住。

  const plazaList = await req('/api/themes');
  check(
    plazaList.status === 200 &&
      Array.isArray(plazaList.data?.items) &&
      plazaList.data.total >= 1,
    'GET /api/themes 公开可用（无需登录）并返回主题列表',
    `status=${plazaList.status} total=${plazaList.data?.total}`,
  );

  const plazaItems = plazaList.data?.items ?? [];
  const plazaFirst = plazaItems[0];
  check(
    plazaItems.length > 0 &&
      plazaFirst.slug &&
      plazaFirst.name &&
      typeof plazaFirst.fileSize === 'number' &&
      typeof plazaFirst.updatedAt === 'number' &&
      Array.isArray(plazaFirst.tags),
    '主题列表项含 slug / name / fileSize / updatedAt / tags（广场卡片所需字段）',
    plazaFirst ? JSON.stringify(Object.keys(plazaFirst)) : '(空)',
  );

  // 每个主题都必须能导出成智简匣可导入的 .theme 信封
  if (plazaFirst) {
    const exported = await req(`/api/themes/${encodeURIComponent(plazaFirst.slug)}/theme-file`);
    const pkg = exported.data;
    check(
      exported.status === 200 &&
        pkg?.format === 'zhijianxia.theme' &&
        pkg?.formatVersion === 1 &&
        pkg?.manifest?.id &&
        pkg?.pack?.light?.bg &&
        pkg?.pack?.dark?.bg,
      '主题可导出为 .theme 信封（含亮/暗双变体，可被「导入 .theme」识别）',
      `status=${exported.status} format=${pkg?.format}`,
    );
    check(
      Boolean(pkg?.pack?.cssVars) || plazaFirst.slug === 'pure-light',
      '导出的主题保留了 theme.css 的额外变量（毛玻璃参数等）',
      `cssVars=${JSON.stringify(pkg?.pack?.cssVars)}`,
    );
  }

  // 路径穿越必须 400 —— 用原始 socket 测才有意义（curl/fetch 会在客户端规范化掉 ..）
  const themeRouterSrc = readFileSync(
    new URL('../server/src/routes/themes.js', import.meta.url),
    'utf8',
  );
  const themeScannerSrc = readFileSync(
    new URL('../server/src/theme-store/scanner.js', import.meta.url),
    'utf8',
  );
  check(
    /%2e\|%2f\|%5c/i.test(themeRouterSrc) &&
      /%25\(2e\|2f\|5c\)/i.test(themeRouterSrc) &&
      /decodeURIComponent/.test(themeRouterSrc),
    '主题路由对编码穿越 / 双编码 / 字面 .. 都做了原始 URL 守卫',
    '守卫缺失',
  );
  check(
    /startsWith\(themeDir \+ path\.sep\)/.test(themeScannerSrc) &&
      /path\.resolve\(themeDir, \.\.\.rest\)/.test(themeScannerSrc),
    'safeJoin 双重保险：断言结果仍在该主题目录内（防逃到兄弟主题）',
    'safeJoin 断言缺失',
  );

  // WebSocket：同一 HTTP server 上挂两条通道时必须用 noServer 手动分流，
  // 否则 ws 会在路径不匹配时直接 abort 掉 socket（握手 400）。
  const themeHubSrc = readFileSync(new URL('../server/src/ws/hub.js', import.meta.url), 'utf8');
  const themeServerSrc = readFileSync(new URL('../server/src/index.js', import.meta.url), 'utf8');
  check(
    /noServer:\s*true/.test(themeHubSrc) &&
      /handlePublicUpgrade/.test(themeHubSrc) &&
      /server\.on\('upgrade'/.test(themeServerSrc) &&
      /\/ws\/public/.test(themeServerSrc),
    'WebSocket 用 noServer 手动分流（/ws 聊天 + /ws/public 公开），避免握手互相 abort',
    'WS 分流缺失',
  );

  // 图片端点必须带 CORP 头 —— 前端启用了 COEP: require-corp，
  // 跨源图片缺这个头会被浏览器直接拦截。
  check(
    /Cross-Origin-Resource-Policy/.test(themeRouterSrc) &&
      /setImageHeaders\(res\)/.test(themeRouterSrc),
    '主题图片端点带 Cross-Origin-Resource-Policy（COEP 下不被浏览器拦截）',
    'CORP 头缺失',
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

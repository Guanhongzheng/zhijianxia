# 智简匣 · 会话交接文档

> 这份文档写给**新会话的第一条消息**。读完就能接着干，不需要翻历史对话。
> 产品说明与架构细节看 `README.md`（600+ 行，很完整），本文只讲 **README 没有的东西**：
> 当前状态、未完成的事、验证命令、踩过的坑。

---

## 0. 三十秒速览

| 项 | 值 |
| --- | --- |
| 项目 | 智简匣 Zhijianxia —— 本地离线 AI 优先的局域网工具箱 |
| 仓库 | `C:\Users\30386\Desktop\user\zhijianxia` |
| 分支 / 远端 | `main` / `https://github.com/Guanhongzheng/zhijianxia.git` |
| 前端 | Next.js（`localhost:3000`） |
| 后端 | Express 4 + ws 8 + `node:sqlite`（`127.0.0.1:8787`） |
| 规模 | 后端 22 个 JS · 前端 106 个 TS/TSX · 测试脚本 18 个 |
| 工作区 | 交接时干净且与 origin/main 同步；当前以 `git status` 为准 |

**产品定位一句话**：核心能力（离线 AI、插件、主题、备忘录）**全部在浏览器本地跑，不需要后端**；只有好友/群聊/公告/后端转发 API 才需要启动局域网后端。

---

## 1. 技术栈（含选型理由）

### 前端
`next` · `react` · `zustand`（状态）· `framer-motion`（动效）· `radix-ui`（无样式组件）· `tailwind-merge` + `clsx`（类名合并）· `zod`（校验）

**关键库**：
- `@huggingface/transformers` —— 浏览器内跑 LLM（WebGPU + ONNX Runtime Web + wasm 多线程）
- `@langchain/core` —— AI 编排层，**已移出首屏静态导入链**（首屏 JS −120KB）
- `ai` + `@ai-sdk/react` —— Vercel AI SDK，流式对话 / Tool Calling / 生成式 UI
- `@ai-sdk/{openai,anthropic,google}` —— 后端转发外部 API

### 后端
`express` · `ws` · `cors` · `archiver@^7`（zip 打包）· `chokidar`（文件监听）· `node:sqlite`（**内置，无需编译**）

### ⚠️ 依赖铁律
**往 CommonJS 后端加依赖前，先确认包的 `type` 字段。**

`archiver@8` 是纯 ESM，`require('archiver')` 返回 `{}`，调用即让后端崩溃
（curl 返回空响应 exit 52，排查花了好几轮）。`archiver@7` 才支持 CJS。

---

## 2. 目录结构

```
zhijianxia/
├── src/                          前端
│   ├── app/                      Next.js 路由
│   ├── components/cards/         11 个功能面板（见下表）
│   ├── lib/
│   │   ├── ai/                   19 个模块：local-engine / ai-worker / chain /
│   │   │                         model-download / ort-setup / scheduler /
│   │   │                         device-profile（GPU 预算）/ sdk/
│   │   │   └── engine/           ★ 推理引擎边界：types / registry / transformers
│   │   ├── backend/              后端 API 客户端（auth / registry / theme-plaza…）
│   │   ├── theme/                protocol.ts / packager.ts / types.ts / search.ts
│   │   └── storage/  registry-cache.ts  utils.ts
│   ├── store/                    app / auth / plugin / theme 四个 store
│   └── plugins/
│       ├── builtin/              4 个：文案卡片 / 备忘 / 语录 / 天气
│       └── downloadable/         7 个：音乐播放器 / 番茄钟 / 菜谱 / 摘要 /
│                                 单位换算 / 生词本
├── server/src/
│   ├── index.js                  入口：路由挂载 + WS upgrade 分流 + 监听器启动
│   ├── db.js  init-db.js  auth.js  packages.js  providers.js  ai-tools.js
│   ├── routes/                   auth / notices / friends / groups / messages /
│   │                             ai-proxy / ai-stream / registry / registry-validate / themes
│   ├── theme-store/              scanner.js  export.js  watcher.js
│   └── ws/hub.js                 WS 连接管理 + 心跳 + 广播（含公开组）
├── server/packages/themes/       ★ 主题仓库（文件夹即主题）
├── server/data/                  SQLite（git 忽略）
├── scripts/                      15 个测试与工具脚本
└── dist-plugins/  my-plugins/    构建产物 / 插件草稿（git 忽略）
```

---

## 3. 当前状态：都做了什么

### 已完成并推送（`git log --oneline -20` 可见）

| 提交 | 内容 |
| --- | --- |
| `7141e2f` | 补这份交接文档（最近一次） |
| `0d2d99a` | **主题广场并入主应用**（详见下节） |
| `e12bd4a` | 三套自制主题（墨黛/青柠/绯）+ 配色与导入校验工具 |
| `0e97322` | 首屏 JS −120KB（LangChain 移出静态导入链） |
| `9e2dcbc` | 修后端模式对话失败 + 打通插件 AI + 开放第三方插件创作 |
| `169566c` | AI 推理搬进 Web Worker + wasm 多线程（解决页面无响应） |
| `481eed2` `e0afc5d` `15a2cc6` `a9c15be` `7feede5` `9278a42` `31cdef2` | 一系列 WebGPU / 模型下载 / ORT 资源释放修复 |
| `781da6a` | 接入 Vercel AI SDK（流式对话、Tool Calling、生成式 UI） |
| `68de835` `5b0863f` | 仪表盘三列重排 + 功能广场 |
| `209c756` | 主题包改文件夹制 + 纯白主题 Pure Light |

### 最近一次改动：主题广场「意图搜索」

**背景**：原 theme-plaza 的语义搜索（`frontend/lib/semantic.ts`，Transformers.js 句向量）
随那个工程一起删了，广场只剩子串匹配 —— 搜「暗色的简约主题」一条都出不来。

**结论：不搬回向量检索，改做词表级语义。** 理由（这段是决策记录，别推翻重来）：
- 中文句向量模型最小 ~25 MB，广场当前只有 5 个主题 —— 为 5 条记录下 25 MB，
  与「本地离线优先」的定位冲突；
- 模型要走 ORT 建 session，本仓库在 ORT 上踩的坑已经很多，搜索不该成为新错误源；
- 主题元数据本身是结构化的（tags / category / description 都是作者刻意写的），
  「概念词典 + 字段加权」就能拿到可解释的结果，且瞬时、零下载、可单测。

**新增**：
- `src/lib/theme/search.ts` —— `parseQuery` / `scoreTheme` / `searchThemes`。
  12 个概念族（暗色 / 亮色 / 毛玻璃 / 简约 / 描边 / 高饱和 / 暖色 / 冷色 / 东方水墨 /
  沉浸 / 高对比 / 护眼），同义词归一到概念；字段权重 name 3 > tags 2.5 > category 2 >
  slug·desc 1.2 > author 0.3；单概念贡献封顶 3.5，避免「一个词堆料多的主题」压过
  「两个词都命中的主题」。
- `scripts/theme-search-test.mjs` —— 21 项，语料直接读 `server/packages/themes`（非手写 fixture）。
  重点断言「查询词在全部元数据里根本不出现却仍能命中」，这才证明走的是概念映射。
- 面板接入：结果按相关度排序 + 搜索框下方显示**理解结果**（`理解为 暗色 简约`），
  让词表法的「猜错」对用户可见，而不是黑箱排序。

**已知边界**：词典外的主观表达（「像咖啡馆那种」）搜不到，退化为关键词子串匹配 —— 
与改造前一致，不会更差。主题量上到 200+ 再考虑接向量重排（接口不用动）。

**顺手记一笔**：`theme.json` 里的 `scheme`（dark/light）**没有**进 `/api/themes` 列表响应，
所以前端拿不到「亮/暗」这一结构化维度，只能靠 tags 判断。要精确按明暗筛选，得先补这个字段。

---

### 上一次改动：主题广场并入主应用

**背景**：原先有一套独立的 theme-plaza 后端（已删除，含 git 历史）。用户澄清那是提示词给错时误建的，本意就在 zhijianxia 里做 → 能力整体并入主后端 8787。

**新增**：
- `server/src/theme-store/scanner.js` —— 目录扫描，校验**复用 registry 的 `validateThemePack`**，保证浏览通道与管理通道判定一致
- `server/src/theme-store/export.js` —— 文件夹制主题 → `.theme` 信封
- `server/src/theme-store/watcher.js` —— chokidar 监听 + 周期对账
- `server/src/routes/themes.js` —— **公开浏览通道** `/api/themes*`（免鉴权）
- `server/packages/themes/abyss-glass/` —— 深空琉璃（极光壁纸 + 多层毛玻璃）
- 前端 `src/lib/backend/theme-plaza.ts` + 改 `theme-marketplace-panel.tsx`

**设计要点**：
- **双通道分工**：`/api/registry/themes` 是**管理**通道（需登录，上传/删除）；`/api/themes` 是**浏览**通道（公开）。广场是公共目录，不该被「先登录」挡住。
- **丢弃 SQLite 存表**：改用「目录即权威 + 30 秒缓存」，与既有 `packages.js` 设计一致，避免 DB 与文件系统的同步问题。
- **三道安全闸**：slug 与文件名白名单正则 → `safeJoin` 断言结果仍在该主题目录内 → 图片/压缩包一律流式返回。

---

## 4. 未完成 / 待办

| # | 事项 | 优先级 | 说明 |
| --- | --- | --- | --- |
| 1 | **Windows 上 chokidar 不可靠** | 低 | 删目录时 EPERM 且 `unlinkDir` 延迟送达。当前靠 15 秒周期对账兜底。主题量大时可考虑改 `fs.watch` 或只靠对账 |
| 2 | **本机 AI 配置自相矛盾** | 中 | 当前 `capabilities.chat.provider=deepseek`，但 `base=https://api.openai.com/v1`、`model=gpt-4o-mini`（后端 chat 的 base/model 读历史键，provider 读 `ai_cap_chat`，两个写入方各改一半就会这样）。**症状**：`hasKey=true` 却对话 401/502，且 OpenAI 域名国内不可达。修法：在「设置 · AI」重选服务商后重填地址，或直接 PUT `{capability:'chat', provider:'deepseek', base:'https://api.deepseek.com/v1', model:'deepseek-chat'}` |
| 3 | **列表通道缺 `scheme` 字段** | 低 | `theme.json` 有 `scheme`（dark/light），但 `/api/themes` 列表响应没带 → 前端无法按明暗精确筛选，只能靠 tags。补一个字段即可（scanner + 类型 + 测试） |
| 4 | **AI 引擎升级（7B 目标）** | 中 | 详情见 `docs/AI-RUNTIME-ROADMAP.md`。结论：静态内存规划 / OPFS 流式 / KV 压缩 / 核融合 / GGUF 量化档**全部依赖换引擎**，当前 ORT Web 不提供这些钩子。路径是先抽 `LocalEngine` 接口（行为不变），再接 WebLLM。**待用户拍板三件事**：7B 预期是否下调、是否接受第二套模型格式、是否接受 ≈2 MB 依赖 |

> **本轮已修复（原待办 1、4）**
>
> 1. 契约测试「AI 配置不返回明文 Key（仅 hasKey）」恒红 —— 根因是断言写法而非接口缺陷：
>    旧断言 `hasKey === false` 等价于「本机从未配置 Key」，属环境耦合，配过 Key 就永远红。
>    已改为结构断言（`hasKey` 为布尔 + 递归扫描无 Key 字段/类密钥值），并以正负样本
>    验证检测器确实会亮。这是「测试错、代码对」的又一例，与 §6 通用原则 A 一致。
> 2. 契约测试原先会**写坏本机配置** —— `PUT /api/ai/config` 把 base/model 冲成 OpenAI 默认值。
>    现已改为「先快照、`try/finally` 还原、并断言还原成功」，body 不带 apiKey 故不碰 Key。
>    实测：先把配置改成哨兵值（deepseek/45000/0.3）→ 跑测试 → 配置逐字段仍是哨兵值。
>
> 现 **69/69**（新增「契约测试不留副作用」与「GPU 预算按限额计算」两项）。

---

## 5. 命令速查

### 启动

```bash
# 前端（必做）
cd C:/Users/30386/Desktop/user/zhijianxia
npm run dev                    # → http://localhost:3000

# 后端（可选，功能广场主题页需要它）
npm run server                 # → http://127.0.0.1:8787
# 首次需初始化：npm run server:init
```

### 验证（按耗时从短到长）

```bash
npm run typecheck              # tsc，约 20s
npm run contract               # 契约测试，约 10s，当前 69/69
npm run theme:search           # 意图搜索 21 项，约 1s（纯函数，不依赖前后端）
npm run ai:budget              # GPU 权重预算 12 项，约 1s（纯函数）
npm run theme:security         # 路径穿越 17 项，约 5s
npm run theme:ws               # WS 推送 3 项，约 15s
npm run plugins:verify         # 插件 35 项，约 10s（**依赖 dist-plugins 产物**，见下）
npm run e2e:offline            # 离线 E2E 8 项
npm run e2e                    # 完整 E2E 79 项，约 3min（需前后端都在跑）
npm run theme:verify           # 浏览器端到端 11 项（需前后端都在跑）
```

> ⚠️ `plugins:verify` 的 [5/5] 会读 `dist-plugins/*.plugin` 并断言恰好 6 个。
> 该目录是 gitignore 的构建产物 —— **干净 checkout 上必须先 `npm run plugins:build`**，
> 否则 ENOENT 直接崩。本机一直能跑绿只是因为那个目录早就在了。

### CI（`.github/workflows/ci.yml`）

push 到 main / 开 PR / 手动触发时，按「先便宜后昂贵」的顺序跑：
`typecheck` → `theme:search` → `plugins:build` + `plugins:verify` →
起后端（`server:init` + 等 `/api/themes` 返回 200）→ `contract` → `theme:security` → `next build`。

两个**第一次跑就红**的坑（都已修，留作前车之鉴）：
1. 根目录 `npm ci` **不装后端依赖** —— 后端有独立的 `server/package.json`，
   必须再 `npm ci --prefix server`，否则 `Cannot find module 'express'`；
2. `plugins:verify` 读 `dist-plugins/*.plugin` 并断言 6 个，而该目录是构建产物，
   干净 checkout 上必须先 `npm run plugins:build`。

现状：全绿，单次约 50 秒（含生产构建 14s）。
查看入口：仓库 Actions 页 → `CI`（也可直接查 API：
`https://api.github.com/repos/Guanhongzheng/zhijianxia/actions/runs?per_page=3`）。

刻意没进门的：`e2e` / `e2e:offline` / `theme:verify` / `theme:ws`（前三个要真实浏览器，
最后一个会连带停掉后端、见 §6 坑 J）。

### 隔离构建（不打扰 dev server）

```bash
ZJ_DIST_DIR=.next-ci npm run build   # 产物写 .next-ci/，dev server 的 .next 不受影响
```

`next.config.ts` 读取该环境变量设置 `distDir`（`.next-ci/` 已 gitignore）。
注意：`next build` 会**自动改写 `tsconfig.json`** 的 `include`，追加
`.next-ci/types/**`；构建完记得 `git checkout -- tsconfig.json`，别把它提交进去。

### 主题相关

```bash
npm run themes:check           # 校验主题包格式与对比度
npm run themes:verify          # 主题渲染验证
npm run theme:covers           # 给缺封面的主题生成封面
node scripts/migrate-themes.mjs   # 从 .theme 信封批量转文件夹制
node scripts/make-aurora-assets.cjs # 重新生成深空琉璃的极光素材
```

### 种子账号

昵称 `管理员` · 密码 `admin123` · UID `ZJ-ADMIN01`

---

## 6. 踩过的坑（**这些是真会咬人的**）

### 通用原则

**A. 先分清「代码错」还是「测试错」，再动手改。**
本项目多次出现测试红了但代码是对的：路径穿越测试用 `fetch` 测（客户端已规范化 `..`）、
图片断言写死 PNG 签名、冒烟测试写死主题数量。改代码前先确认基准。

### 环境与依赖

**B. `next build` 会被 safe-delete 批量删除守卫拦住**
Next 内部要清 `.next/trace-build` 等目录，目录内文件数 ≥ 50 就触发
`SAFE_DELETE_BULK_CONFIRM_REQUIRED`。解法：`rm -rf .next` 整体删（可再生），
或用 `ZJ_DIST_DIR=.next-ci npm run build`（该环境变量现已**正式支持**，见 §5）。
**注意**：`npx next build | head -N` 的退出码是 `head` 的，不是 build 的 —— 会掩盖失败。
**另注意**：构建会改写 `tsconfig.json` 的 `include`，记得还原。

**C. 同一 HTTP server 挂两个 WebSocketServer → 握手 400**
每个 WSS 都注册自己的 upgrade 监听，`shouldHandle` 不匹配时直接 **abort socket**。
必须用 `noServer: true` + `server.on('upgrade')` 手动分流。
（`hub.js` 的 `/ws` 聊天 + `/ws/public` 公开就是这么做的。）

**D. `archiver@8` 是纯 ESM，CommonJS require 拿不到默认导出** → 见 §1 铁律。

### 路径与安全

**E. 路径穿越必须用原始 socket 测 —— curl/fetch 测不出真实防护**
curl 与 fetch 都会在**客户端**把 `..` 规范化掉：`fetch('/api/themes/x/preview/..')`
实际发出 `/api/themes/x/`。用它们测「服务端是否防护」根本测不出来 —— 攻击已被客户端消解。
正确做法：`node:net` 逐字节发真实请求（`scripts/theme-security-test.mjs`）。

**F. Express 4 会在路由匹配前规范化路径**
`/api/themes/x/preview/..` **规范化后命中详情路由（200）**。
必须在 `req.originalUrl` 上做原始 URL 守卫（检测 `%2e`/`%2f`/`%5c`、`..` 段、双编码 `%25xx`）。

**G. safeJoin 的第二道闸写松了会被越权**
只断言「在 THEMES_ROOT 之内」不够 —— `slug + ['..','..','x']` 解析后落在
`themes/x`（**兄弟主题目录**），仍能通过。必须再断言「在该主题目录之内」。

### 文件监听与缓存

**H. 缓存失效时机反了 → WS 事件压根不发**
`refreshOne` 里先 `scanThemes()`（拿到 30 秒陈旧缓存）后 `invalidateThemesCache()`。
新主题不在旧快照里 → 永远判不出 added。**必须先失效再扫描。**

**I. 扫描器跳过「不完整」的主题 → 永远判不出 removed**
目录删掉后扫描器看到「缺文件」就跳过。真正知道目录没了的信号是 chokidar 的
`unlinkDir` → 显式传 `dirGone` 标记走删除分支。
Windows 递归删除时 `theme.json` 未必最后被删，所以判据要用「目录里还有没有文件」。

**J. `theme-ws-test.mjs` 会连带停掉后端**
它会创建/删除测试主题目录，跑完后后端进程可能已退出。紧接着跑其它测试会全线
`ECONNREFUSED`。**串行跑多个测试脚本时，每个之间都要确认后端还活着。**

### 前端与浏览器

**K. COEP 会静默拦截跨源图片**
前端启用了 `Cross-Origin-Embedder-Policy: require-corp`（为 WebGPU / wasm 多线程）。
跨源图片缺 `Cross-Origin-Resource-Policy: cross-origin` 会被浏览器拦掉，
**报错 `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin...`，网络面板里状态码可能还是 200**。
所有图片端点都要发这个头。

**L. 静态导出 + useSearchParams 必须包 Suspense**
否则预渲染直接失败：`useSearchParams() should be wrapped in a suspense boundary`。
拆成 `page.tsx`（Server Component，提供 Suspense）+ `detail-client.tsx`（`'use client'`）。

**M. Playwright 选 EntryCard（motion.button）时 `getByRole('button', {name})` 匹配不到**
可访问名是 title+desc 拼接的无空格字符串。改用 DOM 级：找标题 `<p>` 再点它最近的 `<button>`。

**N. 「个性化」是设置面板的左侧 nav 项（`SETTINGS_SECTIONS`），不是 Tab。**
按钮文案是「导入 .theme」；「导入本地主题」是上一行的说明文字。

**O. favicon 404 是既有噪音，判定要看 URL 不是消息文本**
console 消息文本里只有「404」，不含「favicon」。要用 `m.location()?.url` 判定。

### 主题包与素材

**P. 图片资产转 WebP：同画质体积差约 40 倍**
`sharp().webp({ quality: 90 })`：3.6MB → 104KB。转完**必须同步改 `theme.json` 里声明的
文件名**，否则壁纸 404。更进一步：`resolveWallpaperFile()` 加两级回退
（声明优先 → 回退到 `assets/` 下按 webp→jpg→png 取第一张图），以后换格式不会再坏链。
封面探测顺序也已改成 webp 优先。

**Q. 暗色主题必须显式声明 `"scheme": "dark"`（真 bug）**
智简匣的协议转换默认「以色板作为**亮色**基准，再派生暗色」。
暗色主题不声明 → `bg #080b14` 被派生成 `#e1e2e3` / card `#d4d5d8`，在设置面板里看着像坏了。
不写 `scheme` 时按背景亮度自动判断（< 0.4 视为暗色）。

**R. 壁纸亮度要按「盖完遮罩后」调**
宿主 `globals.css` 会在壁纸上盖一层 `background: var(--zj-bg)` 且
`opacity: var(--zj-wallpaper-veil)`（亮色模式 veil 高达 0.5）。
壁纸本身好看 ≠ 应用里看得见 → 脚本额外输出**盖完遮罩的合成预览**
（`previews/composite-veil-*.webp`），所见即所得。

**S. 条纹调制必须作用在光斑自己的 alpha 上，不能事后改像素**
「先合成所有帘带，再按条纹缩放像素」→ 帘带互相干扰（后者拿到被前者改过的像素）→ 切出矩形硬边。
改成把 `modulate` 函数传进光斑函数，各帘带独立叠加。

**T. 测试别写死主题数量**
「新增主题」是这套系统的核心用法，写死数量等于把正常操作变成测试失败。
改成动态计算（总数 = v1+v2、sort 首项 = 动态取 mtime 最大者、分页 = 剩余数）。

**U. 只有「干净数据库」才会暴露的初始化失败（CI 首跑抓到的）**
`init-db.js` 里 `CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_id)` ——
而 `friends` 表的列叫 `user_uid`（`user_id` 是 `sessions` 的）。本机永远不报错，
因为同名索引早就存在，`IF NOT EXISTS` 直接跳过；**只有全新库才炸**
`no such column: user_id`，初始化中断 → 后续所有测试 ECONNREFUSED。
→ 教训：`IF NOT EXISTS` 会把「定义写错」悄悄吞掉，本机能跑 ≠ 新环境能装。
→ 复现方式：`git worktree add` 出一个干净树（`server/data` 是 gitignore 的）
  再跑 `npm run server:init`，比清本机数据库安全得多。
→ CI 的价值正在这里：它永远从「干净 checkout + 空数据库」开始。

**V. 硬编码的「设备上限」必然两头都错**
`WEBGPU_MAX_Q4_BYTES = 1 GiB` 是从**一台**机器实测出来的经验值，却被当成规范：
- 报 256 MiB 的设备（部分集显 / 移动端）会先放行、下完几百 MB 才崩；
- 报 4 GiB 的设备本可跑 1.7 GB 的 1.5B，却被常量误拦到 WASM。

现改为读 `GPUAdapter.limits`：`min(maxBufferSize, maxStorageBufferBindingSize) × 50%`。
系数 50% 让主流 2 GiB 设备算出正好 1 GiB（历史行为不变），只修正两端。
判据在 `src/lib/ai/device-profile.ts`（纯函数，`npm run ai:budget` 覆盖）。
**通用教训**：凡是「设备/环境上限」类常量，都应该读实际配额 + 留比例余量，
而不是把某次实测值当成普适红线。

---

## 7. 主题包格式（新增主题必读）

**文件夹名 = slug = `theme.json` 里的 `id`**，三者必须一致，否则拒绝加载。

```
server/packages/themes/<slug>/
├── theme.json      必需：id（=文件夹名）/ name / version / protocol（数字 1|2）
│                          colors（5 个 CSS 变量，必需）/ scheme（暗色必写 "dark"）
│                          wallpaper（可选，相对路径）/ tags / author / description
├── theme.css       必需：CSS 变量；额外变量会进 cssVars（毛玻璃参数等）
├── cover.webp      可选：jpg|png|webp，探测顺序 webp → jpg → png
├── previews/       可选：*.webp|jpg|png
└── assets/         可选：壁纸等
```

**对比度要求**：WCAG AA 要求 4.5:1。现有的墨黛/青柠/绯都是 13~16。

**导入闭环**：`/api/themes/:slug/theme-file` 导出 `.theme` 信封 →
「设置 · 个性化 → 导入 .theme」→ `themePackOf` → 应用。链路已验证通。

---

## 8. 接口约定（改代码前必读）

**Response 约定**（`server/src/index.js` 有统一处理）：
- 成功 → 直接返回数据
- 失败 → `{ error: '中文说明' }`，HTTP 状态码语义化（400/401/403/404/500）

**双通道分工**：
| 通道 | 鉴权 | 用途 |
| --- | --- | --- |
| `/api/registry/*` | 需登录 | 管理：上传、删除、列出插件/主题包 |
| `/api/themes*` | 公开 | 浏览：列表、详情、封面、预览图、壁纸、zip 下载、`.theme` 导出 |

**WebSocket**：
| 路径 | 鉴权 | 用途 |
| --- | --- | --- |
| `/ws` | 需登录 | 聊天、在线状态、主题事件 |
| `/ws/public` | 公开 | 主题广场实时更新（未登录也能收） |

**主题事件格式**：`{ type: 'added' | 'changed' | 'removed', slug }`

---

## 9. 交给新会话的建议工作顺序

如果接手后要继续推进，建议：

1. **先跑一遍验证**（§5 的命令）确认基线是绿的：`typecheck` / `contract` / `theme:search` / `theme:security` / `plugins:verify` 应分别是 0 错 / 69/69 / 21/21 / 17/17 / 35/35。任一项比这个少，先查是不是环境（后端没起、端口被占）。
2. **按需推进**：想扩功能就从 §4 表里挑；想优化就先读 §6 相关坑，避免重复踩。
3. **改完照 §5 从短到长复跑**，注意坑 J（`theme:ws` 会连带停后端）。

---

## 10. 已随 theme-plaza 永久删除的内容

用户确认**不备份**，以下已无法恢复（`.git` 的 2 个提交只在本地，无远端）：
- `ed3676b`、`41b73f0` 两个提交
- `frontend/lib/semantic.ts` —— Transformers.js 语义搜索
- `frontend/plaza-standalone.png` —— 未跟踪的截图

其余能力（主题扫描、WS 推送、`.theme` 导出、深空琉璃主题、极光素材生成器）均已保留。
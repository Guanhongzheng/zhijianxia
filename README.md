# 智简匣 · Zhijianxia

> 本地离线 AI 优先的局域网工具箱 —— 前端可独立运行，后端按需启动，功能全部通过插件广场扩展。

智简匣是一个**前后端解耦**的 Web 应用：核心能力（离线 AI、插件内核、主题包、备忘录等）全部在浏览器本地运行，**不需要启动后端**；只有当你要使用**好友、群聊、公告管理、后端转发外部 API** 这类需要共享数据的功能时，才需要按需启动局域网后端。

---

## 目录

- [特性](#特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [后端可选启动教程](#后端可选启动教程)
- [项目目录](#项目目录)
- [核心架构](#核心架构)
- [插件开发模板](#插件开发模板)
- [第三方插件开发（免构建）](#第三方插件开发免构建)
- [Git 与 GitHub](#git-与-github)
- [常见问题](#常见问题)

---

## 特性

### 本地离线 AI 为核心

- 前端通过 **Transformers.js** 在浏览器内加载量化模型 `Xenova/Qwen1.5-0.5B-Chat`
- 所有推理在用户设备本地完成，**提示词不上传任何服务器**，隐私优先
- 模型缓存后完全离线可用，无需后端
- 统一 AI 调度层自动判断模式（本地 / 后端转发）与后端在线状态

### 插件热插拔架构

- 插件内核与所有功能插件**完全解耦**，每个插件独立开发、单独打包
- 新增插件**无需修改 AI 核心代码**
- 内置功能广场插件市场，支持关键词搜索、分类筛选、一键安装/卸载
- 插件包可导出为 `.plugin` 文件备份分享，也可从本地导入安装
- 导入时校验插件版本与内核兼容性，非法插件拒绝加载并给出中文提示
- 插件通过 `PluginContext` 调用全局 AI、主题、存储能力，不直接接触全局状态

### 界面风格

- **扁平卡片**：1px 边框 + 极轻阴影 + 统一圆角，卡片按内容自适应高度并保留留白
- **卡片图标**：主题色浅底圆角方块 + 线性图标
- **上导航栏**：横跨顶部占满左右，左侧品牌区（图标 + 标题 + 副标题），右侧后端状态与亮暗切换
- **下导航栏**：横跨底部占满左右
  - 第 1 页为登录卡片（未登录显示登录入口，已登录显示头像昵称与「进入功能区」）
  - 第 2 页为状态栏：左侧圆形头像与问候语，右侧后端状态图标、**插件切换器**（点击展开已安装插件列表，点击即启动）与「启动插件」主行动
- **设置面板**：左侧导航 + 右侧内容，共 7 个分区
  - 个人资料（可编辑昵称与简介）、个性化、AI 引擎、局域网、API、通用、关于
- **界面大小**：小 / 中 / 大三档，通过根字号 + Tailwind 字号变量整体缩放，选择后立即生效并持久化
- 全部颜色由 CSS 变量驱动，主题包切换时整套界面同步换色

### 插件包与主题包仓库

插件包与主题包统一存放在**后端包目录**（文件系统即仓库），
局域网内任意设备都能浏览、下载、分享。

| 层 | 位置 | 作用 |
|----|------|------|
| **仓库** | `server/packages/plugins/*.plugin`<br>`server/packages/themes/<theme-id>/` | 权威来源，包文件即本体 |
| **本地缓存** | IndexedDB / LocalStorage | 每台设备下载后的副本，**离线可用** |

> 包文件是**唯一权威来源**，不落数据库。
> 直接往 `server/packages/` 下丢 `.plugin` 文件或主题文件夹，重启后端即可被广场浏览到；
> 通过广场「上传」写入的包同样落到这两个位置。

---

#### 主题包：文件夹制（protocol 格式）

主题包以**文件夹**形式组织，每个主题在 `server/packages/themes/` 下独占一个子文件夹，
**文件夹名必须与该主题 `theme.json` 中的 `id` 完全一致**：

```
server/packages/themes/          # 主题目录
└── <theme-id>/                  # 单个主题，文件夹名 == theme.json 的 id
    ├── theme.json               # 必需：主题清单
    ├── theme.css                # 必需：样式变量
    └── assets/                  # 可选：壁纸等二进制资源
        └── wallpaper.webp
```

`theme.json` 严格字段白名单（**不得发明字段**）：

```jsonc
{
  "id": "pure-light",            // 小写字母-数字-连字符，1~32 字符，全局唯一
  "name": "Pure Light",
  "author": "智简匣",
  "version": "1.0.0",            // 语义化版本
  "protocol": 1,                 // 1 或 2；2 支持视频、自定义文本、BGM
  "description": "纯白通透主题",  // 一句话简介，≤80 字
  "colors": {                    // 五个必需语义色
    "--bg": "#f7f8fa",
    "--fg": "#16181d",
    "--accent": "#5b8def",
    "--card": "#ffffff",
    "--border": "#e6e8ee"
  },
  "wallpaper": "assets/wallpaper.webp",   // 相对 theme.json 的路径

  // 以下仅 protocol: 2 可用
  // "video": { "src": "assets/video.mp4", "blur": true },
  // "bgm": { "home": "assets/bgm-home.mp3" },
  // "texts": { "windowTitle": "自定义窗口标题" }
}
```

`theme.css` 只写 `:root { --变量: 值; }` 形式的变量声明：

```css
:root {
  --bg: #f7f8fa;
  --fg: #16181d;
  --accent: #5b8def;
  --card: #ffffff;
  --border: #e6e8ee;
  --fg-muted: #6b7280;    /* 层次色，映射到 --zj-muted-fg */
  --card-alpha: 0.72;    /* 毛玻璃透明度 */
  --card-blur: 20px;     /* 毛玻璃模糊半径 */
}
```

> 约束：不得写 `@import` / `url()` / `position: fixed`，
> 不得在 `themes/` 根目录直接放 `theme.json` 或 `assets/`。

**资源约束**：

| 资源 | 格式 | 上限 |
|------|------|------|
| 壁纸 | WebP（长边 ≤ 2560） | ≤ 2MB |
| 背景视频 | MP4（仅 protocol 2） | ≤ 35MB |
| BGM | MP3 / OGG（仅 protocol 2） | ≤ 5MB |

**质量要求**：`--fg` 与 `--bg` 对比度 ≥ 4.5:1（后端落盘时强制校验，不达标直接跳过）；
壁纸需低对比、不干扰文字；风格一致；文案克制。

**协议包 → 内部主题模型的适配**：
协议主题只有**一套**语义色板，而宿主需要**亮/暗两套**完整配色。
`src/lib/theme/protocol.ts` 负责这层转换：

- 色板 → 亮色模式基准，再按亮度**自动派生**暗色模式配色（保证两种模式都可读）；
- `theme.css` 的语义变量 → 宿主 `--zj-*` 变量空间（`--bg` → `--zj-bg` 等），
  其中五色板变量优先级高于 `theme.json`（theme.css 是「变量与覆盖」）；
- `--card-alpha` / `--card-blur` 覆盖毛玻璃卡片参数，`--radius` 被忽略（圆角是全局设置）；
- 壁纸相对路径 → 后端绝对 URL（`/theme-assets/<id>/assets/<file>`，跨端口可访问）。

> 资源由后端以 `Cross-Origin-Resource-Policy: cross-origin` 提供 ——
> 前端启用了跨域隔离（COEP）以跑 WebGPU，跨源资源不带该头会被浏览器拦截。

---

#### 插件包与单文件主题包（信封制）

**插件包（`.plugin`）与单文件主题包（`.theme`）都是打包文件**，采用同款「信封 + 载荷」结构：

```jsonc
// .theme 示例（.plugin 结构相同，只是载荷段不同）
{
  "format": "zhijianxia.theme",
  "formatVersion": 1,
  "manifest": {
    "id": "my-theme",
    "name": "我的主题",
    "version": "1.0.0",
    "description": "一套自制的 UI 主题",
    "author": "设计者",
    "preview": "🎨",
    "tags": ["深色"],
    "category": "综合"
  },
  "pack": {
    "light": { "accent": "#4f6bed", "accentSoft": "#eef1fe", "card": "#ffffff",
               "bg": "#f6f7f9", "fg": "#1c1f24", "mutedFg": "#6b7280",
               "border": "#e6e8ec", "radius": 16, "shadow": 2 },
    "dark":  { "...": "同上" },
    "wallpaper": { "light": { "kind": "gradient", "gradient": "linear-gradient(...)", "veil": 0.9 } },
    "brand": { "icon": "🎨", "name": "我的应用", "tagline": "副标题" },
    "card":  { "style": "glass", "borderWidth": 1, "accentBar": true },
    "nav":   { "style": "glass", "height": 56, "showIcon": true }
  }
}
```

> **主题包在外部制作**（设计工具或手工编辑 JSON），
> 应用内只提供「导入 .theme」「从广场下载」「导出」「上传」，
> 图标 / 卡片 / 导航栏 / 配色 / 壁纸等定制项**只能在主题包里定义**，前端不提供制作界面。

**主题包可定制的维度**（`brand` / `card` / `nav` 三段均为**可选**，缺省时按默认值补全）：

| 段 | 字段 | 取值 | 作用 |
|----|------|------|------|
| `brand` | `icon` | emoji 或 `https://` 图片地址 | 导航栏左侧的应用图标 |
| `brand` | `name` / `tagline` | 文本 | 应用名与副标题（首页顶栏） |
| `card` | `style` | `flat` / `elevated` / `outline` / `glass` | 卡片风格（扁平 / 悬浮 / 描边 / 毛玻璃） |
| `card` | `borderWidth` | 0 – 6 | 卡片边框宽度 |
| `card` | `accentBar` | 布尔 | 卡片顶部主色强调条 |
| `nav` | `style` | `flat` / `glass` / `solid` / `minimal` | 上下导航栏风格 |
| `nav` | `showIcon` | 布尔 | 是否显示品牌图标 |
| `pack` | `light` / `dark` | 配色 | 主色、卡片底色、背景色、文字色、阴影（**圆角不再由主题包定义**） |
| `pack` | `wallpaper` | 壁纸 | 内置渐变 / 内置图片 / 用户自定义 |

> **圆角不绑定主题包**：圆角是「设置 · 个性化」里的**全局独立选项**（直角 / 小圆角 / 常规 / 大圆角 / 更大 / 胶囊），
> 切换主题包时保持不变。旧包中若带有 `radius` 字段，导入时会被忽略，落盘时也会被剥离。

**主题分类**（广场「主题」页与后端 `theme_packages.category` 字段一致）：
`综合` / `配色` / `卡片` / `导航栏` / `壁纸` / `图标`。

**仓库 API**（均需登录，写操作需管理员）：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/registry/plugins` | 列出插件包 |
| GET | `/api/registry/plugins/:id` | 下载插件包内容 |
| POST | `/api/registry/plugins` | 上传/覆盖插件包 |
| DELETE | `/api/registry/plugins/:id` | 删除插件包 |
| GET | `/api/registry/themes` | 列出主题包 |
| GET | `/api/registry/themes/:id` | 下载主题包内容 |
| POST | `/api/registry/themes` | 上传/覆盖主题包 |
| DELETE | `/api/registry/themes/:id` | 删除主题包 |

**使用流程**：
- 插件：广场点「下载」→ 从后端取包 → 校验兼容性 → 缓存到 IndexedDB → 启用，此后离线可用
- 主题：广场 → 「主题」分类页点「下载」→ 立即应用并缓存到本地；也可设置 → 个性化 →「导入 .theme」

**新增主题包**（文件夹制）：

```bash
# 1) 建目录，目录名必须与 theme.json 的 id 一致
mkdir -p server/packages/themes/my-theme/assets

# 2) 写入 theme.json / theme.css / assets/
# 3) 重启后端，即可在广场「主题」页看到并下载
```

> 后端启动时扫描 `server/packages/themes/` 下的每个子文件夹，
> 校验 `theme.json` 字段、`theme.css` 存在性、对比度与资源约束，任一不达标则跳过并打日志。
> 同 id 冲突时**文件夹制优先于单文件信封制**。

### API 服务商与能力分类

API 配置按**能力分类**组织，四类能力各自独立选择服务商与模型：

| 能力分类 | 可选服务商 | 模型示例 |
|----------|-----------|----------|
| **文本对话** | OpenAI API、Anthropic Claude API、Google Gemini API、智谱AI API、DeepSeek API | GPT-4o mini、Claude 3.7 Sonnet、Gemini 2.0 Flash、GLM-4 Flash、DeepSeek Chat |
| **多模态模型** | OpenAI API、Anthropic Claude API、Google Gemini API、智谱AI API、通义千问VL | GPT-4o、Gemini Pro Vision、Qwen-VL Plus |
| **图像生成** | OpenAI API、Stability AI API | DALL·E 3、Stable Image Core |
| **语音模型** | OpenAI API | Whisper API、TTS API |

**四种请求协议**（后端按服务商自动分派，前端无需关心）：

| 协议 | 服务商 | 端点 | 鉴权头 | 响应字段 |
|------|--------|------|--------|----------|
| `openai` | OpenAI / 智谱 / DeepSeek / 通义 | `{base}/chat/completions` | `Authorization: Bearer` | `choices[0].message.content` |
| `anthropic` | Claude | `{base}/messages` | `x-api-key` + `anthropic-version` | `content[0].text` |
| `gemini` | Gemini | `{base}/models/{model}:generateContent` | `x-goog-api-key` | `candidates[0].content.parts[0].text` |
| `stability` | Stability AI | `{base}/{model}/text-to-image` | `Authorization: Bearer` | 二进制 PNG |

> 清单本体在 `shared/api-providers.json`，**前后端共用同一份数据源**，
> 后端 `server/src/providers.js` 与前端 `src/lib/ai/api-providers.ts` 都从这里读取，
> 避免出现「前端列了、后端不认识」的协议漂移。

每个能力的 API Key **独立加密存储**在后端 SQLite（`ai_key_<能力>` 键名），
Key 永不回传前端，接口只返回 `hasKey` 布尔值。

### 本地模型来源

- **默认走阿里巴巴魔搭社区（ModelScope）** `www.modelscope.cn`，国内访问更快更稳定；可在设置中切换到 HuggingFace 官方源
  （魔搭的仓库路径比 HF 多一层 `models/`，且默认分支为 `master`，已分别配置 `remoteHost` / `remotePathTemplate` / `revision`）
- **可自行选择模型**：Qwen1.5 0.5B / SmolLM2 360M / Qwen3 0.6B / Qwen2.5 0.5B / Qwen2.5 1.5B
- 切换模型时会先卸载旧模型释放内存，再按新模型重新下载
- 不同模型族使用各自的聊天模板（`src/lib/ai/local-engine.ts` 的 `applyChatTemplate`），
  换模型后提示词格式自动匹配，不会出现「模型看不懂提示词」
- **推理引擎 wasm 已本地化**：ONNX Runtime Web 的运行时（`ort-wasm-simd-threaded.jsep.wasm`，约 21MB）
  默认从 `cdn.jsdelivr.net` 拉取，而该域名在国内 TLS 握手会失败，表现为
  `no available backend found. ERR: [wasm] TypeError: Failed to fetch`——
  注意这是**推理引擎起不来**，与模型源本身无关。因此 `scripts/copy-ort-wasm.mjs`
  会在 `postinstall` 与 `build` 时自动把 wasm 复制到 `public/ort/`，
  运行时探测到本地副本后改写 `wasmPaths` 指向同源 `/ort/`，彻底不依赖境外 CDN。
  失败时若本地副本缺失会打印告警并降级回 CDN，同时设置面板会展示逐层展开的真实报错原因
  （`describeError`），可点「清缓存重试」清掉浏览器 Cache API 里的坏缓存后重试
- **三重容错**：加载前先清 `transformers-cache`；某个源失败会自动 purge 缓存并按序回退到其它源重试；
  全部失败才报错。避免一次网络抖动导致后续每次都失败

### 推理运行时：WebGPU / ONNX Runtime Web

- **WebGPU 优先**：`src/lib/ai/runtime.ts` 在加载前探测 `navigator.gpu.requestAdapter()`
  并尝试 `requestDevice()`——两步都成功才算真正可用（有 API 但拿不到适配器的情况很常见，
  比如无独显、驱动被禁用、浏览器策略限制）。设置 · AI 引擎里可选「自动 / WebGPU / WASM」，
  不可用时对应选项会被禁用并说明原因
- **dtype 与 device 配套**：WebGPU 走 **`q4f16`**（q4 量化存储 + fp16 计算），
  WASM 走 `q4`（体积小、不依赖 fp16 支持）。
  ⚠️ **WebGPU 上不要用 `fp16`** —— 会加载完整半精度权重（体积数倍于 q4），
  且部分算子在 WebGPU EP 上不受支持，表现为初始化阶段抛出**难以解读的错误**
  （底层甚至直接抛一个裸数字，如 `throw 1888206176`）。
  `q4f16` 才是 WebGPU EP 的正确选择，`DATA_TYPES` 里本就定义了这个组合
- **三级降级阶梯**：WebGPU(q4f16) → WebGPU(q4) → WASM(q4)。
  保留 GPU 内降级是因为部分显卡/驱动的 fp16 算子支持不全、纯 q4 反而能跑；
  只做「WebGPU → WASM」一级跳转会白白丢掉 GPU 加速
- **错误必须归一化**：除 `describeError` 外新增 `describeNonError`——
  Transformers.js / ONNX Runtime 有时抛出的**不是 Error 实例**而是裸数字或裸对象，
  旧实现一律返回「本地模型加载失败」，把线索全丢光，界面上只剩一个无从下手的数字
- **无需额外产物**：ONNX Runtime Web 的 wasm 有两版文件名，
  `ort-wasm-simd-threaded.wasm` 是纯 CPU 版，
  **`ort-wasm-simd-threaded.jsep.wasm` 的 JSEP（JavaScript Execution Provider）才是内含
  WebGPU/WebNN 执行后端的那份**。`@huggingface/transformers` 默认引用的正是 .jsep 版，
  也就是说 WebGPU 能力本来就在本地产物里，缺的只是告诉它 `device: 'webgpu'`
- **自动降级**：WebGPU 在真实设备上翻车率不低（驱动异常、显存不足、算子不支持），
  因此加载时若 GPU 路径失败会自动 purge 缓存并退回 WASM 重试，
  设置面板会如实显示「WebGPU 初始化失败，已自动回退到 WASM」

### AI 编排：LangChain.js

- `src/lib/ai/chain.ts` 用 LCEL（`RunnableLambda` + `StringOutputParser`）把
  「本地推理」与「后端转发」两条路径编排成同一条链，
  因此提示词拆分、输出清洗等行为在两条路径上完全一致
- 职责：拆分 system 提示词 → 调底层生成器 → 清洗模型输出
  （清掉 `<|im_start|>` / `<|im_end|>` / Llama `[INST]` 等模板残留与重复角色前缀）→ 解析为纯文本
- 内置 `ConversationMemory` 记忆（基于 `InMemoryChatMessageHistory`，按轮裁剪防上下文溢出），
  后续换持久化记忆只需替换实现，调用方无感
- ⚠️ **包结构坑**：`@langchain/core@1.2.x` 的**主入口是空壳**
  （dist 里是 `__exportAll({})`，运行时导不出任何符号，构建能过但运行时报
  `xxx is not a constructor`）。必须从**子路径**导入：
  `@langchain/core/runnables`、`/messages`、`/chat_history`、`/prompts`、`/output_parsers`。
  契约测试里有一条断言专门盯着这件事，防止将来有人改成主入口导入

### 主题包系统

- 以「主题包」为最小管理单元，每个主题包含：名称、亮/暗模式、主色、辅助色、卡片背景、文字色、阴影强度、壁纸资源、**品牌图标**、**卡片风格**、**导航栏风格**、**主题分类**
- 切换主题包时，**全局配色、卡片样式、导航栏样式、壁纸、品牌图标一起切换**，平滑过渡
- **圆角不绑定主题**：作为全局设置单独存放（`zj-radius`），在「设置 · 个性化」中调整，切换主题时保持不变
- 壁纸由主题包决定，支持内置纯色渐变、内置图片、用户自定义上传
- 主题配置分层存储：LocalStorage（主题包定义 + 当前 ID + 圆角）+ IndexedDB（壁纸二进制）
- 刷新页面自动恢复上次的主题包与模式
- **前端不提供主题制作界面**：图标 / 卡片 / 导航栏 / 配色 / 壁纸等定制项在外部制作的 `.theme` 包中定义，导入或从广场下载后生效
- **功能广场「主题」页只展示仓库主题包**，不重复列出内置主题（内置主题在「设置 · 个性化」中切换）
- **两种主题包形态并存**：
  - **文件夹制**（`themes/<id>/`，protocol 1/2）—— 外部制作的主形态，含 `theme.json` + `theme.css` + `assets/`
  - **单文件信封制**（`themes/<id>-<version>.theme`）—— 带完整亮/暗配色的历史形态
  - 两种形态由 `src/lib/theme/protocol.ts` 统一适配到内部主题模型
- **协议主题包自动派生暗色模式**：协议只有一套色板，宿主按亮度自动生成配套暗色配色

### 两页滚动吸附布局

| 页面 | 内容 |
|------|------|
| 第 1 页 | 用户欢迎页。上导航栏 + 居中主文案 + 登录卡片导航栏 |
| 第 2 页 | 功能卡片汇总页。上导航栏 + 公告（2 列）、功能广场、我的插件、好友、群聊、系统设置，下导航栏主行动为「启动插件」 |

- CSS `scroll-snap` 垂直吸附切换，无左侧导航栏、无顶部标签导航
- 滚动到第 2 页时自动弹出登录弹窗（浮层，不新开页面）
- 也可主动点击欢迎页内的登录卡片进行登录

### 卡片全屏展示

所有可点击卡片（功能广场、系统设置、好友、群聊、公告管理、插件）点击后
统一以**全屏覆盖层**展示，不再是小尺寸弹窗：

- 全屏铺满视口（`inset-0`），顶栏提供「返回」与「关闭」按钮，`Esc` 亦可退出
- 打开期间锁定背景滚动，切换卡片时内容区独立滚动
- 启动插件与点击「我的插件」卡片中的插件，均为全屏启动
- 插件之间互相唤起时（如番茄钟 → 音乐播放器）自动按插件路由解析，不会出现空白页

### 后端可选

- 应用默认**只启动前端**，后端不是强制运行
- 依赖后端的功能在服务离线时统一弹出提示：**【后端服务未开启，请启动后端服务后再使用该功能】**
- 纯本地功能（离线 AI、插件、备忘录、主题包、心情语录、番茄钟、本地音乐、本地 AI 工具卡片）**随时可用**
- 全局后端状态检测，每 8 秒轮询一次健康检查接口

### 统一的体验规范

- 全站**扁平卡片风格**：低对比边框、极轻阴影、大量留白，无厚重拟物阴影
- **本地模型走国内源**（阿里巴巴魔搭社区），可自行选择要下载的模型
  - 加载失败时**自动改用备用源重试**，并在界面展示**真实失败原因**（而非笼统文案）
  - 加载前自动清理浏览器 Cache API 中该模型的**坏缓存**（下载中断留下的半截文件会导致每次都失败）
  - 失败后提供「**清缓存重试**」按钮，一键清理并重新加载
- **插件包与主题包存放于后端仓库**，局域网共享；下载后缓存到本地，可离线使用
- **主题包为 .theme 打包文件**，在外部制作后导入，或从广场下载
- **API 按能力分类配置**：文本对话 / 多模态 / 图像生成 / 语音，各自由不同服务商供货
- **统一骨架屏加载器**：页面初始化、IndexedDB 读取、AI 模型加载、插件解析导入、API 请求、后端连接检测、公告列表加载、好友列表加载、聊天记录加载、主题包加载等全部异步场景复用同一套骨架屏组件，**禁止转圈 loading**
- **Framer Motion** 全页面交互动效：卡片弹出删除过渡、页面切换动画、弹窗淡入淡出、按钮 hover 微动画
- 响应式布局，完美适配 PC 端与手机移动端
- **全局隐藏右侧滚动条**：垂直方向一律不显示滚动条，横向滚动条保留
- **通知从右侧飞入**：非线性缓动飞入，3 秒后自动向右飞出；多条通知并存时向下排列
- 所有空状态与错误场景输出人性化中文文案，**不暴露底层代码报错堆栈**

---

## 技术栈

**前端**

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16 | App Router，静态预渲染 |
| React | 19 | UI 运行时 |
| TypeScript | 5.9 | 完整类型定义 |
| Tailwind CSS | v4 | CSS-first 配置，`@theme` 定义设计令牌 |
| shadcn/ui | new-york | Radix UI + CVA 组件 |
| Framer Motion | 12 | 交互动效 |
| Zustand | 5 | 全局状态管理 |
| Transformers.js | 3.x | 浏览器内本地大模型推理 |

**后端（可选）**

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 22.5 | 运行时（使用内置 `node:sqlite`） |
| Express | 4 | REST API |
| ws | 8 | WebSocket 实时通信 |
| node:sqlite | 内置 | 文件数据库，零原生编译依赖 |

---

## 快速开始

### 环境要求

- **Node.js >= 22.5.0**（`node:sqlite` 需要，`node -v` 确认）
- npm 10+
- 现代浏览器（Chrome / Edge / Firefox 最新版）

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端（必做）

```bash
npm run dev
```

打开 http://localhost:3000

> **前端可独立运行。** 不启动后端时，本地离线 AI、插件广场、主题包、备忘录等纯本地功能全部可用；好友、群聊、公告管理、后端转发 API 会提示后端未开启。

### 3.（可选）启动后端

```bash
npm run server
```

后端会打印本机局域网 IPv4 地址，在「系统设置 → 局域网」中填入该地址即可。

### 生产构建

```bash
npm run build     # 构建
npm run start     # 启动生产服务
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动前端开发服务器 |
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产服务器 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run server` | 启动可选后端服务 |
| `npm run server:init` | 初始化后端数据库（建表 + 种子数据） |
| `npm run plugins:build` | 打包可下载插件为 `.plugin` 文件 |
| `npm run plugins:verify` | 插件内核自检（109 + 35 项断言） |
| `npm run contract` | 前后端接口契约断言（25 项，需后端已启动） |
| `npm run e2e` | 端到端验证（56 项，需前后端已启动） |
| `npm run e2e:offline` | 后端离线场景验证（8 项） |
| `npm run e2e:pollution` | 污染数据自动恢复验证（6 项） |
| `npm run plugins:typecheck` | 插件目录独立类型校验 |

---

## 后端可选启动教程

### 什么时候需要后端

| 功能 | 是否需要后端 |
|------|-------------|
| 本地离线 AI、插件、备忘录、主题包、心情语录、番茄钟、本地音乐、本地 AI 工具卡片 | ❌ 不需要 |
| 公告查看与管理 | ✅ 需要 |
| 好友（UID 搜索、好友请求、好友列表） | ✅ 需要 |
| 群聊（创建、成员、实时消息） | ✅ 需要 |
| 后端转发外部 API 模型 | ✅ 需要 |

### 启动步骤

```bash
# 1. 首次运行需初始化数据库（建表 + 创建管理员账号 + 示例公告）
npm run server:init

# 2. 启动后端
npm run server
```

启动输出示例：

```
[智简匣] 后端服务已启动
[智简匣] 监听地址: http://0.0.0.0:8787
[智简匣] 局域网访问:
[智简匣]   - http://192.168.1.100:8787
[智简匣] WebSocket: ws://192.168.1.100:8787/ws
```

### 设备互联

1. 在**运行后端的那台设备**上执行 `npm run server`
2. 记下打印出来的局域网 IP（如 `192.168.1.100`）
3. 其它设备打开前端后，进入「系统设置 → 局域网」，填入该 IP，端口保持 `8787`
4. 同一 WiFi 下的设备即可互联，**全程不依赖公网**

> 未填写 IP 时默认使用 `localhost`，即只有本机可访问后端。

### 种子账号

`npm run server:init` 会创建一个管理员账号：

| 昵称 | UID | 密码 | 角色 |
|------|-----|------|------|
| 管理员 | `ZJ-ADMIN01` | `admin123` | admin |

普通用户通过前端「注册」创建，角色为 `user`。**只有管理员可以新增/修改/删除公告、写入后端 AI 配置。**

### 后端 API 一览

| 方法 | 路径 | 用途 | 需登录 | 需管理员 |
|------|------|------|--------|----------|
| GET | `/api/health` | 健康检查（前端轮询） | - | - |
| POST | `/api/auth/register` | 注册 | - | - |
| POST | `/api/auth/login` | 登录 | - | - |
| GET | `/api/auth/me` | 当前用户信息 | ✓ | - |
| PATCH | `/api/auth/me` | 更新资料 | ✓ | - |
| POST | `/api/auth/logout` | 登出 | ✓ | - |
| GET | `/api/notices` | 公告列表 | - | - |
| POST | `/api/notices` | 新增公告 | ✓ | ✓ |
| PUT | `/api/notices/:id` | 修改公告 | ✓ | ✓ |
| DELETE | `/api/notices/:id` | 删除公告 | ✓ | ✓ |
| GET | `/api/friends` | 好友列表 | ✓ | - |
| POST | `/api/friends/request` | 发起好友请求 | ✓ | - |
| PUT | `/api/friends/:id/accept` | 接受请求 | ✓ | - |
| PUT | `/api/friends/:id/reject` | 拒绝请求 | ✓ | - |
| DELETE | `/api/friends/:uid` | 删除好友 | ✓ | - |
| GET | `/api/groups` | 群聊列表 | ✓ | - |
| POST | `/api/groups` | 创建群聊 | ✓ | - |
| GET | `/api/groups/:groupId` | 群详情与成员 | ✓ | - |
| PUT | `/api/groups/:groupId` | 修改群名 | ✓ | - |
| DELETE | `/api/groups/:groupId` | 解散群聊 | ✓ | - |
| POST | `/api/groups/:groupId/members` | 添加成员 | ✓ | - |
| DELETE | `/api/groups/:groupId/members/:uid` | 移除成员 | ✓ | - |
| GET | `/api/messages` | 拉取聊天记录 | ✓ | - |
| GET | `/api/ai/config` | 读取后端 AI 配置（不含明文 Key） | ✓ | - |
| PUT | `/api/ai/config` | 保存后端 AI 配置 | ✓ | ✓ |
| POST | `/api/ai/chat` | 转发外部模型请求 | ✓ | - |

### 接口契约约定（重要）

后端对**单条资源**统一使用「包装结构」返回，对**列表**使用 `{ xxx: [] }` 返回：

| 接口 | 返回结构 |
|------|----------|
| `POST /api/auth/register` · `login` | `{ token, user }` |
| `GET` · `PATCH /api/auth/me` | `{ user }` |
| `GET /api/notices` | `{ notices: [] }` |
| `POST` · `PUT /api/notices` | `{ notice }` |
| `GET /api/friends` | `{ friends: [], incoming: [], outgoing: [] }` |
| `GET /api/groups` | `{ groups: [] }` |
| `POST` · `GET /api/groups/:groupId` | `{ group }` / `{ group, members }` |
| `GET /api/messages` | `{ messages: [] }` |
| `GET` · `PUT /api/ai/config` | `{ base, model, timeout, temperature, hasKey }` |
| `POST /api/ai/chat` | `{ content, model, usage, finishReason }` |

> ⚠️ **字段名差异**：后端 AI 配置的地址字段名为 `base`（会自动补全为 `.../chat/completions`），
> 前端领域模型统一为 `apiUrl`，转换在 `src/lib/backend/api.ts` 中完成。

**前端适配层**：`src/lib/backend/api.ts` 负责把上述包装结构解包成前端领域模型，
调用方（store / 组件）拿到的永远是扁平的 `UserProfile` / `Notice` / `Group` / `Friend`。

```bash
npm run contract   # 断言前后端契约一致（25 项）
```

修改任何一侧的返回结构，都必须同步另一侧并跑 `npm run contract`。

### WebSocket 协议

连接地址：`ws://<lan-ip>:8787/ws?token=<token>&uid=<uid>`

**服务端推送**

```jsonc
{ "type": "presence", "online": ["ZJ-xxx", "ZJ-yyy"] }   // 在线用户列表
{ "type": "message", "payload": { "scope": "group", "target": "G-xxx", "senderUid": "ZJ-xxx", "body": "你好", "createdAt": 1730000000000 } }
{ "type": "friend_request", "payload": { "uid": "ZJ-xxx" } }
{ "type": "system", "text": "提示文案" }
```

**客户端上行**

```jsonc
{ "type": "message", "scope": "group", "target": "G-xxx", "body": "你好" }
{ "type": "typing", "target": "G-xxx" }
{ "type": "ping" }   // 服务端回 { "type": "pong" }
```

消息**先落库再广播**，同一局域网所有设备消息同步。

---

## 项目目录

```
zhijianxia/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # 根布局 + 壁纸层
│   │   ├── page.tsx                # 首页（AppShell + Providers）
│   │   └── globals.css             # Tailwind v4 + 设计令牌 + 主题变量
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn/ui 组件（扁平风格）
│   │   │   ├── skeleton.tsx        # ⭐ 全局统一骨架屏组件族
│   │   │   ├── card.tsx  button.tsx  dialog.tsx  input.tsx
│   │   │   ├── textarea.tsx  badge.tsx  select.tsx  tabs.tsx
│   │   │   ├── switch.tsx  slider.tsx  label.tsx  progress.tsx
│   │   │   ├── avatar.tsx  separator.tsx  tooltip.tsx
│   │   │   ├── popover.tsx  dropdown-menu.tsx
│   │   ├── layout/
│   │   │   ├── app-shell.tsx       # ⭐ 两页滚动吸附主布局
│   │   │   ├── top-bar.tsx         # ⭐ 上导航栏
│   │   │   ├── status-bar.tsx      # ⭐ 下导航栏
│   │   │   └── toast.tsx           # 全局轻提示
│   │   ├── pages/
│   │   │   ├── welcome-page.tsx    # 第 1 页：欢迎页
│   │   │   └── dashboard-page.tsx  # 第 2 页：功能汇总页
│   │   ├── cards/
│   │   │   ├── announcements-card.tsx  # 公告卡片（含管理员编辑）
│   │   │   ├── api-capability-settings.tsx # ⭐ API 分能力配置面板
│   │   │   ├── marketplace-card.tsx    # 功能广场卡片
│   │   │   ├── installed-plugins-card.tsx # ⭐ 我的插件卡片（点击全屏启动）
│   │   │   ├── plugin-host.tsx         # 插件宿主（注入 ctx）
│   │   │   ├── marketplace-panel.tsx   # 功能广场
│   │   │   ├── settings-panel.tsx      # 系统设置
│   │   │   ├── friends-panel.tsx       # 好友
│   │   │   └── groups-panel.tsx        # 群聊
│   │   ├── modals/
│   │   │   ├── login-dialog.tsx    # 登录弹窗（浮层）
│   │   │   ├── card-dialog.tsx     # 卡片全屏宿主
│   │   │   ├── fullscreen-card.tsx # ⭐ 全屏卡片覆盖层（返回 / 关闭 / Esc）
│   │   │   └── backend-gate.tsx    # ⭐ 后端未开启提示网关
│   │   └── providers.tsx           # 全局 Provider（启动/轮询/WebSocket）
│   │
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── local-engine.ts      # 本地推理引擎（魔搭社区 + 多模型模板）
│   │   │   ├── local-models.ts      # ⭐ 本地模型清单与下载源
│   │   │   ├── runtime.ts           # ⭐ 推理运行时探测（WebGPU / WASM）
│   │   │   ├── chain.ts             # ⭐ LangChain LCEL 编排层（须用子路径导入）
│   │   │   ├── api-providers.ts     # ⭐ API 服务商清单读取器
│   │   │   └── scheduler.ts         # 统一 AI 调度层
│   │   ├── backend/
│   │   │   ├── client.ts           # 后端请求封装 + 健康检查
│   │   │   ├── api.ts              # 全部 API 方法
│   │   │   ├── registry.ts         # ⭐ 插件包/主题包仓库客户端
│   │   │   └── socket.ts           # WebSocket 客户端
│   │   ├── storage/idb.ts          # IndexedDB 封装
│   │   ├── theme/
│   │   │   ├── types.ts            # 主题包类型与内置预设
│   │   │   ├── packager.ts         # ⭐ .theme 包格式（导入/导出/校验）
│   │   │   ├── protocol.ts         # ⭐ 文件夹制主题包适配（色板→亮暗 / CSS 变量 / 资源 URL）
│   │   │   ├── density.ts          # 界面密度（小/中/大）
│   │   │   └── radius.ts           # 全局圆角（不绑定主题）
│   │   ├── registry-cache.ts       # ⭐ 仓库内容的本地缓存（离线可用）
│   │   └── utils.ts
│   │
│   ├── plugins/                    # ⭐ 插件内核
│   │   ├── types.ts                # 核心类型契约
│   │   ├── context.ts              # PluginContext 工厂
│   │   ├── registry.ts             # 注册表（热插拔）
│   │   ├── loader.ts               # 动态加载器
│   │   ├── packager.ts             # .plugin 打包 / 导入导出
│   │   ├── marketplace.ts          # 广场清单
│   │   ├── hooks.ts                # 插件通用 Hooks
│   │   ├── utils.ts
│   │   ├── index.ts                # 内核统一入口
│   │   ├── TEMPLATE.tsx            # ⭐ 插件开发模板
│   │   ├── builtin/                # 5 个预装插件
│   │   │   ├── weather-card.tsx        # AI 智能天气随行
│   │   │   ├── copywriting-card.tsx    # AI 极简文案助手
│   │   │   ├── memo-card.tsx           # 本地待办备忘录
│   │   │   └── quote-card.tsx          # 每日 AI 心情语录
│   │   └── downloadable/           # 6 个广场可下载插件
│   │       ├── pomodoro.tsx           # 番茄专注计时器
│   │       ├── music-player.tsx       # 极简随身音乐播放器
│   │       ├── text-summary.tsx       # AI 文本摘要摘录
│   │       ├── recipe-assistant.tsx   # AI 简易食谱助手
│   │       ├── unit-converter.tsx     # 单位换算小工具
│   │       └── vocabulary.tsx         # AI 生词本
│   │
│   └── store/                      # ⭐ Zustand 全局状态
│       ├── app-store.ts            # 后端连接、局域网/API 配置、公告、好友、群聊
│       ├── auth-store.ts           # 登录态、用户资料、角色
│       ├── theme-store.ts          # 主题包系统
│       └── plugin-store.ts         # 插件安装状态、内核桥接
│
├── server/                         # ⭐ 可选后端
│   ├── package.json
│   ├── packages/                  # ⭐ 包仓库（文件系统即仓库）
│   │   ├── plugins/               #   *.plugin 插件包
│   │   └── themes/                #   *.theme 主题包
│   └── src/
│       ├── index.js                # Express + ws 启动
│       ├── db.js                   # node:sqlite 封装
│       ├── init-db.js              # 建表 + 种子数据（包种子写入 server/packages/）
│       ├── packages.js             # 包仓库的文件存储层
│       ├── auth.js                 # 会话 token
│       ├── routes/                 # auth / notices / friends / groups / messages / ai-proxy / registry
│       └── ws/hub.js               # WebSocket 连接管理
│
├── scripts/
│   ├── build-plugins.mjs           # 插件打包→ dist-plugins/
│   ├── copy-ort-wasm.mjs           # ONNX wasm → public/ort/（postinstall/build 自动执行）
│   ├── verify-plugins.mjs          # 插件自检
│   └── verify-kernel.mjs
│
├── shared/
│   └── api-providers.json          # ⭐ API 服务商清单（前后端共用数据源）
├── .gitignore
├── components.json                 # shadcn/ui 配置
├── next.config.ts
├── postcss.config.mjs
├── tailwind.config.ts              # Tailwind v4 CSS-first 配置
└── tsconfig.json
```

### 数据分层

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| 公告、好友、UID、群聊、聊天记录 | 后端 SQLite | 仅在后端启动并连接时写入 |
| 后端转发 API Key | 后端 SQLite（aes-256-gcm 加密） | 绝不回传前端 |
| 主题包定义、当前主题 ID | 前端 LocalStorage | 刷新自动恢复 |
| 壁纸二进制 | 前端 IndexedDB | 分层存储 |
| 插件安装状态、插件配置 | 前端 IndexedDB | 随插件包导入导出 |
| 备忘录、摘要历史、生词本 | 插件私有命名空间（LocalStorage） | 插件之间互不干扰 |
| 登录令牌、用户资料 | 前端 LocalStorage | 局域网内身份标识 |

---

## 核心架构

### 1. 前后端解耦

```
┌──────────────────────────────────────────────┐
│  浏览器（前端，可独立运行）                    │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ 插件内核  │←→│ AI 调度层 │←→│ 本地模型    │  │
│  │ (热插拔)  │  │ (双通道)  │  │Transformers│  │
│  └──────────┘  └────┬─────┘  └────────────┘  │
│                    │ 后端转发时              │
└────────────────────┼─────────────────────────┘
                     │ HTTP / WebSocket
┌────────────────────┼─────────────────────────┐
│  局域网（后端，可选启动）                       │
│         Express + ws + node:sqlite            │
└──────────────────────────────────────────────┘
```

### 2. 插件内核

插件通过 `PluginContext` 访问全局能力，**不直接 import 全局 store**：

```ts
interface PluginContext {
  ai: PluginAI;              // 统一 AI 调度（本地 / 后端自动判断）
  storage: PluginStorage;    // 插件私有 KV（命名空间隔离）
  theme: PluginThemeState;   // 主题只读快照 + subscribe
  backendOnline: boolean;    // 后端在线状态
  notify(message, type?): void;
  requireBackend(): void;    // 依赖后端时调用，内核负责弹提示
  openCard(id): void;        // 打开其它卡片
  setMode(mode): void;       // 主题写入口
  setAccent(hex): void;      // 主题写入口
  applyThemePack(id): void;  // 主题写入口
}
```

### 3. `.plugin` 包格式

```jsonc
{
  "format": "zhijianxia.plugin",
  "formatVersion": 1,
  "manifest": {
    "id": "my-plugin",       // kebab-case，全局唯一
    "name": "我的插件",
    "version": "1.0.0",      // semver
    "description": "…",
    "category": "效率",
    "minCoreVersion": "1.0.0"
  },
  "core": { "minVersion": "1.0.0" },
  "entry": { "kind": "esm", "source": "…" }   // 可选：内联代码入口
}
```

导入校验顺序：JSON 合法性 → 格式标识 → `manifest.id` 命名 → semver → 必填字段 → 内核版本兼容性。任一不通过则**拒绝加载并给出中文提示**，不污染注册表。

### 4. 全局状态管理（Zustand）

| Store | 负责 |
|-------|------|
| `app-store` | 后端连接状态、局域网配置、API 配置、公告列表、好友、群聊、UI 卡片状态、通知 |
| `auth-store` | 登录态、用户资料、管理员/普通用户角色、登录弹窗状态 |
| `theme-store` | 主题包列表、当前主题包 ID、亮暗模式、壁纸 |
| `plugin-store` | 插件安装状态、内核实例、导入导出、插件上下文创建 |

---

## 插件开发模板

完整模板见 **`src/plugins/TEMPLATE.tsx`**。

### 快速开始

```bash
# 1. 复制模板
cp src/plugins/TEMPLATE.tsx src/plugins/downloadable/my-plugin.tsx

# 2. 编辑 manifest 与组件

# 3. 登记到 downloadable/index.ts

# 4. 打包
npm run plugins:build
```

### 骨架代码

```tsx
'use client';

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAiTask } from '../hooks';
import { runAi } from '../utils';
import type { PluginComponentProps, PluginManifest } from '../types';

export const manifest: PluginManifest = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '一句话说明',
  category: '效率',
  builtin: false,
  offline: true,
};

export function MyPlugin({ ctx }: PluginComponentProps) {
  const task = useAiTask();

  const run = useCallback(
    () =>
      task.run(() =>
        runAi(ctx, { system: '你是一个助手。', user: '你好', maxTokens: 200 }),
      ),
    [ctx, task],
  );

  return (
    <div className="space-y-3">
      <Button onClick={() => void run()}>开始</Button>

      {/* ✅ 骨架屏，禁止转圈 loading */}
      {task.loading && <Skeleton className="h-3 w-full" />}

      {task.result && <p className="text-xs">{task.result}</p>}
    </div>
  );
}

export default MyPlugin;
```

### 插件开发守则

1. **不得**直接 import 全局 zustand store —— 一切能力通过 `ctx`
2. **不得**修改全局主题配色或壁纸 —— 除非是主题中心类插件且走 `ctx` 写入口
3. 所有异步加载场景**必须**使用 `@/components/ui/skeleton` 的骨架屏
4. 插件存储使用 `ctx.storage`，**禁止**直接读写 `localStorage`
5. 插件 UI 保持扁平卡片风格，注释使用中文
6. 插件 id 必须 kebab-case 且全局唯一

---

## 第三方插件开发（免构建）

上面那套是**在本仓库内**开发插件的方式（能用 `@/` 路径别名、能写 TSX）。
如果你想写一个**独立于本仓库**、分发给所有人的插件，用下面这套 ——
思路与主题包完全一致：**宿主提供能力与协议，创作者只声明用法**。

### 一条命令起步

```bash
npm run plugin:new -- my-plugin "我的插件"
```

产物在 `my-plugins/my-plugin/`：

| 文件 | 作用 |
| --- | --- |
| `plugin.js` | 你的全部源码 |
| `build.mjs` | 打包成 `.plugin` |
| `README.md` | 给自己的说明 |

改完 `plugin.js` 后：

```bash
node build.mjs
```

然后在智简匣里「功能广场 → 导入插件」选中生成的 `.plugin` 即可。

### 为什么不需要打包工具

插件代码以 `Blob URL + 动态 import()` 执行，这类模块**无法解析裸导入**
（`import { useState } from 'react'` 必然失败）。宿主因此提前把 React 与
UI 组件挂到 `globalThis.ZJ`，并在加载时于源码首部注入一段 shim，
让 `import ... from '@zhijianxia/runtime'` 兑现为对全局 SDK 的解构。

```js
// 插件源码照常写 ESM 导入，但不需要任何构建
import { useState, Button, runAi } from '@zhijianxia/runtime';
```

### 可用能力

| 类别 | 名称 |
| --- | --- |
| React | `useState` `useEffect` `useMemo` `useCallback` `useRef` `Fragment` `memo` |
| JSX | `h`（`createElement` 别名） |
| 插件 hooks | `useAiTask` `useStoredState` `useInterval` `usePluginTheme` |
| AI | `runAi`（一次性）/ `runAiStream`（流式） |
| UI 组件 | `Card` `Button` `Input` `Textarea` `Badge` `Progress` `Skeleton` `Tabs` `Dialog` `Select` 等 |
| 图标 | `icon.Sparkles`（lucide 全量，约 4900 个） |
| 设计变量 | `tokens.accent` `tokens.fg` `tokens.card` `tokens.border` … |
| 工具 | `cx` `isBlank` `formatRelativeTime` |

### 完整示例

```js
export const manifest = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '一句话说明',
  category: '效率',
  icon: 'Sparkles',
};

function MyPlugin({ ctx }) {
  const [text, setText] = useState('');
  const task = useAiTask();

  const ask = async () => {
    await task.run(() => runAi(ctx, { user: text || '打个招呼', maxTokens: 80 }));
  };

  return h(
    Card,
    { className: 'gap-3' },
    h(Textarea, { value: text, onChange: (e) => setText(e.target.value), rows: 3 }),
    h(Button, { onClick: ask, disabled: task.loading || !ctx.ai.available },
      task.loading ? '生成中…' : '发送'),
    // AI 不可用时给出可执行提示（模型未加载 / 未登录 / 后端未启动）
    !ctx.ai.available &&
      h('p', { className: 'text-xs text-[var(--zj-danger)]' }, ctx.ai.unavailableReason),
    task.error && h('p', { className: 'text-xs text-[var(--zj-danger)]' }, task.error),
    task.result && h('p', { className: 'text-sm' }, task.result),
  );
}

export const Component = MyPlugin;
export default { manifest, Component };
```

完整文档见 **[docs/PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md)**。

---

## Git 与 GitHub

### 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新增功能 | `feat: 添加好友卡片与 UID 搜索` |
| `fix` | 修复 bug | `fix: 修复公告列表骨架屏不消失的问题` |
| `style` | 样式调整 | `style: 统一卡片圆角为 16px` |
| `docs` | 文档更新 | `docs: 补充插件开发模板说明` |
| `refactor` | 重构代码 | `refactor: 拆分 auth-store 与 app-store` |

### 日常流程

```bash
git add .
git commit -m "feat: 实现功能广场插件搜索与分类筛选"
git push origin main
```

### .gitignore 覆盖范围

`node_modules/`、`.next/`、`out/`、`build/`、`dist/`、`.env*`、`server/data/`、`*.db`、`*.log`、`dist-plugins/`、`src/plugins/generated/`、`.vscode/`、`.idea/`、`*.tsbuildinfo`、`coverage/`、`.DS_Store`、`Thumbs.db`

### 远程仓库初始化

```bash
git init
git remote add origin https://github.com/<你的用户名>/zhijianxia.git
git add .
git commit -m "feat: 智简匣 v1.0.0 初始版本"
git branch -M main
git push -u origin main
```

---

## 常见问题

**Q：前端不启动后端能用吗？**

能。智简匣默认只启动前端。离线 AI、插件广场、主题包、备忘录等纯本地功能全部可用；只有好友、群聊、公告管理与后端转发 API 会提示后端未开启。

**Q：本地 AI 模型怎么下载？**

首次调用 AI 能力时会自动从 Hugging Face 下载 `Xenova/Qwen1.5-0.5B-Chat`（约 400MB，量化版），之后浏览器缓存即可离线使用。也可以在「系统设置 → AI 引擎」中点击「预热本地模型」提前下载。**首次下载需要网络，下载完成后完全离线。**

**Q：局域网内其它设备访问不了后端？**

1. 确认后端启动日志里的 IP 是你当前 WiFi 网段的地址
2. 其它设备的「系统设置 → 局域网」填入该 IP 与端口 8787
3. 检查防火墙是否放行了 8787 端口（Windows 首次运行 Node 时会弹窗询问，需勾选「专用网络」允许）
4. 确认设备与后端设备在同一 WiFi 下

**Q：公告只有管理员能改，怎么切换成管理员？**

使用种子账号登录：昵称 `管理员`、密码 `admin123`、UID `ZJ-ADMIN01`。或直接修改数据库 `server/data/zhijianxia.db` 中 `users` 表的 `role` 字段为 `admin`。

**Q：导入的插件提示「不兼容当前内核」？**

`.plugin` 包的 `core.minVersion` 高于当前内核版本 `1.0.0`。用 `npm run plugins:build` 重新打包可解决。

**Q：插件怎么分享给别人？**

在功能广场点击已安装插件的「导出」，会下载一个 `.plugin` 文件。对方在功能广场点「导入插件」选择该文件即可。导入时会自动校验版本与兼容性。

**Q：如何清空所有本地数据？**

「系统设置 → 通用」中提供「清空本地缓存」「重置主题包」「清除本地 IndexedDB 数据」三个独立操作。

---

## 许可证

MIT License

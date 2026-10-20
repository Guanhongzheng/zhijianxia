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

### 主题包系统

- 以「主题包」为最小管理单元，每个主题包含：名称、亮/暗模式、主色、辅助色、卡片背景、文字色、圆角规则、阴影强度、壁纸资源
- 切换主题包时，**全局配色、卡片样式、壁纸一起切换**，平滑过渡
- 壁纸由主题包决定，支持内置纯色渐变、内置图片、用户自定义上传
- 主题配置分层存储：LocalStorage（主题包定义 + 当前 ID）+ IndexedDB（壁纸二进制）
- 刷新页面自动恢复上次的主题包与模式

### 两页滚动吸附布局

| 页面 | 内容 |
|------|------|
| 第 1 页 | 用户欢迎页。未登录时**直接在此页展示登录卡片入口**，不单独跳转登录页 |
| 第 2 页 | 功能卡片汇总页。公告、插件、好友、群聊、广场、设置全部整合为卡片组 |

- CSS `scroll-snap` 垂直吸附切换，无左侧导航栏、无顶部标签导航
- 滚动到第 2 页时自动弹出登录弹窗（浮层，不新开页面）
- 也可主动点击欢迎页内的登录卡片进行登录

### 后端可选

- 应用默认**只启动前端**，后端不是强制运行
- 依赖后端的功能在服务离线时统一弹出提示：**【后端服务未开启，请启动后端服务后再使用该功能】**
- 纯本地功能（离线 AI、插件、备忘录、主题包、心情语录、番茄钟、本地音乐、本地 AI 工具卡片）**随时可用**
- 全局后端状态检测，每 8 秒轮询一次健康检查接口

### 统一的体验规范

- 全站**扁平卡片风格**：低对比边框、极轻阴影、大量留白，无厚重拟物阴影
- **统一骨架屏加载器**：页面初始化、IndexedDB 读取、AI 模型加载、插件解析导入、API 请求、后端连接检测、公告列表加载、好友列表加载、聊天记录加载、主题包加载等全部异步场景复用同一套骨架屏组件，**禁止转圈 loading**
- **Framer Motion** 全页面交互动效：卡片弹出删除过渡、页面切换动画、弹窗淡入淡出、按钮 hover 微动画
- 响应式布局，完美适配 PC 端与手机移动端
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
│   │   │   ├── group-section.tsx   # 卡片分组容器
│   │   │   └── toast.tsx           # 全局轻提示
│   │   ├── pages/
│   │   │   ├── welcome-page.tsx    # 第 1 页：欢迎页
│   │   │   └── dashboard-page.tsx  # 第 2 页：功能汇总页
│   │   ├── cards/
│   │   │   ├── announcements-card.tsx  # 公告卡片（含管理员编辑）
│   │   │   ├── plugin-card-grid.tsx    # 插件卡片网格
│   │   │   ├── plugin-host.tsx         # 插件宿主（注入 ctx）
│   │   │   ├── marketplace-panel.tsx   # 功能广场
│   │   │   ├── settings-panel.tsx      # 系统设置
│   │   │   ├── friends-panel.tsx       # 好友
│   │   │   └── groups-panel.tsx        # 群聊
│   │   ├── modals/
│   │   │   ├── login-dialog.tsx    # 登录弹窗（浮层）
│   │   │   ├── card-dialog.tsx     # 卡片弹窗宿主
│   │   │   └── backend-gate.tsx    # ⭐ 后端未开启提示网关
│   │   └── providers.tsx           # 全局 Provider（启动/轮询/WebSocket）
│   │
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── local-engine.ts     # Transformers.js 本地推理
│   │   │   └── scheduler.ts        # ⭐ 统一 AI 调度层
│   │   ├── backend/
│   │   │   ├── client.ts           # 后端请求封装 + 健康检查
│   │   │   ├── api.ts              # 全部 API 方法
│   │   │   └── socket.ts           # WebSocket 客户端
│   │   ├── storage/idb.ts          # IndexedDB 封装
│   │   ├── theme/types.ts          # 主题包定义 + 内置预设
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
│   │   │   ├── quote-card.tsx          # 每日 AI 心情语录
│   │   │   └── theme-center-card.tsx   # 全局主题中心
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
│   └── src/
│       ├── index.js                # Express + ws 启动
│       ├── db.js                   # node:sqlite 封装
│       ├── init-db.js              # 建表 + 种子数据
│       ├── auth.js                 # 会话 token
│       ├── routes/                 # auth / notices / friends / groups / messages / ai-proxy
│       └── ws/hub.js               # WebSocket 连接管理
│
├── scripts/
│   ├── build-plugins.mjs           # 插件打包 → dist-plugins/
│   ├── verify-plugins.mjs          # 插件自检
│   └── verify-kernel.mjs
│
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

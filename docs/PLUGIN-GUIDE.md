# 智简匣 · 第三方插件开发指南

面向**不使用本仓库代码**的独立开发者：写一个插件，打包成 `.plugin`，
用户在智简匣里导入即可使用。全程不需要 `npm install`，不需要打包工具。

> 这套思路与**主题包**完全一致：宿主提供能力与协议，创作者只声明用法。
> 区别在于主题包是纯数据（JSON + CSS + 资源），插件含可执行逻辑，
> 因此额外提供了一套运行时 SDK。

---

## 目录

- [30 秒上手](#30-秒上手)
- [为什么不需要打包工具](#为什么不需要打包工具)
- [运行时 API](#运行时-api)
- [插件上下文 ctx](#插件上下文-ctx)
- [调用 AI](#调用-ai)
- [本地存储](#本地存储)
- [跟随主题](#跟随主题)
- [插件包格式](#插件包格式)
- [上架到功能广场](#上架到功能广场)
- [开发守则](#开发守则)
- [常见问题](#常见问题)

---

## 30 秒上手

### 1. 生成工程

在智简匣仓库里执行（或直接手写 `plugin.js` 也行）：

```bash
npm run plugin:new -- my-plugin "我的插件"
```

产物目录：

```
my-plugins/my-plugin/
├── plugin.js      ← 你的全部源码
├── build.mjs      ← 打包脚本
├── package.json
└── README.md
```

### 2. 写代码

编辑 `plugin.js`：

```js
export const manifest = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  description: '一句话说明这个插件做什么',
  category: '效率',
  author: '你的名字',
  icon: 'Sparkles',
  preview: '✨',
  tags: ['标签'],
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

function MyPlugin({ ctx }) {
  const [text, setText] = useState('');
  const task = useAiTask();

  const ask = async () => {
    await task.run(() => runAi(ctx, { user: text || '打个招呼', maxTokens: 120 }));
  };

  return h(
    Card,
    { className: 'gap-3' },
    h(CardTitle, null, '✨ 我的插件'),
    h(Textarea, { value: text, onChange: (e) => setText(e.target.value), rows: 3 }),
    h(Button, { onClick: ask, disabled: task.loading }, task.loading ? '生成中…' : '发送'),
    task.result && h('p', { className: 'text-sm' }, task.result),
  );
}

export const Component = MyPlugin;
export default { manifest, Component };
```

### 3. 打包

```bash
cd my-plugins/my-plugin
node build.mjs
```

生成 `my-plugin-1.0.0.plugin`。

### 4. 导入使用

智简匣 →「功能广场」→「导入插件」→ 选中该文件。

---

## 为什么不需要打包工具

插件代码以 `Blob URL + 动态 import()` 的方式执行。这类模块有一个硬限制：

```js
// ❌ 必然失败：浏览器不知道 'react' 指向哪个文件
import { useState } from 'react';
```

宿主的做法是**提前把依赖挂到全局**，并在加载插件时于源码首部注入一段 shim：

```js
// 注入的 shim（简化）
var __zj_sdk = globalThis.ZJ;
var { useState, Button, runAi, /* …约 60 项 */ } = __zj_sdk;
```

于是你可以写正常的 ESM 导入语法（`@zhijianxia/runtime` 是虚拟模块名，
由 shim 兑现），却不需要任何构建步骤：

```js
import { useState, Button, runAi } from '@zhijianxia/runtime';
```

也可以直接用 `globalThis.ZJ`，或用 `h(...)` 免 JSX 调用。

> **安全边界**：这是本地优先应用，插件代码本就在用户自己的浏览器里
> 以完全信任的方式执行（同 Electron preload 权限模型）。运行时**不做沙箱**——
> 那属于伪安全（拦得住 `import`，拦不住 `fetch`）。真正的约束在导入时的包校验：
> manifest 合法性、semver、内核兼容性、入口类型。

---

## 运行时 API

宿主注入的全部能力（`globalThis.ZJ`）：

| 类别 | 可用名称 |
| --- | --- |
| **React** | `useState` `useEffect` `useMemo` `useCallback` `useRef` `useReducer` `useContext` `createContext` `useLayoutEffect` `useId` `memo` `Fragment` |
| **JSX** | `h`（`createElement` 的别名） |
| **插件 hooks** | `useAiTask` `useStoredState` `useInterval` `usePluginTheme` |
| **AI** | `runAi` `runAiStream` |
| **UI 组件** | `Card` `CardHeader` `CardTitle` `CardContent` `Button` `Input` `Textarea` `Badge` `Switch` `Slider` `Progress` `Label` `Separator` `Skeleton` `Tabs*` `Dialog*` `DropdownMenu*` `Select*` `Tooltip*` |
| **图标** | `icon.Sparkles`（lucide 全量，约 4900 个） |
| **设计变量** | `tokens.accent` `tokens.fg` `tokens.card` `tokens.border` … |
| **工具** | `cx`（className 合并） `isBlank` `formatRelativeTime` |
| **元信息** | `coreVersion`（内核版本，用于特性检测） |

### 关于 JSX

想用 JSX 就在文件头加 pragma，编译器会自动读全局设置：

```js
/** @jsxImportSource global-zj */
```

或者干脆用 `h(...)` —— 本项目内置插件之外的第三方插件通常都这么写，
因为免构建场景下 JSX 需要额外的转译步骤。

### 设计变量

**务必**用 `tokens.*` 里的 CSS 变量，不要硬编码颜色：

```js
h('p', { style: { color: tokens['muted-fg'] } }, '次要文字');
h('p', { className: 'text-xs text-[var(--zj-danger)]' }, '错误提示');
```

这样插件会自动跟随用户的主题包变化（浅色/深色、极光/暮色/深海…）。

---

## 插件上下文 ctx

内核只传一个 prop：

```js
function MyPlugin({ ctx }) {
  ctx.ai                       // AI 能力
  ctx.storage                  // 插件私有存储（命名空间隔离）
  ctx.theme                    // 主题只读快照
  ctx.notify(msg, type)        // 全局通知：'info' | 'success' | 'error'
  ctx.openCard(id)             // 打开其它卡片
  ctx.backendOnline            // 后端是否在线
  ctx.requireBackend()         // 声明依赖后端（内核弹提示）
  ctx.setMode(mode)            // 切换明暗（仅主题类插件）
  ctx.setAccent(hex)           // 设置主色（仅主题类插件）
  ctx.applyThemePack(id)       // 套用主题包（仅主题类插件）
}
```

### ctx.ai

```js
ctx.ai.available          // 当前是否可用
ctx.ai.unavailableReason  // 不可用原因（可执行的中文，如「本地模型尚未加载，请到系统设置点击加载模型」）
ctx.ai.mode               // 'local' | 'backend'

await ctx.ai.chat({ messages: [{ role: 'user', content: '你好' }], maxTokens: 200 });

for await (const chunk of ctx.ai.streamChat({ messages: [...] })) {
  // 逐 token 增量
}
```

**用 `runAi` / `runAiStream` 更省事** —— 它们会自动检查 `available`
并在不可用时抛出可读原因：

```js
const text = await runAi(ctx, {
  system: '你是一个简洁的助手',
  user: '用一句话介绍你自己',
  maxTokens: 120,
});

// 流式
let full = '';
await runAiStream(ctx, { user: '写一首短诗' }, (chunk) => {
  full += chunk;
  render(full);   // 逐段渲染
});
```

### ctx.storage

命名空间隔离，插件之间互不干扰：

```js
ctx.storage.set('history', list);      // 物理键：zhijianxia:plugin:<id>:history
ctx.storage.get('history', []);
ctx.storage.remove('history');

// 与插件间共享（跨插件联动）
ctx.storage.set('shared:todo-count', 3);
```

### ctx.theme

```js
ctx.theme.mode       // 'light' | 'dark'
ctx.theme.accent     // '#0ea5a4'
ctx.theme.tokens     // { ring: '#...', surface: '#...' }
ctx.theme.packs      // 全部内置主题包清单
ctx.theme.packId     // 当前生效的主题包 id
```

只读。修改主题必须走 `ctx` 的写入口（见上文）。

---

## 调用 AI

插件**不需要关心**当前是本地模型还是后端转发 —— 内核会自动路由：

```js
// 简单场景
const answer = await runAi(ctx, { user: '你好' });

// 带系统提示词与参数
const summary = await runAi(ctx, {
  system: '你是专业编辑，用一句话总结用户输入的内容',
  user: longText,
  temperature: 0.4,
  maxTokens: 200,
});
```

### 完整的 AI 交互范式

`useAiTask` 帮你管理 loading / result / error 三态：

```js
function MyPlugin({ ctx }) {
  const task = useAiTask();

  const ask = async () => {
    const answer = await task.run(() =>
      runAi(ctx, { user: '你好', maxTokens: 100 }),
    );
    if (!answer) {
      // task.error 已是可读中文（模型未加载 / 未登录 / 网络不通 / Key 错误…）
      ctx.notify(task.error, 'error');
    }
  };

  return h(
    Card,
    null,
    // AI 不可用时给出可执行提示，而不是笼统的「AI 不可用」
    !ctx.ai.available && h('p', { className: 'text-xs text-[var(--zj-danger)]' }, ctx.ai.unavailableReason),
    h(Button, { onClick: ask, disabled: task.loading || !ctx.ai.available },
      task.loading ? '生成中…' : '发送'),
    task.loading && h(Skeleton, { className: 'h-3 w-full' }),
    task.error && h('p', { className: 'text-xs text-[var(--zj-danger)]' }, task.error),
    task.result && h('p', { className: 'text-sm' }, task.result),
  );
}
```

---

## 本地存储

```js
function MyPlugin({ ctx }) {
  // 自动与 ctx.storage 绑定的 state
  const [count, setCount] = useStoredState(ctx, 'count', 0);

  return h(Button, { onClick: () => setCount(count + 1) }, `点击了 ${count} 次`);
}
```

也可以用定时器 hook：

```js
useInterval(() => tick(), 1000);
```

---

## 跟随主题

```js
function ThemedCard({ ctx }) {
  return h(
    'div',
    {
      style: {
        background: tokens.card,
        color: tokens.fg,
        borderColor: tokens.border,
        borderRadius: tokens.radius,
      },
    },
    '自动跟随主题',
  );
}
```

主题变化时内核会触发插件重渲染，`ctx.theme` 的值始终是最新的。

---

## 插件包格式

`.plugin` 是 JSON：

```json
{
  "format": "zhijianxia.plugin",
  "formatVersion": 1,
  "manifest": {
    "id": "my-plugin",
    "name": "我的插件",
    "version": "1.0.0",
    "description": "一句话说明",
    "category": "效率",
    "author": "你的名字",
    "icon": "Sparkles",
    "preview": "✨",
    "tags": ["标签"],
    "minCoreVersion": "1.0.0",
    "builtin": false,
    "offline": true
  },
  "core": { "minVersion": "1.0.0" },
  "entry": {
    "kind": "esm",
    "file": "plugin.js",
    "source": "…你的代码…"
  }
}
```

### 导入时会被校验

| 校验项 | 规则 |
| --- | --- |
| `format` | 必须是 `"zhijianxia.plugin"` |
| `formatVersion` | 整数，且 ≤ 内核支持的版本 |
| `manifest.id` | kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），≤ 64 字符 |
| `manifest.version` | 语义化版本（`1.0.0`） |
| `manifest.name` / `description` | 非空字符串 |
| `minCoreVersion` | 必须 ≤ 当前内核版本，否则拒绝并提示升级 |
| `entry.kind` | `esm` / `cjs` / `url`，且提供对应的 `source` / `url` |

任何一项不通过都会给出**中文错误提示**，插件不会被加载。

### manifest 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 全局唯一，kebab-case |
| `name` | ✅ | 显示名 |
| `version` | ✅ | 语义化版本 |
| `description` | ✅ | 一句话说明 |
| `category` | | 广场分类，默认「其它」 |
| `author` | | 作者名 |
| `icon` | | lucide 图标名，默认 `Puzzle` |
| `preview` | | 缩略图标识（emoji / 色块） |
| `tags` | | 关键词，用于搜索 |
| `minCoreVersion` | | 最低内核版本 |
| `offline` | | 是否纯本地（不依赖后端） |
| `builtin` | | 预装插件才填 `true`，第三方插件留空 |

---

## 上架到功能广场

导入本地 `.plugin` 即可自己用。要分享给别人：

1. **登录**并启动后端服务
2. 功能广场 → 找到已导入的插件 →「上传到广场」
3. 其他用户即可在广场里看到并一键安装（下载后可离线使用）

管理员可在后端删除不合规的插件。

---

## 开发守则

1. **不得**直接 import 全局 zustand store —— 一切能力通过 `ctx`
2. **不得**写 `import ... from 'react'` —— 用宿主注入的运行时
3. 颜色一律用 `tokens.*` 的 CSS 变量，不要硬编码
4. 异步加载用 `Skeleton` 骨架屏，**不要**用转圈 loading
5. AI 失败时展示 `task.error`（已是可读中文），不要覆盖成「失败，请重试」
6. 插件存储用 `ctx.storage`，**禁止**直接读写 `localStorage`
7. 注释与 UI 文案使用中文
8. `id` 必须 kebab-case 且全局唯一

---

## 常见问题

### 导入后提示「未随应用打包，且包内不含可加载的代码入口」

包里缺 `entry` 字段。执行 `node build.mjs` 重新打包。

### 导入后提示「插件不兼容当前内核」

`minCoreVersion` 高于用户当前的内核版本。让用户升级智简匣，
或降低 `minCoreVersion`。

### 提示「宿主运行时未就绪（globalThis.ZJ 为空）」

用户的智简匣版本太旧，还没实现运行时 SDK。提示升级。

### 组件报「插件上下文尚未注入」

组件不是由内核渲染的（比如在包外自己 `createElement` 了）。
确认是通过 `export const Component` 导出的。

### `runAi` 抛「本地模型尚未加载」

让用户到「系统设置 → AI 引擎」点击「加载模型」。
你也可以先检查 `ctx.ai.available` 再决定是否禁用按钮。

### 能用 `ctx.storage` 存文件吗

不能，KV 存储只存 JSON 可序列化的值。文件请用浏览器自己的
IndexedDB / Cache API（插件与宿主同源，可以直接访问）。

### 怎么用 framer-motion 等第三方库

运行时**不提供**第三方库。若确实需要，请在 `plugin.js` 里用
`entry.kind: 'url'` 指向一个你自己打包好的 ESM 产物 URL，
让它从 CDN 导入依赖。
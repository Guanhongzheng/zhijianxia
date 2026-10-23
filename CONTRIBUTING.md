# 贡献指南

感谢你愿意改进智简匣。这份文档的目标是**让第一次提交就用对方式**——本项目的
测试、主题体系与卡片样式都有明确的约定，绕开它们写出来的代码会在 CI 上红，
或者更糟：静默破坏主题包兼容性。

> 仓库里没有内部交接文档（那类含本机路径与进程号的记录不入库）。踩过的坑整理在本文
> §8，够用；更细的历史原因写在提交信息里，`git log` 能查到。

---

## 1. 环境准备

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Node | **≥ 22.5** | 用到 `node:sqlite`（后端）与原生 TypeScript 类型擦除（测试） |
| npm | 随 Node | 仓库用 `package-lock.json`，请勿混用 pnpm / yarn |
| 浏览器 | Edge / Chrome 最新版 | WebGPU 推理与浏览器端验证需要 |
| 操作系统 | Windows / macOS / Linux | Windows 上有几个已知坑，见 §8 |

```bash
npm install                 # 会自动执行 postinstall，把 ORT 的 wasm 拷进 public/
npm ci --prefix server      # 后端有独立 package.json，根目录安装不会装它
npm run dev                 # 前端 http://localhost:3000
npm run server              # 后端 http://127.0.0.1:8787（可选）
```

后端是**可选件**：只用本地模型、本地主题、本地插件时，不起后端也能完整使用。
一旦涉及登录、好友、群聊、主题广场、AI 工具调用，就必须起后端。

---

## 2. 开发循环

```bash
npm run typecheck           # 改完先跑这个，通常 5–10s
npm run coverage            # 单元测试 + 覆盖率门禁
npm run contract            # 接口契约（需要后端在跑）
```

提交前至少满足：`typecheck` 0 错、`coverage` 通过、`contract` 全绿。
UI 改动请附截图——本项目的视觉回归靠人眼，没有快照测试。

---

## 3. 测试分层

| 命令 | 规模 | 依赖 | 覆盖什么 |
| --- | --- | --- | --- |
| `npm run test:unit` | 149 项 | 无 | 纯逻辑：主题搜索、GPU 预算、包校验 |
| `npm run coverage` | 同上 + 门槛 | 无 | 同上，并统计覆盖率（纯逻辑层 ≥80%） |
| `npm run contract` | 72 项 | 后端 | HTTP 接口的形状、鉴权、副作用 |
| `npm run theme:security` | 17 项 | 后端 | 主题文件读取的路径穿越防护 |
| `npm run plugins:verify` | 35 项 | 无 | 插件产物完整性、内核加载 |
| `npm run theme:search` | 38 项 | 无 | 意图搜索的排序行为（含 scheme 信号） |
| `npm run ai:budget` | 46 项 | 无 | GPU 预算与设备档位 |
| `npm run theme:pack` | 65 项 | 无 | 主题包 / 插件包校验规则 |
| `npm run e2e` | 79 项 | 前后端 + 浏览器 | 完整用户路径 |
| `npm run theme:verify` | 11 项 | 前后端 + 浏览器 | 主题广场的浏览器端行为 |

### 覆盖率的真实口径

**80% 这条线只对「纯逻辑层」成立**，范围写死在 `scripts/coverage.mjs` 的 `SCOPE`：

```
src/lib/theme/search.ts              意图搜索的解析与打分
src/lib/ai/device-profile.ts         GPU 预算计算
src/lib/ai/device-tier.ts            设备档位与推荐模型
src/lib/ai/local-models.ts           模型清单及其辅助函数
server/src/theme-store/scheme.js     亮/暗判定
server/src/routes/registry-validate.js  主题包 / 插件包校验
```

当前实测：**行 98.2% · 分支 85.8% · 函数 100%**。

为什么不把整个 `src/` 算进分母：105 个 TSX 组件只能靠浏览器端到端覆盖，把它们
计入后整体数字会掉到个位数百分比——那个数字既不能指导改进，也不能防止回归。
**宁可报一个窄而真实的口径，也不报一个宽而虚假的 80%。**

要扩大口径，正确做法是先给新模块补**纯函数测试**，再把它加进 `SCOPE`。

---

## 4. 代码规范

- **TypeScript 严格模式**（`strict: true`）。新增代码不要用 `any`；确实需要时
  写成 `unknown` + 收窄，或在注释里说明为什么无法收窄。
- **注释写「为什么」，不写「是什么」**。例如：
  ```ts
  // 系数取 50% 让主流 2 GiB 设备算出正好 1 GiB —— 已验证设备行为完全不变
  const budget = Math.min(maxBuffer, maxBinding) * 0.5;
  ```
  这类注释是本仓库最有价值的部分，请延续。
- **中文注释与中文错误提示**。错误文案会直接展示给用户，`error` 必须是可读中文。
- **不引入重型依赖**。本项目是「本地离线优先」，任何超过 100 KB 的运行时依赖
  都需要在 PR 里说明为什么不可避免（判定方式：先问这项能力属于应用层、引擎层还是内核层，
  层次判断错了，投入会全部打在别人的引擎里）。
- 文件内不要留 `console.log`；服务端日志用 `console.error` / `console.warn`。

### 卡片样式：只有一个入口

主题包靠注入 `--zj-*` 变量与 `<html data-card-*>` 工作，**它接不到手写的
Tailwind 工具类**。所以：

```tsx
// ✅ 正确
<div className="zj-card">…</div>            // 外层卡片
<div className="zj-surface">…</div>         // 内层容器
<div className="zj-card zj-card-soft">…</div> // 正文里的工具卡

// ❌ 错误（契约测试会直接判红）
<div className="rounded-md border border-[var(--zj-border)]">…</div>
```

`rounded-full` 的胶囊与圆点不受此限制。

### 给主题包新增可调项

新增一个视觉能力时，先问「主题作者需要改它吗」。需要的话，走变量或 `data-*`，
在 `src/app/globals.css` 的 `.zj-card` / `.zj-surface` 规则里消费，**不要在组件里
按主题名做分支**。

---

## 5. 常见扩展任务

### 加一个 AI 工具（对话即应用）

要改**四处**，缺一不可：

1. `shared/ai-tools.json` —— 名称、描述、JSON Schema（前后端唯一数据源）；
2. `src/lib/ai/sdk/tools.ts` —— zod schema + 规整函数 + 浏览器执行体；
3. `server/src/ai-tools.js` —— `executeTool` 里的 case（服务端独立兜底）；
4. `src/components/ai/tool-parts.tsx` —— 卡片视图 + 图标 + 字段中文名。

两条硬规则：

- **上限与校验前后端各写一份**。前端可能被绕过，服务端不能假设入参已校验过。
- **加完必须重启后端**。`ai-stream.js` 对工具清单做了模块级缓存，不重启等于没加。

### 加一个主题包

放在 `server/packages/themes/<slug>/`，至少包含 `theme.json`。亮暗基调用 `scheme`
显式声明（不声明则按 `--bg` 亮度推断，阈值 0.4 与前端一致）。写完跑
`npm run themes:check` 与 `npm run themes:verify`。

---

## 6. 提交规范

采用 Conventional Commits，scope 用模块名：

```
feat(theme): 列表通道补 scheme 字段，意图搜索改用这个结构化维度
fix(db): 修好「全新数据库无法初始化」—— friends 索引写错了列名
test(contract): 修两项测试自身缺陷 —— 环境耦合断言 + 污染本机配置
refactor(ui): 统一卡片样式入口 —— .zj-card / .zj-surface
ci: 加最小门禁，并把「隔离构建目录」变成正式能力
docs: 记下 CI 现状（全绿，约 50s）与查看入口
```

- 标题写**做了什么 + 为什么**，不写「update file」；
- 正文说明**根因**与**验证方式**（跑了哪些命令、看到什么结果）；
- 一个提交只做一件事。重构与行为变更分开，否则 review 时无法分辨风险。

---

## 7. Pull Request 流程

1. 从 `main` 拉分支：`feat/xxx`、`fix/xxx`、`docs/xxx`；
2. 本地跑通 `npm run typecheck && npm run coverage`，涉及接口再加 `npm run contract`；
3. UI 改动**附截图**（改前 / 改后）；
4. PR 描述里写：**问题是什么、为什么这样改、怎么验证的**；
5. CI 必须全绿才能合并。

PR 自查清单：

- [ ] 没有新增手写的 `border-[var(--zj-border)]` / `bg-[var(--zj-card)]`
- [ ] 新逻辑有对应单元测试，且已加进 `scripts/coverage.mjs` 的 `SCOPE`
- [ ] 改了接口 → 同步更新 `docs/openapi.json`（`npm run api:docs`）
- [ ] 改了测试计数 / 命令 → 同步更新 `CONTRIBUTING.md` 与本机交接文档（后者不入库）
- [ ] 没有把密钥、DSN、本机绝对路径写进代码或文档

> 「改了数字要跟着改文档」不是洁癖：交接文档里一个过期的计数，会让下一个会话
> 照着错误基线去查一个不存在的回归。

---

## 8. 已知坑（Windows）

| 现象 | 原因与对策 |
| --- | --- |
| `next build` 报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` | 安全删除守卫拦住了 Next 清 `.next/trace-build`。用 `rm -rf .next` 整体删，或改用 `ZJ_DIST_DIR=.next-ci npm run build` 隔离构建 |
| 构建后 `tsconfig.json` 的 `include` 变了 | `next build` 会改写它。构建完 `git checkout -- tsconfig.json` |
| 主题目录删不掉 / `unlinkDir` 延迟 | chokidar 在 Windows 上不可靠，已有 15s 对账兜底；删主题后等一轮再验证 |
| 串行跑测试时后端莫名消失 | `theme:ws` 会连带停掉后端，别把它和其它测试挤在一条命令里 |
| 沙箱里后端连不上外部 API | 代理环境变量会污染 `fetch`，用 `env -u http_proxy -u https_proxy npm run server` |
| Node 直接 import TS 报 `ERR_MODULE_NOT_FOUND` | 类型擦除不解析无扩展名的相对导入。纯逻辑模块改用 `import type`，或让调用方传入依赖 |

---

## 9. 发布

```bash
git tag v1.0.1 && git push origin v1.0.1
```

`.github/workflows/release.yml` 会跑完整验证 → 生产构建 → 打包产物 →
构建并冒烟测试容器镜像 → 创建 GitHub Release。

容器部署：

```bash
docker build -t zhijianxia .
docker run -d -p 3000:3000 -p 8787:8787 -v zhijianxia-data:/app/server/data zhijianxia
```

`/app/server/data` 必须挂卷，否则重建容器会丢掉配置、消息与主题包。
`ZJ_WITH_SERVER=0` 可只跑前端（纯本地模式）。

镜像**尚未在本地验证**（开发机 Docker daemon 未运行），首次 tag 发布会是第一次真跑。
如遇失败，优先检查 `Dockerfile` 里 `.next/standalone` 的拷贝路径。

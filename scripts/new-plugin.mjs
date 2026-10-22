#!/usr/bin/env node
/**
 * 智简匣 · 第三方插件脚手架
 *
 * 一条命令生成一个**免构建**的插件工程骨架：
 *
 *   node scripts/new-plugin.mjs my-plugin "我的插件"
 *
 * 生成的工程直接产出 `.plugin` 文件，用户在「功能广场 → 导入插件」
 * 里选中即可使用 —— 全程不需要 npm install，不需要打包工具。
 *
 * ## 为什么能做到免构建
 *
 * 插件代码以 Blob URL + 动态 import() 执行，这种模块**无法解析裸导入**：
 * `import { useState } from 'react'` 必然失败。
 *
 * 宿主因此提前把 React 与 UI 组件挂到 `globalThis.ZJ`，
 * 并在加载插件时于源码首部注入一段 shim，
 * 把 `import ... from '@zhijianxia/runtime'` 变成对 `globalThis.ZJ` 的解构。
 *
 * 于是插件源码可以正常写 ESM 导入语法，却不需要任何构建步骤。
 * 详见 src/plugins/runtime.ts 与 src/plugins/loader.ts。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** 插件源码模板 */
const PLUGIN_SOURCE = `/**
 * {{PLUGIN_NAME}}
 *
 * 这是一个免构建插件：全部能力来自宿主注入的 ZJ 运行时。
 * 修改后用「功能广场 → 导入插件」选中 .plugin 文件即可生效。
 */

// ---- 清单（必填）----
export const manifest = {
  id: '{{PLUGIN_ID}}',
  name: '{{PLUGIN_NAME}}',
  version: '1.0.0',
  description: '{{PLUGIN_DESC}}',
  category: '效率',
  author: '{{PLUGIN_AUTHOR}}',
  icon: 'Sparkles',
  preview: '✨',
  tags: ['示例'],
  // 声明最低内核版本；低于此版本的内核会拒绝导入并给出提示
  minCoreVersion: '1.0.0',
  builtin: false,
  offline: true,
};

// ---- 组件 ----
function Plugin({ ctx }) {
  // React hooks 由宿主提供，无需 import
  const [text, setText] = useState('');
  const task = useAiTask();

  /** 调用 AI：本地模型或后端转发由内核决定，插件无需关心 */
  const ask = async () => {
    const answer = await task.run(() =>
      runAi(ctx, {
        system: '你是一个简洁的助手',
        user: text || '打个招呼',
        maxTokens: 120,
      }),
    );
    if (!answer) {
      // task.error 已是可读中文（模型未加载 / 未登录 / 网络不通…）
      ctx.notify(task.error || 'AI 调用失败', 'error');
    }
  };

  return h(
    Card,
    { className: 'gap-3' },
    h(CardHeader, null, h(CardTitle, null, '✨ {{PLUGIN_NAME}}')),
    h(
      CardContent,
      { className: 'space-y-3' },
      h(
        Textarea,
        {
          value: text,
          onChange: (e) => setText(e.target.value),
          placeholder: '想问点什么…',
          rows: 3,
        },
      ),
      h(
        Button,
        { onClick: ask, disabled: task.loading || !ctx.ai.available },
        task.loading ? '生成中…' : '发送',
      ),
      // AI 不可用时给出可执行提示（而不是笼统的「AI 不可用」）
      !ctx.ai.available
        ? h('p', { className: 'text-xs text-[var(--zj-danger)]' }, ctx.ai.unavailableReason)
        : null,
      task.result
        ? h('p', { className: 'whitespace-pre-wrap text-sm' }, task.result)
        : null,
      task.error
        ? h('p', { className: 'text-xs text-[var(--zj-danger)]' }, task.error)
        : null,
    ),
  );
}

export const Component = Plugin;
export default { manifest, Component };
`;

/** 包封装脚本模板 */
const BUILD_SOURCE = `/**
 * 把 plugin.js 打包成 {{PLUGIN_ID}}-1.0.0.plugin
 *
 * 用法：node build.mjs
 *
 * 之所以不需要任何打包工具：插件代码里 import 的 '@zhijianxia/runtime'
 * 由宿主在加载时注入 shim 解析（见 src/plugins/loader.ts）。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, 'plugin.js'), 'utf8');

const pkg = {
  format: 'zhijianxia.plugin',
  formatVersion: 1,
  manifest: {
    id: '{{PLUGIN_ID}}',
    name: '{{PLUGIN_NAME}}',
    version: '1.0.0',
    description: '{{PLUGIN_DESC}}',
    category: '效率',
    author: '{{PLUGIN_AUTHOR}}',
    icon: 'Sparkles',
    preview: '✨',
    tags: ['示例'],
    minCoreVersion: '1.0.0',
    builtin: false,
    offline: true,
  },
  core: { minVersion: '1.0.0' },
  entry: { kind: 'esm', file: 'plugin.js', source },
  exportedAt: new Date().toISOString(),
};

const out = join(here, '{{PLUGIN_ID}}-1.0.0.plugin');
await writeFile(out, JSON.stringify(pkg, null, 2) + '\\n', 'utf8');
console.log('已生成：' + out);
console.log('在智简匣里打开「功能广场 → 导入插件」，选中该文件即可使用。');
`;

/** README 模板 */
const README = (id, name) => `# ${name}

一个免构建的智简匣插件。

## 使用

1. 在本目录执行打包：

   \`\`\`bash
   node build.mjs
   \`\`\`

2. 打开智简匣 →「功能广场」→「导入插件」，选中生成的
   \`${id}-1.0.0.plugin\`。

## 开发

\`plugin.js\` 就是全部源码。改完重新执行 \`node build.mjs\` 即可。

### 能用什么

所有能力都从宿主运行时取，**不要写 \`import ... from 'react'\`**：

| 类别 | 可用名称 |
| --- | --- |
| React | \`useState\` \`useEffect\` \`useMemo\` \`useCallback\` \`useRef\` \`Fragment\` \`memo\` |
| JSX | \`h\`（不用写 JSX 时用它创建元素） |
| 插件 hooks | \`useAiTask\` \`useStoredState\` \`useInterval\` \`usePluginTheme\` |
| AI | \`runAi\` \`runAiStream\` |
| UI | \`Card\` \`Button\` \`Input\` \`Textarea\` \`Badge\` \`Progress\` \`Skeleton\` \`Tabs\` \`Dialog\` \`Select\` \`Switch\` … |
| 图标 | \`icon.Sparkles\`（lucide 全量，约 4900 个） |
| 设计变量 | \`tokens.accent\` \`tokens.fg\` \`tokens.card\` … |
| 工具 | \`cx\` \`isBlank\` \`formatRelativeTime\` |

### 组件 props

内核只传一个 \`ctx\`：

\`\`\`js
function Plugin({ ctx }) {
  ctx.ai              // AI 能力（chat / streamChat / available / unavailableReason）
  ctx.storage         // 插件私有存储（命名空间隔离）
  ctx.theme           // 主题只读快照（mode / accent / tokens / packs）
  ctx.notify(msg, type)          // 全局通知
  ctx.openCard(id)                // 打开其它卡片
  ctx.backendOnline              // 后端是否在线
  ctx.applyThemePack(id)          // 套用主题包（仅主题类插件）
}
\`\`\`

### 约定

- 用 \`tokens.*\` 里的 CSS 变量，不要硬编码颜色 —— 这样插件会跟随主题变化。
- 异步加载用 \`Skeleton\` 骨架屏，不要用转圈。
- AI 调用失败时展示 \`task.error\`（已是可读中文），不要覆盖成「失败，请重试」。
`;

async function main() {
  const [id, name] = process.argv.slice(2);

  if (!id || !name) {
    console.error('用法：node scripts/new-plugin.mjs <plugin-id> "<插件名称>"');
    console.error('示例：node scripts/new-plugin.mjs my-plugin "我的插件"');
    process.exit(1);
  }

  if (!ID_PATTERN.test(id)) {
    console.error(`插件 id 非法："${id}"，只允许小写字母、数字与连字符（如 my-plugin）`);
    process.exit(1);
  }

  const desc = `由 ${name} 提供的智简匣插件`;
  const author = process.env.ZJ_PLUGIN_AUTHOR || '独立开发者';

  const fill = (t) =>
    t
      .replaceAll('{{PLUGIN_ID}}', id)
      .replaceAll('{{PLUGIN_NAME}}', name)
      .replaceAll('{{PLUGIN_DESC}}', desc)
      .replaceAll('{{PLUGIN_AUTHOR}}', author);

  const outDir = resolve(ROOT, process.env.ZJ_PLUGIN_OUT || 'my-plugins', id);
  await mkdir(outDir, { recursive: true });

  // 插件源码写成 .js —— 宿主以 ESM 执行，浏览器原生支持
  await writeFile(join(outDir, 'plugin.js'), fill(PLUGIN_SOURCE), 'utf8');
  await writeFile(join(outDir, 'build.mjs'), fill(BUILD_SOURCE), 'utf8');
  await writeFile(join(outDir, 'README.md'), README(id, name), 'utf8');
  await writeFile(
    join(outDir, 'package.json'),
    `${JSON.stringify(
      {
        name: id,
        version: '1.0.0',
        private: true,
        type: 'module',
        description: desc,
        scripts: { build: 'node build.mjs' },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`已创建插件工程：${outDir}`);
  console.log('');
  console.log('接下来：');
  console.log(`  1. cd ${outDir.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
  console.log('  2. 编辑 plugin.js');
  console.log('  3. node build.mjs');
  console.log('  4. 在智简匣「功能广场 → 导入插件」选中生成的 .plugin 文件');
}

main().catch((error) => {
  console.error('[插件脚手架] 执行失败：', error);
  process.exit(1);
});
# 主题包

三套自制主题包，可直接在「功能广场 → 主题 → 导入主题」中使用。

| 文件 | 名称 | 分类 | 风格 |
| --- | --- | --- | --- |
| `ink-dai.theme` | 墨黛 | 配色 | 东方水墨暗色，宣纸底 + 松烟墨层次，主色石青。长时间阅读柔和。 |
| `lime-kick.theme` | 青柠 | 综合 | 高饱和亮色，毛玻璃卡片与导航栏，白天与提神场景。 |
| `crimson-rose.theme` | 绯 | 卡片 | 暖色双面，描边卡片 + 顶部强调条，适合密集信息场景。 |

三套都提供完整的亮色 / 暗色双模式配色。

## 校验

```bash
npm run themes:check    # 配色对比度（WCAG AA）
npm run themes:verify   # 导入合法性（用项目自己的 packager.ts）
```

- `themes:check` 会实测每组前景/背景的对比度，并**复刻宿主的
  `pickForeground` 决策**（按主色亮度自动选黑/白字），避免误判。
- `themes:verify` 加载 `src/lib/theme/packager.ts` 跑一遍
  `validateThemePackage()` + `themePackOf()` —— 也就是用户点「导入」
  时真正执行的代码路径。

## 改配色

1. 直接编辑 `.theme` 里 `pack.light` / `pack.dark` 的七色
   （`accent` / `accentSoft` / `card` / `bg` / `fg` / `mutedFg` / `border`）
   与 `shadow`（0~3）。
2. 跑 `npm run themes:check`，不达标会指出具体哪一项、差多少。
3. 导入应用实测效果。

⚠️ **两个易踩的坑**：

- 圆角（`radius`）**不由主题包控制**，它是「设置 · 个性化」里的全局选项，
  写了也会在导入时被忽略。
- 暗色模式的主色若调得太亮（如 `#7fb3d3`），宿主会自动配白字，
  实测只有 2.26:1 —— 按钮文字几乎看不清。校验脚本能抓到这个情况。

# 换肤 + 全局背景/水印 + shadcn 语义层收口 设计

> 需求来源：用户在 ui-primitives 全量迁移（shadcn + Tailwind）完成后，提出做换肤、全局图片背景/水印，并完成 shadcn 语义层与现有暗色机制的统一。本文是这三件事的权威设计。

## 目标与硬约束

1. **换肤是 2×N 正交矩阵**：`data-skin`（N 套皮肤）× `data-ds-dark-theme`（明/暗）两个独立维度。每套皮肤都有明/暗两个变体，二者互不冲突。
2. **零返工**：atoms 已用 `var(--dsw-alias-*)`（迁移产物），换肤直接覆盖 `--dsw-alias-*` 层，组件自动跟随，不改任何 atom。
3. **shadcn 收口**：把 shadcn 的 `.dark` 类与现有 `body[data-ds-dark-theme]` 打通，让 shadcn 语义 token（`--primary`/`--background`/…）随皮肤 + 明暗走。
4. **全局背景/水印**：布局预留一个 `fixed` 全局背景层；主题变量预留 `--app-background-image` / `--app-watermark` 槽位。**右下角预留 Live2D**（本次不实现，只留扩展点）。
5. **图片来源**：本地上传 + URL 都支持。

---

## 现状（关键事实，设计据此展开）

- token 三层：`--dsw-static-*`（原始色，`design-platform.css` 里 `body {}` 定义）→ `--dsw-alias-*`（语义别名，`body {}` 明 + `body[data-ds-dark-theme] {}` 暗）→ `--dsw-specific-*`（特定组件）。
- 主题服务 `ThemeRuntime`（`packages/client/ui-theme/src/client/index.ts`）：
  - `ThemeDefinition = { id, colorScheme: 'light'|'dark', tokens: Record<token, value> }`。
  - 内置 `light`/`dark` 两个主题（`tokens: {}`，靠 CSS 的 `data-ds-dark-theme` 块提供明/暗两套值）。
  - `overrideTokens(source, { token: { light, dark } })` 叠加 token 覆盖层，`composeActive()` 按 `active.colorScheme` 从 `{light,dark}` 里取值折叠进 snapshot。
  - `register(definition)` 注册第三方主题。
- 表现层 `ThemePresenter`（`packages/client/ui-layout/src/client/theme-presenter.ts`）：
  - 把 `snapshot.active.colorScheme` → `document.documentElement.style.colorScheme` + `body[data-ds-dark-theme]`（设/删）。
  - 把 `snapshot.active.tokens` → `body.style.setProperty(name, value)`（inline 覆盖层）。
- shadcn 语义层：`packages/client/web/src/globals.css` 里 `:root`/`.dark` 把 `--primary`/`--background`/`--muted` 等映射到 `--dsw-*`，`@theme inline` 把 `--color-*` 指向这些变量。`@custom-variant dark (&:is(.dark *))`。
- 设置：`ThemeSettings = { preference: 'light'|'dark'|'system' }`（`theme-settings.ts`），UI 是 `AppearanceRow`（三个明暗/跟随立方体）。

**核心结论**：换肤不必发明新机制 —— 皮肤就是一套 `--dsw-alias-*` 的 `{light,dark}` 覆盖层，走现有的 `overrideTokens`/`composeActive` 路径即可，明/暗正交由 `active.colorScheme` 自动完成。

---

## 一、换肤（方案 A：`data-skin` 覆盖 `--dsw-alias-*`）

### 1.1 皮肤模型

```ts
export type SkinId = 'default' | 'glass' | 'cyber'
export const SKIN_IDS = ['default', 'glass', 'cyber'] as const
export const DEFAULT_SKIN: SkinId = 'default'
```

每套皮肤是一份 `ThemeTokenOverrides`（`Record<token, { light, dark }>`）：

- **default**：空 `{}`（即现有 base 明/暗两套，零视觉变化）。
- **glass**（玻璃拟态）：覆盖 `--dsw-alias-bg-*`（半透明白/黑 + backdrop blur）、`--dsw-specific-menu`/`--dsw-specific-sidebar-fill`（磨砂面板）、`--dsw-alias-border-*`（更淡）。
- **cyber**（赛博）：覆盖 `--dsw-alias-brand-primary`/`--dsw-alias-bg-*`/`--dsw-alias-border-*`/`--dsw-alias-label-*`（暗底霓虹、高对比）。

具体取值在实现计划里定（从现有 `--dsw-static-*` 取色，不硬编码新色）。

### 1.2 设置持久化

- `ThemeSettings` 增加 `skin: SkinId`（默认 `default`）。`ThemeSettingsSchema` 增加 `z.union(SKIN_IDS).default('default')`。
- 皮肤与 `preference`（明暗/跟随）**正交**：皮肤不改变 `colorScheme` 解析。

### 1.3 服务接入

- `ThemeRuntime` 持有一个皮肤层：皮肤变化时 `overrideTokens('ui-theme:skin', SKIN_PRESETS[skin])`（`default` 传空 `{}`），复用现有 `composeActive` 按 `active.colorScheme` 折叠。
- snapshot 增加 `skin: SkinId`，供 presenter 与 UI 读取。

### 1.4 表现层

- `ThemePresenter.apply` 增加：`body.setAttribute('data-skin', snapshot.skin)`（`default` 也写，便于 CSS 选择器稳定）；retract 时移除。
- `data-skin` 与 `data-ds-dark-theme` 是**两个独立属性**，分别代表皮肤维度与明暗维度。

### 1.5 UI（设置 → 通用设置）

- 新增一个「皮肤」行（或扩展 `AppearanceRow`）：三个皮肤选项（默认/玻璃/赛博），交互与现有三个立方体一致，选中态读 `snapshot.skin`，写 `setSkin(skin)`。
- `AppearanceRow` 现在读写 `preference`；新皮肤行读写 `skin`，二者互不影响。

---

## 二、shadcn 语义层收口

1. **`.dark` 打通**：`globals.css` 的 `@custom-variant dark` 改为匹配 `body[data-ds-dark-theme]`（现有 app 暗色开关），而不是 shadcn 默认的 `.dark` 类。即 `@custom-variant dark (&:is([data-ds-dark-theme] *))`（或等价的 `:root[data-ds-dark-theme]` 块）。
2. **语义 token 随皮肤**：`--primary`/`--background`/`--muted`/`--border` 等已映射到 `--dsw-alias-*`；皮肤覆盖 `--dsw-alias-*` 后，这些语义 token 自动跟随（`@theme inline` 的 `--color-*: var(--*)` 引用在运行时求值）。确认 `--primary` 指向皮肤的品牌色（`--dsw-alias-brand-primary` 而非固定 `--dsw-static-deepseek-500`）。
3. **结果**：`ShadcnButton` 等 shadcn 组件、以及将来用 `bg-primary` 语义类的组件，都能随皮肤 + 明暗正确渲染。

---

## 三、全局背景/水印

### 3.1 背景层

- 布局根挂一个 `fixed` 全局背景层（`position: fixed; inset: 0; z-index: 底层; pointer-events: none`），位于所有内容之下。
- 背景图 `background-image: var(--app-background-image)`，`background-repeat: repeat`（平铺）。
- `--app-background-image` 默认 `none`。

### 3.2 主题变量槽位

- `--app-background-image`：平铺背景图（本次实现）。
- `--app-watermark`：水印槽位（预留，本次仅定义变量，不渲染元素）。

### 3.3 设置与图片来源

- 新增「背景图」设置（本地 + URL 都支持）：
  - **本地**：设置里上传图片 → 读为 data URL → 存入设置。
  - **URL**：输入远程 URL → 存字符串。
- 存到设置文档（可复用 `ThemeSettings` 或独立 namespace，实现时定）。写入后 presenter 把 `--app-background-image: url(...)` 应用到 `body`（inline）。

### 3.4 Live2D 预留

- 右下角**预留**一个 `--app-live2d` 槽位 / `fixed` 锚点，本次只留扩展点与文档说明，不实现 Live2D 本体。

---

## 涉及文件（实现计划据此展开）

- `packages/client/ui-theme/src/theme-settings.ts`：`SkinId` + `ThemeSettings.skin` + schema。
- `packages/client/ui-theme/src/client/index.ts`：皮肤层接入 `overrideTokens` + snapshot.skin + `setSkin`。
- `packages/client/ui-theme/src/skins.ts`（新）：`SKIN_PRESETS`（glass/cyber 的 token 覆盖值）。
- `packages/client/ui-theme/src/client/AppearanceRow.tsx`（或新 SkinRow）：皮肤选择 UI。
- `packages/client/ui-layout/src/client/theme-presenter.ts`：`data-skin` + `--app-background-image`/`--app-watermark` inline 应用。
- `packages/client/ui-layout`（布局根）：`fixed` 全局背景层元素。
- `packages/client/web/src/globals.css`：`@custom-variant dark` 改指向 `data-ds-dark-theme`；语义 token 皮肤化核对。
- `packages/client/ui-settings-general`（或 ui-theme）：背景图上传/URL 设置控件。

---

## 自检

- ✅ 2×N：`data-skin`（皮肤）× `data-ds-dark-theme`（明暗）正交，每套皮肤 `{light,dark}` 由 `active.colorScheme` 折叠。
- ✅ 零返工：只覆盖 `--dsw-alias-*`，不改任何 atom。
- ✅ 右下角 Live2D 预留（不实现）。
- ✅ 图片来源本地 + URL。

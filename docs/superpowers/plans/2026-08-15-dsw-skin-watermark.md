# 换肤 + 全局背景/水印 + shadcn 收口 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在 ui-primitives 全量迁移到 shadcn+Tailwind 之后，落地「换肤」（默认/玻璃/赛博三套，`data-skin` 正交于明暗）、「全局平铺背景图」（本地上传 + URL，右下角预留 Live2D）、并把 shadcn 语义层与现有 `data-ds-dark-theme` 打通。

**Architecture:** 换肤复用现有 `ThemeRuntime.overrideTokens()` + `composeActive()` 的 token 覆盖层机制——皮肤就是一套 `--dsw-alias-*` 的 `{light,dark}` 覆盖层，明暗正交由 `active.colorScheme` 折叠；设置页新增「个性化」section 承载主题/皮肤/背景图三行。

**Tech Stack:** React 18 + Tailwind v4 + shadcn 语义 token；Cordis 插件 + slots；zod(schemastery) 设置 schema。

**设计文档:** `docs/superpowers/specs/2026-08-15-dsw-skin-watermark-design.md`（权威，先读）。

## Global Constraints

- **零返工**：只覆盖 `--dsw-alias-*`，不改任何 atom 组件、不改 `--dsw-static-*`。
- **2×N 正交**：`data-skin`（皮肤）× `data-ds-dark-theme`（明暗）两个独立属性。
- **皮肤配色「偏激进但观感好」**：glass/cyber 从现有 `--dsw-static-*` 取色，明显可辨但不刺眼。
- **设置结构**：新增「个性化」section（含主题=现有外观改名、皮肤、背景图）；「外观」从通用设置移除。
- **右下角 Live2D 预留**：只留扩展点，不实现本体。
- 皮肤 id 枚举：`'default' | 'glass' | 'cyber'`，默认 `'default'`。
- 图片来源：本地上传（转 data URL）+ URL，二者都支持。
- **国际化**：所有新增 UI 文案（「个性化」nav、「主题」标题、「皮肤」标签、「背景图」标签/占位/按钮等）必须同时提供 `zh` + `en`，走现有 `ctx.locale.register(ns, { zh, en })` 模式，用稳定键名（如 `theme.title`、`skin.glass`、`background.upload`），不硬编码文案到组件里。

---

### Task 1: shadcn 收口（`.dark` 打通 + `--primary` 皮肤化）

**Files:**
- Modify: `packages/client/web/src/globals.css`

**Interfaces:**
- Produces: shadcn `dark:` 变体与 `body[data-ds-dark-theme]` 联动；`--primary` 跟随皮肤。

- [ ] **Step 1: 改 `@custom-variant dark` 指向暗色属性**
  把 `@custom-variant dark (&:is(.dark *));` 改为匹配 `data-ds-dark-theme`（保留 `:is()` 包裹以便后代选择器工作），例如 `@custom-variant dark (&:is([data-ds-dark-theme] *));`。
- [ ] **Step 2: `.dark` 块改为 `[data-ds-dark-theme]` 块**
  `.dark { ... }` → `[data-ds-dark-theme] { ... }`（或 `:root[data-ds-dark-theme]`），保证现有暗色语义 token 随 `data-ds-dark-theme` 生效。
- [ ] **Step 3: `--primary` 皮肤化**
  `:root` 里 `--primary: var(--dsw-static-deepseek-500)` → `var(--dsw-alias-brand-primary)`；`[data-ds-dark-theme]` 里 `--primary: var(--dsw-static-deepseek-400)` 同样改为 `var(--dsw-alias-brand-primary)`（该别名已随暗色翻转，无需分块）。
- [ ] **Step 4: 构建验证**
  `CI=true pnpm run build:web` 通过；grep 产物 CSS 确认 `data-ds-dark-theme` 选择器与 `dsw-alias-brand-primary` 出现在语义 token 定义里。
- [ ] **Step 5: commit** `feat(web): wire shadcn dark variant to data-ds-dark-theme and skinize --primary`

### Task 2: 换肤核心（skin 模型 + theme service + data-skin）

**Files:**
- Modify: `packages/client/ui-theme/src/theme-settings.ts`
- Create: `packages/client/ui-theme/src/skins.ts`
- Modify: `packages/client/ui-theme/src/client/index.ts`
- Modify: `packages/client/ui-layout/src/client/theme-presenter.ts`

**Interfaces:**
- Consumes: `ThemeRuntime`（`overrideTokens`/`composeActive`/snapshot）、`ThemePresenter`。
- Produces:
  - `SkinId = 'default' | 'glass' | 'cyber'`、`DEFAULT_SKIN`、`SKIN_IDS`、`isSkinId`。
  - `SKIN_PRESETS: Record<SkinId, ThemeTokenOverrides>`（glass/cyber 非空，default 空 `{}`）。
  - `ThemeSettings` 增 `skin: SkinId`；`ThemeSettingsSchema` 增字段。
  - `ThemeSnapshot` 增 `skin: SkinId`。
  - `ThemeRuntime.setSkin(skin: SkinId)`；皮肤变化时 `overrideTokens('ui-theme:skin', SKIN_PRESETS[skin])`。
  - `ThemePresenter.apply` 写 `body[data-skin]`；`dispose` 移除。

- [ ] **Step 1: skin 模型**（`theme-settings.ts`）：定义 `SkinId`、`SKIN_IDS`、`DEFAULT_SKIN`、`isSkinId`；`ThemeSettings` 增 `skin`；schema 增 `z.union([...SKIN_IDS]).default('default')`；导出。
- [ ] **Step 2: SKIN_PRESETS**（`skins.ts`）：glass/cyber 两套 `ThemeTokenOverrides`（`{ light, dark }` 对），覆盖 `--dsw-alias-bg-base/layer-1/layer-2/border-l1/border-l2/brand-primary` 等；值从 `--dsw-static-*` 现有色取（如 glass 用半透明白/黑 + 淡边框，cyber 用深底 + 亮品牌色）。default 空对象。每个值都是 `{ light, dark }` 成对。
- [ ] **Step 3: theme service 皮肤层**（`client/index.ts`）：`ThemeRuntime` 增 `private skin: SkinId = DEFAULT_SKIN`；构造时 `overrideTokens('ui-theme:skin', SKIN_PRESETS[this.skin])`；`setSkin(id)` 校验 + 更新 `skin` + 重新 `overrideTokens('ui-theme:skin', SKIN_PRESETS[id])` + `publish()`；`buildSnapshot()` 增 `skin: this.skin`；`adopt()` 同时读取 `section.skin`。
- [ ] **Step 4: presenter data-skin**（`theme-presenter.ts`）：`apply` 里 `body.setAttribute('data-skin', snapshot.skin)`；`dispose` 里 `body.removeAttribute('data-skin')`。
- [ ] **Step 5: 单测**：皮肤切换后 snapshot.skin 变化、tokens 按 `active.colorScheme` 折叠、`data-skin` 属性写入/移除。`vitest run packages/client/ui-theme/tests packages/client/ui-layout/tests`。
- [ ] **Step 6: commit** `feat(theme): add skin dimension (default/glass/cyber) over alias-token layer`

### Task 3: 设置结构（新增「个性化」section + 移动并改名外观）

**Files:**
- Modify: `packages/client/ui-settings/src/client/contract/slots.ts`（声明 `settings.personalization.item`）
- Modify: `packages/client/ui-settings-general/src/client/index.ts`（注册 personalization section）
- Modify: `packages/client/ui-settings-general/src/client/locales.ts`（`personalization.nav` 文案）
- Modify: `packages/client/ui-theme/src/client/locales.ts`（`appearance` → `theme` 文案键）
- Modify: `packages/client/ui-theme/src/client/index.ts`（外观行改注册到 `settings.personalization.item`）

**Interfaces:**
- Produces: 设置页出现「个性化」section（在「通用」之后）；原「外观」行从通用移除、出现在个性化并改名「主题」。

- [ ] **Step 1: 声明 item 槽**（`slots.ts`）：`SlotMap` 增 `'settings.personalization.item': { kind: 'list'; scope: 'root'; owner: SettingsGeneralItemOwnerProps }`（复用同 owner props）。
- [ ] **Step 2: 注册 section**（`ui-settings-general/index.ts`）：在 `settings.section` 增第二条注册 `{ id: 'personalization', order: 1, label: () => t('personalization.nav'), children: { 'settings.personalization.item': { kind: 'list', scope: 'root' } } }`，复用 `GeneralSection` 组件（通用列渲染）。
- [ ] **Step 3: locales**：`ui-settings-general/locales.ts` 增 `personalization.nav`；`ui-theme/locales.ts` 把 `appearance.*` 键名改为 `theme.*`（标题「外观」→「主题」）。
- [ ] **Step 4: ui-theme 行迁移**（`ui-theme/client/index.ts`）：`ctx.slots.inject('settings.general.item', ...)` → `ctx.slots.inject('settings.personalization.item', ...)`；locale namespace 相应调整。
- [ ] **Step 5: 测试**：`vitest run packages/client/ui-settings-general/tests packages/client/ui-theme/tests`；现有 `atoms`/`apply` 测试里引用了 `settings.general.item` 的断言同步更新。
- [ ] **Step 6: commit** `feat(settings): add Personalization section, move appearance to it as Theme`

### Task 4: 皮肤 + 背景图 UI（个性化内的两行）

**Files:**
- Modify: `packages/client/ui-theme/src/client/AppearanceRow.tsx`（或新建 `SkinRow.tsx` / `BackgroundRow.tsx`）
- Modify: `packages/client/ui-theme/src/client/settings-store.ts`（snapshot 增 skin/background 字段）
- Modify: `packages/client/ui-theme/src/client/index.ts`（注册皮肤行 + 背景图行 + setSkin/setBackground 注入）
- Modify: `packages/client/ui-theme/src/client/locales.ts`

**Interfaces:**
- Produces: 个性化内出现「主题」（明暗三立方体）、「皮肤」（默认/玻璃/赛博）、「背景图」（本地上传 + URL 输入）三行。

- [ ] **Step 1: 皮肤行**：三个皮肤选项（默认/玻璃/赛博），选中态读 `snapshot.skin`，点击 `setSkin(id)`；复用现有 AppearanceRow 的立方体交互样式。
- [ ] **Step 2: 背景图行**：两个来源——本地文件上传（`<input type="file">` → `FileReader` 读 data URL）与 URL 输入框；写入背景图设置，调用 `setBackground(value)`（string，含 `url(...)` 或空）。
- [ ] **Step 3: store 扩展**：`settings-store.ts` 增 `skin`、`background` 字段 + sync。
- [ ] **Step 4: index.ts 接线**：注册皮肤行、背景图行到 `settings.personalization.item`；注入 `setSkin`、`setBackground`。
- [ ] **Step 5: 测试**：皮肤行切换触发 `setSkin`、背景图上传/URL 触发 `setBackground`。`vitest run packages/client/ui-theme/tests`。
- [ ] **Step 6: commit** `feat(theme): skin + background-image settings rows`

### Task 5: 全局平铺背景层 + 槽位 + Live2D 预留

**Files:**
- Modify: `packages/client/ui-layout/src/client/theme-presenter.ts`（`--app-background-image` inline 应用）
- Modify: 布局根（`packages/client/ui-layout` 或 `packages/client/web/src/AppRoot`）挂 `fixed` 背景层
- Modify: `packages/client/web/src/globals.css`（`--app-background-image`/`--app-watermark` 默认变量 + 背景层样式）

**Interfaces:**
- Produces: 一个 `fixed` 平铺背景层随 `--app-background-image` 渲染；右下角 Live2D 锚点占位。

- [ ] **Step 1: 变量默认**（globals.css）：`:root { --app-background-image: none; --app-watermark: none; }`。
- [ ] **Step 2: 背景层元素**（布局根）：`<div aria-hidden className="app-background-layer" />`（`fixed inset-0 -z-10 pointer-events-none`，`background-image: var(--app-background-image); background-repeat: repeat`）。右下角另留 `<div data-live2d-mount />` 占位（空，仅锚点）。
- [ ] **Step 3: presenter 应用**：`apply` 里 `body.style.setProperty('--app-background-image', snapshot 里的背景值)`（背景图值从设置流经 theme snapshot 或独立注入，实现时定）；`dispose` 移除。
- [ ] **Step 4: 测试**：背景图值应用/移除；背景层元素渲染。`vitest run packages/client/ui-layout/tests`。
- [ ] **Step 5: commit** `feat(web): global tiled background layer + watermark/live2d slots`

---

## 最终验证（全部 task 完成后）

- `CI=true pnpm run build:web` 通过。
- `vitest run packages/client/ui-theme/tests packages/client/ui-layout/tests packages/client/ui-settings-general/tests` 全绿。
- 端到端：`pnpm --dir desktop run build:sidecar` + 重启 `tauri dev`，肉眼确认：设置→个性化有主题/皮肤/背景图三行；切皮肤 + 切明暗叠加正确；背景图本地/URL 生效；右下角留空。

## Task 6（暂缓，地基完成后再定）

**动画增强**：换肤切换动画 + 背景/水印动效。技术选型（GSAP vs 纯 CSS keyframes vs 其他）暂缓，等 Task 1-5 完成后、看到实际换肤效果再定。用户已确认此顺序。

## 执行顺序说明

Task 1 独立可先行；Task 2 是换肤核心；Task 3（设置结构）与 Task 2 有少量耦合（都改 ui-theme/index.ts），**Task 3 须在 Task 2 之后**；Task 4（UI）在 Task 3 之后；Task 5（背景层）可与 Task 2/4 并行但建议最后收口。串行执行：1 → 2 → 3 → 4 → 5。

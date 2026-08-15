# ui-primitives 全量迁移规范 (CSS Modules → Tailwind + shadcn)

> 这是 `ui-primitives` 22 个残留 CSS Modules 组件迁移到 Tailwind 的**唯一权威规范**。每个 implementer subagent 必须完整阅读本文件，再开始迁移。

## 目标与硬约束

1. **公开 API 完全不变**：每个 `.tsx` 导出的组件名、props、类型、默认值、`data-*` 属性、行为（keyframes 时序、reduced-motion、暗色）逐字保持不变。只替换「样式机制」：`import css from './X.module.css'` + `css.foo` → `cn()` + Tailwind utility / 自定义 class。
2. **token 值逐字保留**：所有颜色/阴影/圆角等仍引用 `var(--dsw-*)`（静态 `--dsw-static-*`、别名 `--dsw-alias-*`、特定 `--dsw-specific-*`、阴影 `--dsw-shadow-*`）。**不要**改写 token 名称，**不要**硬编码新颜色。
3. **暗色机制不变**：应用用 `body[data-ds-dark-theme]` 切换。`--dsw-alias-*` 已随它翻转。迁移不得引入第二个主题机制（`.dark` 类只属于 shadcn 语义层，atom 迁移不碰它）。
4. **删除 `.module.css`**：迁移完成后删除对应 `.module.css` 文件。

## 权威参考（必须照抄风格）

- **已迁移样例**：`packages/client/ui-primitives/src/Button.tsx` —— 唯一已完成的 atom，照它的写法。
- **`cn()` 工具**：`packages/client/ui-primitives/src/components/ui/cn.ts`（`twMerge(clsx(...))`）。
- **全局 CSS 入口**：`packages/client/web/src/globals.css`（Tailwind v4 + shadcn 语义 token 已就绪）。
- **自定义 CSS 落点**：`packages/client/web/src/primitives.css`（本迁移新增，见下）。由 `globals.css` 顶部 `@import 'tailwindcss';` **之后**用 `@import './primitives.css';` 引入（若尚未引入，implementer 补上这一行）。

## 迁移规则

### R1. import 与 class 合成
- 删掉 `import css from './X.module.css'`。
- 引入 `cn`：顶层组件 `import { cn } from './components/ui/cn.ts'`；`markdown/` 子目录组件 `import { cn } from '../components/ui/cn.ts'`。
- 原来 `clsx(...)` 的地方换成 `cn(...)`（`cn` = `twMerge(clsx)`，语义超集，可直接替换）。若组件同时引了 `clsx`，改为只引 `cn`。

### R2. 简单规则 → Tailwind utility（映射表）
把 `.module.css` 里每条**单属性/单元素**规则翻成 utility，颜色一律用任意值 `var(--dsw-*)`（照 Button）：

| CSS 声明 | Tailwind |
|---|---|
| `color: var(--x)` | `text-[var(--x)]` |
| `background: var(--x)` | `bg-[var(--x)]` |
| `border: 1px solid var(--x)` | `border border-[var(--x)]` |
| `border-color: var(--x)` | `border-[var(--x)]` |
| `border-radius: Npx` | `rounded-[Npx]` |
| `box-shadow: var(--x)` | `shadow-[var(--x)]` |
| `padding: a b c d` | `p-[..]` / `px-[..]` `py-[..]` `pt-` `pr-` `pb-` `pl-`（按需） |
| `margin` | `m-*` |
| `font-size: Npx` | `text-[Npx]` |
| `line-height: Npx` | `leading-[Npx]` |
| `font-weight: 500` | `font-medium`（400=`font-normal`，600=`font-semibold`，否则 `font-[N]`） |
| `display: flex` | `flex` |
| `flex-direction: column` | `flex-col` |
| `align-items: center` | `items-center` |
| `justify-content: space-between` | `justify-between`（`flex-end`=`justify-end`，`center`=`justify-center`） |
| `gap: Npx` | `gap-[Npx]`（6px=1.5=`gap-1.5` 等首选标准档，但任意值也可） |
| `width/height: Npx` | `w-[Npx]` / `h-[Npx]` / `size-[Npx]` |
| `min-width/max-width/min-height/max-height` | `min-w-*` `max-w-*` `min-h-*` `max-h-*` |
| `position: fixed/absolute/relative` | `fixed` / `absolute` / `relative` |
| `top/right/bottom/left` | `top-*` `right-*` `bottom-*` `left-*`（任意值 `top-[Npx]`） |
| `inset: 0` | `inset-0` |
| `z-index: N` | `z-[N]`（100/1000/1100 可用 `z-*` 任意值） |
| `overflow: auto/hidden` | `overflow-auto` / `overflow-hidden` |
| `cursor: pointer` | `cursor-pointer` |
| `text-align: left` | `text-left` |
| `white-space: pre/nowrap/pre-line` | `whitespace-pre` / `whitespace-nowrap` / `whitespace-pre-line` |
| `text-overflow: ellipsis`（配 overflow hidden + nowrap） | `truncate`（或 `overflow-hidden text-ellipsis whitespace-nowrap`） |
| `user-select: none` | `select-none` |
| `pointer-events: none` | `pointer-events-none` |
| `flex: none` | `flex-none` |
| `flex: 1` | `flex-1` |
| `box-sizing: border-box` | 可省略（Tailwind preflight 已默认 border-box） |
| `outline: none` | `outline-none` |
| `list-style: none` | `list-none` |
| `background: transparent` | `bg-transparent` |
| `border: none` | `border-none` |
| `backdrop-filter: var(--x)` | `backdrop-blur-[var(--x)]`（或保留到自定义 class） |

### R3. 伪类/状态 → Tailwind variant
- `.x:hover { ... }` → `hover:...`
- `.x:focus-visible` → `focus-visible:...`
- `.x:focus-within` → `focus-within:...`
- `.x:disabled` → `disabled:...`
- `.x:not(:disabled)` → 无需特殊处理（`disabled:` 覆盖即可；若原 CSS 用 `:hover:not(:disabled)`，写成 `hover:... disabled:...`，利用 disabled 变体优先）
- `.x[data-state='done'] { ... }` → `data-[state=done]:...`
- `.x[data-side='right']` → `data-[side=right]:...`
- `.x::placeholder` → `placeholder:...`

### R4. 复杂规则 → 自定义 class（写进 primitives.css）
以下 CSS **无法**用 utility 表达，必须作为自定义 class 写进 `primitives.css`：

- **`@keyframes`**：原样搬到 `primitives.css` 顶层（名字保留：`dsh-state-dot-chase`、`dsh-toast-in`、`dsh-toast-fade`、`tooltip-in` 等）。
- **含 `animation` 的规则**：把 `animation: ...` 留在自定义 class（不塞进任意值，多段 animation 更不宜塞）。
- **`::before` / `::after` 带几何/`content`**（如 JsonTree 三角展开、StateDot halo、Menu submenu 桥接、`collapsedContent::after { content:'…' }`）：写进自定义 class。
- **`:has(...)` 选择器**（JsonTree 行 hover、MarkdownText heading-has-list）：写进自定义 class。
- **后代组合器** `.a .b`（Menu `.denseList .item`、`.danger .itemIcon`、`TerminalBlock .block:not([data-running]) .header`、MarkdownText 的 `li > *` 等）：写进自定义 class。
- **`:global(sel)`**：把 `:global(X)` 去掉外壳、变成纯 `X`，写进自定义 class。例：`:global(body[data-ds-dark-theme]) .root` → `body[data-ds-dark-theme] .jt-root { ... }`；`.answer > :global(div) > :first-child` → `.web-answer > div > :first-child`。
- **`:where(...)`**：保留原样写进自定义 class（`:where` 是低优先级，直接保留语义）。
- **`@media (prefers-reduced-motion: reduce)`**：能用 `motion-reduce:` 变体就用变体；若它只改 `animation`，把整段写进自定义 class 用 `@media` 保留。

自定义 class 写法（Tailwind v4）：

```css
@layer components {
  .jt-row { /* 原 .row */ }
  .jt-row:hover:not(:has(.jt-row:hover))::after { /* 原 :has 规则 */ }
}
@keyframes dsh-state-dot-chase { /* 原样 */ }
```

### R5. 自定义 class 命名（避免冲突）
CSS Modules 的 `.root`/`.item`/`.list`/`.label`/`.icon`/`.text`/`.cell`/`.dot`/`.bubble`/`.toast`/`.dialog`/`.header`/`.footer`/`.separator`/`.check`/`.title`/`.row`/`.line`/`.block`/`.pill`/`.wrap`/`.expander` 都是泛化名，移进全局后必须**加组件前缀**（kebab-case）：

- JsonTree → `jt-`（`jt-root` `jt-row` `jt-expander` …）
- Menu → `menu-`（`menu-list` `menu-item` `menu-submenu` …）
- StateDot → `state-dot-`（`state-dot` `state-dot-cell` …）
- Toast → `toast-`（`toast-root` `toast-icon` …）
- Tooltip → `tooltip-`（`tooltip-bubble` …）
- TerminalBlock → `term-`
- DiffBlock → `diff-`
- WebBlock → `web-`
- SearchBlock → `search-`
- ReadBlock → `read-`
- MarkdownText → `prose-`（`prose` `prose-code` …）
- CodeBlock → `code-`
- JsonBlock → `json-block-`

纯 utility 能表达的规则不产生自定义 class（也就没有命名问题）。

### R6. 颜色歧义兜底
照 Button 写 `text-[var(--x)]`（已证明为 color）。若遇 `text-[var(--x)]` 与 `text-[Npx]`（字号）同现于不同元素导致 twMerge 误判，改用 `text-(--x)`（Tailwind v4.1 括号语法，等价 `var(--x)`）或 `text-[color:var(--x)]` 消歧义。**优先照抄 Button 的 `text-[var(--x)]`**。

## 验证（每个 implementer 必须跑）

```bash
# 从仓库根
CI=true pnpm run build:web
```

通过标准：
1. 构建成功（`✓ built in …`）。
2. 无残留对已删 `.module.css` 的 import。
3. grep 产物 CSS 能搜到本组件用到的关键 `--dsw-alias-*` token 名（证明 utility 已生成）。
4. `git diff --stat` 确认只有目标 `.tsx` 改 + `.module.css` 删 + `primitives.css` 增 +（首次）`globals.css` 加一行 import。

## 分批次（按复杂度，顺序执行）

- **Batch 1 — 纯 utility（8）**：ConnectionBanner, Pill, OnboardingSurface, Input, HoverCard, DisclosureRow, RiskConfirmation, Modal。无 keyframes/pseudo/:has。
- **Batch 2 — utility + keyframes/pseudo（8）**：DiffBlock, ReadBlock, SearchBlock, WebBlock, TerminalBlock, StateDot, Toast, Tooltip。
- **Batch 3 — 复杂（2）**：JsonTree, Menu（`:has` + 后代组合器 + pseudo 桥接）。
- **Batch 4 — markdown（4）**：CodeBlock, JsonBlock, MarkdownText, MessageText（`:where`/`:has`/`:global` 排版）。

每个 batch 一个 implementer subagent，串行；batch 完成后跑 review。

## 提交规范

每 batch 一条 commit（或每组件一条，implementer 自定但需注明）。commit message 形如：
`feat(web): migrate <组件名> atom(s) to Tailwind (public API unchanged)`
末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 由 controller 处理——**implementer 的 commit 不加 trailer**，由 controller 在最终整理时决定。

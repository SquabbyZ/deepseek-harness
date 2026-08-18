# 插件列表 · 动态启停 + 持久化 设计（修订版 v1）

> **修订日志**：本文件是 [`2026-08-17-plugin-inventory-toggle-design.md`](2026-08-17-plugin-inventory-toggle-design.md) 的修订版。原 spec 已经写明目标、约束与验收；本版只修正**实现路径**和**与项目规范的对齐**，不重写目标和验收。
>
> 修订日期 2026-08-18。修订者：架构 review。原 spec 进入 archive 时附"已被 rev1 取代"标记。

---

## §0 修订摘要：原版违反的规范条款

按 `packages/client/AGENTS.md` 和 `packages/AGENTS.md` 逐条核对，原版有 5 处需要改：

| # | 原版位置 | 违反条款 | 修订方向 |
|---|---|---|---|
| R1 | §一 / §二.2 客户端 `usePluginInventoryList` 用 `useSyncExternalStore` 直接订阅 host 推送事件 | `packages/client/AGENTS.md` reactive-read rule 2：业务组件不能"no `useSyncExternalStore`, no manual subscribe wiring, no mirroring an external snapshot into local state or a second store"——只能订阅声明的 store / inject `hooks` | 改为：apply() 里建 `createPluginInventoryStore()`，由它在订阅时通过 `connection` 接 `events.host` 的 `pluginInventory/changed` 帧；组件通过 inject face 拿 `store.subscribe` / `store.getSnapshot` |
| R2 | §一 / §二.1 host 端 emit `inventory/changed`、`loader/init`、`loader/partial-dispose`、`loader/failed` 到 wire——原版假定 host↔client 已有这条 mux 通道 | 实际已有的机制：`packages/host/apiproxy/src/api/events.ts` 已有 `host/remote-event` 通用包装帧；`packages/api/remotes/src/remote-events.ts` 的 `API_REMOTE_FORWARDED_EVENTS` 白名单 + `packages/host/apiproxy/src/api-proxy.ts:3708` 的转发循环 + `packages/client/runtime/src/client/index.ts:216` 的 `$dispatch` + `ctx.remote.$on` 消费者动词。`cordis-client-runner` / `ui-cordis` 已是这一模板的标准实现（参考 `packages/extensions/ui-cordis/src/client/index.ts:73-78`） | **不新增 wire payload**。改为：(1) `packages/host/plugin-inventory/src/types.ts` 的 `Events` 合并声明 `'plugin-inventory/changed'`；(2) `packages/api/remotes/src/remote-events.ts` 的 `API_REMOTE_FORWARDED_EVENTS` 加一行；(3) host Gateway 在 settings/updated 后 emit 该事件。客户端 `apply()` 用 `ctx.remote.$on('plugin-inventory/changed', ...)` 调 `inventoryStore.refresh()`，与 `ui-cordis` 完全同构 |
| R3 | §六 `useDebouncedToggle` 临时放 `ui-settings-plugin-inventory`，≥ 2 个 domain 才抽 `ui-toggleable` | `packages/client/AGENTS.md` rule 3："Cross-package imports of another plugin's symbols are in principle forbidden. The sanctioned routes are the slot system (register/renderSlot) and ctx services." —— skill/mcp/agent 跨包 import `ui-settings-plugin-inventory` 的 hook 直接违规 | 改为：本期就把 `useDebouncedToggle<TId>` 放 `packages/client/ui-primitives`，通用签名（`label/caption/status/checked/onCheckedChange` 风格），不另起 `ui-toggleable` 包 |
| R4 | §九 保留 `resetEnabled` 但 UI 不暴露 | `packages/AGENTS.md` "Require a current owner and need"："Tie each abstraction, state machine, option, defensive copy, and compatibility path to a current contract or production consumer" | 删除 `resetEnabled` @Remote；如未来需要再加，且必须配 UI 出口 |
| R5 | §十一 验收标准 §10 "所有现有测试通过 + 新增测试通过" | `packages/client/AGENTS.md` "Before you push: the local check ladder" 要求具体命令 | 改为引用 `pnpm run test:gui` + `DSH_SNAPSHOT=replay pnpm run test:web`，不写"全部通过" |

其他小修正：
- §二.1 `disabledReason` 字段：补充说明与 `enabled` 的正交关系（`enabled` 是布尔结果，`disabledReason` 是原因元数据）
- §八 风险表：`useEffect cleanup 强制 flush` 改为"unmount 时 abort in-flight + 清 timer，不强 flush 残留 debounce"
- §十一 验收 §11：`shadcn Switch` 改为"`@deepseek-ai/dsh-client-ui-primitives/Switch`"
- §十一 验收 §12：es-toolkit 改为"自实现 5 行 debounce；不引入新依赖"

---

## §一（修订）架构与数据流

```
Browser (ui-settings-plugin-inventory)
  apply() 注册时:
    createPluginInventoryStore(port, onError)
      ├ getSnapshot() → 上次读到的 entries 数组（缓存引用稳定）
      ├ subscribe(fn) → listeners 集合
      └ refresh()    → 单飞 RPC，调用 port.list()
                        成功 publish({entries, read:true})
                        失败保留旧 snapshot + 加 error 字段

    ctx.remote.$on('plugin-inventory/changed', () => {
      inventoryStore.refresh()           ← 由 ctx.effect() 包，自动卸载
    })
    ctx.on('connection/reset', () => inventoryStore.reset())  ← 重连重读

    通过 slots.inject 注册 PluginInventorySettingsTab:
      inject face: { hooks: { inventory: inventoryStore }, list, toggle, t, ... }

  PluginInventorySettingsTab (组件)
    ├ const snapshot = useSyncExternalStore(       ← 订阅声明的 store
    │     props.hooks.inventory.subscribe,         ←   模板见 ui-cordis
    │     props.hooks.inventory.getSnapshot,
    │   )
    ├ useDebouncedToggle({
    │     commit: props.toggle,
    │     debounceMs: 500,
    │     onError: flashError,
    │   })
    │   intended: Map<entryId, boolean>            ← 组件内乐观态（rule 4）
    │   timersRef / controllersRef                  ← 本地 debounce + abort
    └ <SwitchRow> + <StatusDot> + <SearchInput>    ← 全在 ui-primitives

         ▲                                          │
         │ events.host pluginInventory/changed       │
         │ (via ctx.remote.$dispatch → ctx.remote.$on)
         │                                          │ RPC (Typert)
         └──────────────────────────────────────────┤
                                                    ▼
Host (plugin-inventory)
  PluginInventoryGateway
    ├ @Remote('list')
    │   ├ loader.entries() 过滤 group
    │   ├ 叠加 settings.pluginInventory.enabled 覆盖
    │   └ 返回 entry.enabled / disabledReason / fiberPhase
    ├ @Remote('setEnabled')
    │   ├ settings.update('pluginInventory', { enabled: {...current, [id]: enabled} })
    │   └ entry.update({ disabled: !enabled })  立即影响 Loader
    └ settings-file watcher
        └ external edit / own write
              ├ settings/updated (settings-file emit)
              ├ ctx.on('settings/updated', (ns, next, prev) => {
              │   if (ns !== PLUGIN_INVENTORY_NS) return
              │   this.ctx.emit('plugin-inventory/changed')  ← 走 host/remote-event
              │ })
              └ loader events (entry.update 触发的 Cordis 事件)
                  可选: 也走 ctx.emit('plugin-inventory/changed') —— 见 §三

         ▲                                  │
         │ watcher 热发布                    │
         └──────────────────────────────────�
                                            ▼
~/.dsh/settings.yaml
  pluginInventory:
    enabled:
      '@deepseek-ai/dsh-host-tool-bash': false
```

### 点击 Switch 的完整流程（修订）

```
T0: user click → schedule(id, !current)
                  ├ intended.set(id, !current)          ← 乐观态
                  ├ clearTimeout(timers.get(id)); timers.set(id, setTimeout(...))
                  └ 立即 UI 反映 intended
T0+500ms: 无新点击 → flush(id, enabled)
              ├ controllers.get(id)?.abort()             ← 中止 in-flight
              ├ controllers.set(id, new AbortController())
              ├ props.toggle({ id, enabled }, { signal })  ← RPC
              │   host 端:
              │     1. settings.update(...)                ← 持久化
              │     2. entry.update({disabled})            ← Fiber 停/起
              │     3. settings/updated → emit 'plugin-inventory/changed'
              │     4. 走 API_REMOTE_FORWARDED_EVENTS → host/remote-event
              │     5. 推到 client → ctx.remote.$dispatch → inventoryStore.refresh()
              ├ on success: store.refresh() resolve → publish → useSyncExternalStore 触发 → intended 清空
              └ on failure: catch → rollback intended → flashError → 行红闪
```

### 关键订阅保证（修订版）

- **单一订阅源**：`useSyncExternalStore` 只订阅声明的 `inventoryStore`。`store.subscribe` / `store.getSnapshot` 由 apply() 装配并通过 inject face 暴露——符合 `packages/client/AGENTS.md` "An observable source keeps two identities stable"。
- **apply() 装配**：`ctx.remote.$on` 订阅和 `ctx.on('connection/reset')` 都在 `ctx.effect()` 里注册，卸载时自动取消——符合 `packages/AGENTS.md` "Registrations are reversible effects"。
- **没有第二个事实源**：组件不持有本地 `entries` state、不轮询、不 mirror。`useDebouncedToggle` 内部的 `intended` 是组件内乐观态（rule 4："Component-internal behavioral hooks that subscribe to nothing external are fine"），commit 成功后立即清空。
- **跟既有 `ui-cordis` 完全同构**：参考 `packages/extensions/ui-cordis/src/client/inventory.ts:54-113` 的 `createCordisInventory` 工厂 + `index.ts:73-82` 的 `$on` + `connection/reset` 装配。本次 pluginInventory 是 host-only、不带 panel 移除/retire 语义；删掉 `retire()`，保留 `refresh()` / `reset()` / `subscribe()` / `getSnapshot()` 即可。

---

## §二（修订）组件拆分

### 2.1 host 端（`packages/host/plugin-inventory`）

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/settings.ts` | 新建 | zod schema `pluginInventorySettingsSchema` |
| `src/index.ts` | 改 | Gateway 加 `setEnabled`；订阅 `settings/updated` → 调 `list()` → 推 `pluginInventory/changed`（只走 host→client 单向，不暴露 loader/* 原始事件） |
| `src/types.ts` | 改 | `PluginInventoryEntry` 加 `disabledReason: 'user' \| 'cordis' \| null` |
| `src/invariant.ts` | 改 | 增加 `disabledReason` 字段的事件/数据关系（每包必填，AGENTS.md rule "Every package owns `./invariant`"） |

### 2.2 client 端（`packages/client/ui-settings-plugin-inventory`）

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/client/PluginInventorySettingsTab.tsx` | 重写 | 容器：从 inject face 取 store + toggle + t；渲染 `<SwitchRow>` 列表 |
| `src/client/PluginInventoryRow.tsx` | 新建 | 单行：label + caption + `<StatusDot>` + `<Switch>` + error flash class |
| `src/client/PluginInventoryStatusDot.tsx` | 新建 | 包装 ui-primitives 的 `<StatusDot>`，注入领域文案 |
| `src/client/inventory-store.ts` | 新建 | `createPluginInventoryStore(connection, fetch)`——apply 装配，**不导出 store 实例**（AGENTS.md rule 6 "Stores: ...module-level handles are forbidden"） |
| `src/client/locales.ts` | 改 | 新增 `toggleError` / `disabledByUser` / `reason` 键 |

### 2.3 通用组件（`packages/client/ui-primitives`）

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/SwitchRow.tsx` | 新建 | 通用一行：`label + caption + <StatusDot> + <Switch>`；`entryId` 走 data-* |
| `src/StatusDot.tsx` | 新建 | 通用状态点：`phase + tooltip`；颜色由 phase 派生 |
| `src/SearchInput.tsx` | 新建 | 4 个列表都要的搜索输入（带 `IconSearch` + clear） |
| `src/useDebouncedToggle.ts` | 新建 | 通用 hook（修订 R3：放这里，不放 ui-settings-plugin-inventory） |
| `src/index.ts` | 改 | 导出上面四个 |

### 2.4 wire 协议（修订 R2——复用现有机制，零新增 frame）

**结论**：原 R2 提议"新增 wire payload"是错的——现有 `host/remote-event` 通用包装帧 + 白名单转发机制已经覆盖本场景，参考 [`2026-08-10-remote-event-delivery.md`](../../../.agents/notes/implemented/architecture/2026-08-10-remote-event-delivery.md)（implemented）。

本次改动只动三处：

| 文件 | 改动 |
|---|---|
| `packages/host/plugin-inventory/src/types.ts` | `Events` 合并声明：`'plugin-inventory/changed'(entries: PluginInventoryEntry[]): void` |
| `packages/api/remotes/src/remote-events.ts` | `API_REMOTE_FORWARDED_EVENTS` 加 `'plugin-inventory/changed'` |
| `packages/host/plugin-inventory/src/index.ts` | `ctx.on('settings/updated', ...)` 钩里 `this.ctx.emit('plugin-inventory/changed')` |

转发链路完全复用：
- host 端 emit → `apiproxy/api-proxy.ts:3708` 的 `API_REMOTE_FORWARDED_EVENTS.map(name => ctx.on(...))` 自动包成 `host/remote-event`
- client 端 `ConnectionController` 通过现有 `/api/events.host` SSE 收到 → `client/runtime/src/client/index.ts:216` 的 `ctx.remote.$dispatch(frame.event, frame.args)` → `ctx.remote.$on('plugin-inventory/changed', listener)` 触发

`SessionManager` 不感知（plugin inventory 是 host-frame-scope，不是 session-scope）。`ConnectionController` 无需改 mux 分支（`host/remote-event` 已存在）。

**TypeScript 编译保证**：新增事件名必须出现在 `API_REMOTE_FORWARDED_EVENTS`（value）才能进 wire；同一数组又是 `ctx.remote.$on` 的合法键面，类型投影在 `packages/api/remotes/src/types.ts` 派生——三处自动同步，不可能漂移。

---

## §三（修订）持久化 Schema

不变，沿用原 spec §三。

补充：`disabledReason` 在 `enabled: true` 时仍可能为 `null`（无原因）或 `cordis`（loader 内部禁用）；`enabled: false` 时必为 `user` 或 `cordis`。二者正交：`enabled` 是结果，`disabledReason` 是原因元数据。

---

## §四（修订）错误处理

不变，沿用原 spec §四。

错误 2a 行为调整：rollback Switch + Toast + 行红闪 1.5s；不修改 list 的 `committedState`（避免和 in-flight 的 `pluginInventory/changed` 推送打架）。

错误 2c "用户 abort 旧 RPC"：console.debug，UI 无变化——保留。

---

## §五（修订）测试覆盖

沿用原 spec §五 的 5 层结构。补充：

- **per-file coverage**：每个新文件（`inventory-store.ts` / `SwitchRow.tsx` / `StatusDot.tsx` / `useDebouncedToggle.ts`）必须有 100% 覆盖，对应 `packages/AGENTS.md` 和 `packages/client/AGENTS.md` "Testing and coverage" 节。
- **unrelated defensive arms**：若真有不可达分支（`/* v8 ignore -- <reason> */`），写明理由，禁止裸 ignore。
- **component specs 必须断言行为**：render 数、className 不算；断言 user-visible output。

---

## §六（修订）可复用性 — skill / mcp / agent 怎么搭顺风车

### 抽离矩阵（修订 R3）

| 代码 | 抽到哪里 | 原因 |
|---|---|---|
| `<SwitchRow>` | `packages/client/ui-primitives/src/SwitchRow.tsx` | 4 个列表都要，纯 UI |
| `<StatusDot>` | `packages/client/ui-primitives/src/StatusDot.tsx` | 4 个列表都要 |
| `<SearchInput>` | `packages/client/ui-primitives/src/SearchInput.tsx` | 4 个列表都要 |
| `useDebouncedToggle<TId>` | **`packages/client/ui-primitives/src/useDebouncedToggle.ts`** | 4 个列表都要；按 AGENTS.md rule 3，跨包 import 禁止，放 ui-primitives 是唯一合规路径 |
| 错误处理 + Toast 模式 | 各 domain 各自复制（10 行代码） | — |
| settings overlay schema | **不抽**（每个 domain 一个 namespace） | — |

### `useDebouncedToggle<TId>` 签名（最终版）

```typescript
// packages/client/ui-primitives/src/useDebouncedToggle.ts
export interface DebouncedToggleAction<TId extends string = string> {
  readonly entryId: TId
  readonly enabled: boolean
}

export interface UseDebouncedToggleOptions<TId extends string> {
  /** RPC commit handler; receives a fresh AbortSignal for every flush. */
  readonly commit: (action: DebouncedToggleAction<TId>, signal: AbortSignal) => Promise<void>
  /** Default 500. */
  readonly debounceMs?: number
  /** Invoked on commit failure (excluding abort). */
  readonly onError?: (action: DebouncedToggleAction<TId>, error: unknown) => void
  /** Optional no-op skip: when `intended === committed`, do not call commit. */
  readonly isCommitted?: (entryId: TId, intended: boolean) => boolean
}

export interface UseDebouncedToggleApi<TId extends string> {
  readonly isPending: (entryId: TId) => boolean
  readonly schedule: (entryId: TId, enabled: boolean) => void
  /** Abort all in-flight and clear pending timers. Does NOT force-flush. */
  readonly reset: () => void
}
```

### 后续 domain 工作量预估（修订）

| Domain | Gateway 工作量 | UI 工作量 | 复用率 |
|---|---|---|---|
| pluginInventory（本期） | 1 个 Gateway + 1 个 zod schema | 1 个 tab | — |
| skill | 1 个 Gateway + 1 个 zod schema | 1 个 tab，复用 `<SwitchRow>` / `<StatusDot>` / `useDebouncedToggle` | 80% |
| mcp | 同上 | 同上 | 80% |
| agent | 同上 | 同上 | 80% |

**不再单独抽 `ui-toggleable` 包**——`useDebouncedToggle` 直接住 ui-primitives。

---

## §七 关键设计决策

沿用原 spec §七。补充：
- **store 形态**：声明的 `createPluginInventoryStore()` 工厂（`packages/client/ui-primitives` 风格的 store engine：zustand/immer + `defineStore` + `shallowEqual`）；实例由 apply() 创建并通过 inject face 暴露（rule 6）。
- **wire 协议**：host→client 单向 push，不开放 loader/* 原始事件。

---

## §八（修订）风险与缓解

沿用原 spec §八。

补充：
- **Tab unmount 丢失 pending**：`useDebouncedToggle.reset()` 在 unmount 时 abort in-flight + 清 timer，**不**强 flush（保留原 spec "不完美但可接受"，但措辞更准确——原 spec 写"useEffect cleanup 强制 flush"是错误语义）。
- **es-toolkit 依赖**：本期**不引入**。5 行 debounce 自实现（`setTimeout` + cleanup），参考既有 `notifier.ts` 的 microtask flush 风格。

---

## §九（修订）不在本次范围

沿用原 spec §九。

调整：
- ❌ ~~重置按钮（稿 2，本次先不做；`resetEnabled` RPC 已实现备用）~~ —— **删除整条**（修订 R4）。`resetEnabled` 不实现、不留白。要重置就走 settings UI。
- 其他不变。

---

## §十 验收标准

沿用原 spec §十。

调整：
- ❌ ~~所有现有测试通过 + 新增测试通过~~ → 改为："`pnpm run test:gui` 通过；新增 spec 的 per-file 覆盖达 100%（`pnpm run test:coverage` 抽样验证）"
- ✅ shadcn `Switch` 组件被使用 → 改为："`@deepseek-ai/dsh-client-ui-primitives/Switch` 被使用"
- ❌ ~~es-toolkit `debounce` 被使用~~ → 删除（不引入新依赖）

---

## §十一（修订）改动文件清单

| 包 | 文件 | 改动类型 | 对应修订 |
|---|---|---|---|
| `host/plugin-inventory` | `src/settings.ts` | 新建 | — |
| `host/plugin-inventory` | `src/index.ts` | 改 | R2 |
| `host/plugin-inventory` | `src/types.ts` | 改 | — |
| `host/plugin-inventory` | `src/invariant.ts` | 改 | — |
| `host/plugin-inventory` | `tests/plugin-inventory-gateway.spec.ts` | 新建 | — |
| `api/remotes` | `src/remote-events.ts` | 改 | R2（加 `'plugin-inventory/changed'` 到白名单） |
| `client/ui-settings-plugin-inventory` | `src/client/PluginInventorySettingsTab.tsx` | 重写 | R1 |
| `client/ui-settings-plugin-inventory` | `src/client/PluginInventoryRow.tsx` | 新建 | R1 |
| `client/ui-settings-plugin-inventory` | `src/client/PluginInventoryStatusDot.tsx` | 新建 | — |
| `client/ui-settings-plugin-inventory` | `src/client/inventory-store.ts` | 新建 | R1 |
| `client/ui-settings-plugin-inventory` | `src/client/locales.ts` | 改 | — |
| `client/ui-settings-plugin-inventory` | `tests/*` | 新建/改 | — |
| `client/ui-primitives` | `src/SwitchRow.tsx` | 新建 | — |
| `client/ui-primitives` | `src/StatusDot.tsx` | 新建 | — |
| `client/ui-primitives` | `src/SearchInput.tsx` | 新建 | — |
| `client/ui-primitives` | `src/useDebouncedToggle.ts` | 新建 | R3 |
| `client/ui-primitives` | `src/index.ts` | 改 | R3 |
| `client/ui-primitives` | `tests/*` | 新建 | — |
| `apps/web/tests` | `plugin-inventory-toggle.e2e.ts` | 新建 | — |

> **R2 改后归零**：原 R2 提议需要的 5 个文件（`host/apiproxy/src/api/plugin-inventory-event.ts` / `host/apiproxy/src/fetch/handler.ts` / `host/apiproxy/tests/...` / `client/connection/src/client/connection.ts` / `client/runtime/src/client/sessions/manager.ts`）全部不需要改。R2 真正落地的只有 `api/remotes/src/remote-events.ts` 加一行字符串——这一行就驱动了 host 端 emit → apiproxy 转发 → client runtime `$dispatch` → `ctx.remote.$on` 的整条链路。

---

## §十二（新增）跟 Agent Note 体系的对应

按根 `AGENTS.md`：
> Non-trivial changes MUST include an Agent Note in the same PR; only mechanical/local edits are exempt

本次修订对应一条 Agent Note，建议落点：

- 路径：`.agents/notes/proposed/architecture/2026-08-18-plugin-inventory-toggle-store-subscription.md`
- Status: `proposed`（未实现）
- 类：`architecture`（影响客户端订阅模型 + 复用 host→client remote-event 现有机制，属于结构性决策）
- 必要 section：`## Problem` / `## Proposal` / `## Consequences` / `## Verification`（proposed 模板）

`docs/superpowers/specs/` 不是 repo canonical tier（`docs/AGENTS.md` tier 表未列）。本 spec 落地后，建议把两个 spec 文件（17 日原版 + 18 日修订）一起搬到 `.agents/notes/archived/architecture/2026-08-17-...` 三联体（English / Chinese / sidecar），按 `.agents/notes/README.md` 归档规则处理。原 spec 文件可保留作为 superpowers 流程产物，但不再作为设计决定依据。

---

## §十三（新增）跟原 spec 的兼容性

原 spec 已被本修订版取代。下表给出**唯一必须保持兼容**的项：

| 项 | 值 | 用途 |
|---|---|---|
| `settings.yaml` 路径 | `pluginInventory.enabled.<entryId>` | 用户数据，不破坏已写入的 key |
| `@Remote('list')` 响应字段 | `entries[].{ entryId, moduleName, enabled, fiberPhase, disabledReason }` | 新增 `disabledReason` 字段——非破坏，向后兼容旧 client（多读一个字段） |
| slot 注册名 | `'settings.plugins.tab'` | 不变 |

**移除/破坏**：
- � `PluginInventoryGateway.@Remote('resetEnabled')`——删除，已无 owner
- ❌ 客户端直接订阅 host 事件通道（不存在）——从未生效

---

## §十四（修订）实施顺序建议

1. `api/remotes/src/remote-events.ts` 加 `'plugin-inventory/changed'`（**wire 协议入口**，先加，否则后续 host/client 编译不过）
2. `host/plugin-inventory/src/types.ts` 声明 `Events`，`host/plugin-inventory/src/index.ts` 加 `setEnabled` + `ctx.on('settings/updated', ...)` → `ctx.emit('plugin-inventory/changed')`
3. `client/ui-primitives` 加 `SwitchRow` / `StatusDot` / `SearchInput` / `useDebouncedToggle`（先于 ui-settings-plugin-inventory 落地）
4. `client/ui-settings-plugin-inventory` 重写 Tab + 新建 inventory-store（参考 `extensions/ui-cordis/src/client/inventory.ts` 模板）
5. e2e：`apps/web/tests/plugin-inventory-toggle.e2e.ts`
6. snapshot 录制：`DSH_SNAPSHOT=record pnpm run test:snapshot` 覆盖 `apps/web/tests` 行为

**第 1 步是关键依赖**：白名单必须先就位，否则 host 端 emit 的事件没人转发；client 端 `ctx.remote.$on('plugin-inventory/changed', ...)` 也编译不过（Typert 类型投影读 `API_REMOTE_FORWARDED_EVENTS` 派生 `TypertRemoteEvent`）。

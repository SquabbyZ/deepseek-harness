# 插件列表 · 动态启停 + 持久化 设计

> 需求来源：用户反馈 Settings → 插件 → 插件列表 tab 当前只读、字段堆叠（已启动/已停止、include、配置状态、已启用、Cordis 状态、已挂载）且 2 列卡片网格视觉过载，需要简化为单行列表 + 动态启停 Switch；后续 skill / mcp / agent 列表要复用同一套机制。

## 目标与硬约束

1. **动态启停**：UI 切换立即反映到当前 host 进程的 Cordis Loader（Fiber 卸载/重启），不需要重启 dsh。
2. **持久化**：切换写入 `~/.dsh/settings.yaml`，重启后保持上次状态。
3. **防抖**：连点 N 次 Switch 只发 1 次 RPC，避免 Loader 抖动和不必要的写盘。
4. **失败回滚**：RPC 失败时 Switch 翻回原状态 + Toast 报错。
5. **可复用**：hooks 和 UI 组件按"通用"写，skill/mcp/agent 列表复用同一套（≥2 个 domain 使用时再抽 `ui-toggleable` 包）。
6. **不破坏现有契约**：cordis.yml 保持只读、CLI/TUI 行为不变；只是新增一个 settings 覆盖层。
7. **shadcn 优先**：Switch 复用项目已有的 `@deepseek-ai/dsh-client-ui-primitives` 的 `Switch` 组件。

---

## 现状（关键事实）

- 目标文件：`packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx`（225 行，2 列卡片网格，可展开看详情）。
- 数据源：`packages/host/plugin-inventory/src/index.ts` 的 `PluginInventoryGateway` —— 只暴露 `@Remote('list')`，**没有 setEnabled/toggle**。
- Cordis Loader API：`entry.update({ disabled })` 支持运行时启停，但 **根 `Loader.write()` 是 no-op**（`vendor/loader/src/index.ts:162-164`），所以 cordis.yml 不会写回。
- shadcn 组件：当前已用 `ShadcnButton` + `ShadcnInput`；`Switch` 在 `ui-primitives` 已导出可用。
- settings-file：项目里所有用户可调的运行时配置都走 `~/.dsh/settings.yaml`，有 watcher + 热发布 + 原子写 + 文件锁。本次新增一个 namespace 即可，零基础设施改动。
- Toast：`ui-primitives/Toast.tsx` 提供 transient banner 组件（owner 维护 state，3 秒 hold + 1 秒 fade），已有 `ModelSelect` 走这个模式。

---

## 一、架构与数据流

```
Browser (ui-settings-plugin-inventory)
  PluginInventorySettingsTab
    ├ usePluginInventoryList(remote)
    │    └ useSyncExternalStore 订阅 host 推送的 loader/init
    │      loader/partial-dispose / loader/failed / inventory/changed
    ├ usePluginToggle({ remote, debounceMs: 500 })
    │    ├ intended: Map<entryId, boolean>    ← React useState + startTransition
    │    ├ timersRef: Map<entryId, Timeout>   ← 每次 schedule 重置
    │    ├ controllersRef: Map<entryId, AbortController>  ← 新 schedule abort 旧的
    │    └ onError → flashError() + Toast
    └ <SwitchRow> + <StatusDot> + <SearchInput>  ← 全部抽到 ui-primitives

        ▲                                  │
        │ events:                          │ RPC
        └──────────────────────────────────┤
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
    └ @Remote('resetEnabled')   ← 可选，本期 UI 不暴露
        ├ settings.update (删除 key)
        └ entry.update({ disabled: false })

        ▲                                  │
        │ watcher 热发布                    │
        └──────────────────────────────────┤
                                           ▼
~/.dsh/settings.yaml
  pluginInventory:
    enabled:
      '@deepseek-ai/dsh-host-tool-bash': false
      '@deepseek-ai/dsh-host-tool-skill': false
```

### 点击 Switch 的完整流程

```
T0: user click → 乐观更新 intended[id] = !current（startTransition 低优）
T0+500ms: 无新点击 → flush(entryId, enabled)
              ├ controllersRef.get(id).abort()        ← 中止任何 in-flight
              ├ new AbortController()                  ← 新 controller
              ├ remote.setEnabled({id, enabled}, {signal})
              │   host 端:
              │     1. settings.update(...)             ← 持久化 + 通知 watcher
              │     2. entry.update({disabled: !enabled}) ← 立即停/起 Fiber
              │   host emit loader/partial-dispose 或 loader/init
              ├ on success: client usePluginInventoryList 收到事件 → refetch → 新 snapshot → intended 清空 → UI 显示 committed
              └ on failure: catch → rollback intended → Toast → 短暂红闪
```

### 关键 Fiber 风格保证

- **双缓冲**：`intendedState`（workInProgress）+ `committedState`（来自 list）→ UI 渲染 `intended[id] ?? snapshot.enabled`
- **可中断**：`startTransition` 标记 toggle 为低优，React 可打断让位给 list() 推送
- **可中止**：AbortController 取消 in-flight RPC，新 toggle 不会叠加旧 toggle 的副作用
- **订阅式快照**：`useSyncExternalStore` 保证 commit 阶段一致 read

---

## 二、组件拆分

### 2.1 host 端（`packages/host/plugin-inventory`）

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/settings.ts` | 新建 | zod schema `pluginInventorySettingsSchema` |
| `src/index.ts` | 改 | Gateway 加 `setEnabled` / `resetEnabled`，订阅 settings 变化 emit `inventory/changed` |
| `src/types.ts` | 改 | `PluginInventoryEntry` 加 `disabledReason: 'user' \| 'cordis' \| null` |

### 2.2 client 端（`packages/client/ui-settings-plugin-inventory`）

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/client/PluginInventorySettingsTab.tsx` | 重写 | 容器：组合 hooks + 渲染列表 |
| `src/client/usePluginInventoryList.ts` | 新建 | useSyncExternalStore 订阅 host 推送；refetch on focus + 30s 心跳 |
| `src/client/usePluginToggle.ts` | 新建 | debounce + AbortController + startTransition + unmount flush |
| `src/client/PluginInventoryRow.tsx` | 新建 | 单行渲染（SwitchRow 封装） |
| `src/client/PluginInventoryStatusDot.tsx` | 新建 | 状态点（StatusDot 封装 + 领域文案） |
| `src/client/locales.ts` | 改 | 新增 `toggleError` / `disabledByUser` / `reason` 键 |

### 2.3 通用组件（`packages/client/ui-primitives`）

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/SwitchRow.tsx` | 新建 | 通用一行 = label + caption + status dot + Switch + entryId data-* |
| `src/StatusDot.tsx` | 新建 | 通用状态点 = 颜色 + tooltip 文案 |
| `src/index.ts` | 改 | 导出上面两个 |

---

## 三、持久化 Schema

### 3.1 settings.yaml 形态

```yaml
# ~/.dsh/settings.yaml
pluginInventory:
  enabled:
    '@deepseek-ai/dsh-host-tool-bash': false          # 用户停用
    '@deepseek-ai/dsh-host-tool-skill': false         # 用户停用
    # 没出现过的条目 → 跟 cordis.yml 默认（即 ON）
```

**采用增量 Record 形态**：
- 全量 Record（每次新增插件都要同步写 settings）— ❌
- 反 record `[disabled]` 数组 — ❌（无法表达"启用覆盖"）
- 增量 Record `{ [entryId]: enabled }` — ✅（默认不落键，重置即删键）

### 3.2 schema 定义

```typescript
// packages/host/plugin-inventory/src/settings.ts
import { z } from 'zod'

export const pluginInventoryEnabledSchema = z.record(z.string(), z.boolean())

export const pluginInventorySettingsSchema = z.object({
  enabled: pluginInventoryEnabledSchema.default({}),
})

export type PluginInventorySettings = z.infer<typeof pluginInventorySettingsSchema>

export const PLUGIN_INVENTORY_NS = 'pluginInventory' as const
```

### 3.3 list() 投影逻辑

```typescript
@Remote('list')
list(): PluginInventorySnapshot {
  const overrides = ctx.settings.get(PLUGIN_INVENTORY_NS).enabled   // Record<entryId, boolean>
  return {
    entries: this.ctx.loader.entries()
      .filter(entry => !entry.options.group)
      .map(entry => {
        const cordisDisabled = entry.disabled
        const userOverride = overrides[entry.entryId]
        const effective = userOverride !== undefined ? userOverride : !cordisDisabled
        const disabledReason =
          userOverride === false ? 'user' as const
          : cordisDisabled === true ? 'cordis' as const
          : null
        return {
          entryId: entry.entryId,
          moduleName: entry.options.name,
          enabled: effective,
          disabledReason,
          fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
        }
      })
  }
}
```

### 3.4 setEnabled 写流

```typescript
@Remote('setEnabled')
async setEnabled({ entryId, enabled }: { entryId: string; enabled: boolean }, ctx: Context): Promise<void> {
  const current = ctx.settings.get(PLUGIN_INVENTORY_NS)
  await ctx.settings.update(PLUGIN_INVENTORY_NS, {
    ...current,
    enabled: { ...current.enabled, [entryId]: enabled },
  })

  const entry = this.ctx.loader.entries().find(e => e.id === entryId)
  if (entry === undefined) throw new RpcError('plugin-not-found', `unknown entry: ${entryId}`)
  await entry.update({ disabled: !enabled })
}
```

### 3.5 与 cordis.yml 的边界

| 资源 | 真相源 | 谁拥有 |
|---|---|---|
| 哪些插件被加载 | `cordis.yml` | host 部署 |
| 这些插件当前启/停 | `settings.yaml` 的 `pluginInventory.enabled` 覆盖 + cordis.yml 默认 | 用户 |
| 插件的配置（如 API key） | `settings.yaml` 的 `BashCard` 等命名空间 | 用户/插件 owner |

**关键不变量**：`settings.yaml` 的 `pluginInventory.enabled` 不能记录一个 cordis.yml 里不存在的插件 entryId；本次不做主动 GC，留待后续。

### 3.6 数据迁移

settings-file 向后兼容读：
- 旧 settings.yaml 没 `pluginInventory` 段 → 读取时 zod 用 default `{}`
- 新增字段同理 default

**不需要迁移代码**。

---

## 四、错误处理

| # | 失败场景 | 行为 | UI 表现 |
|---|---|---|---|
| 1 | `list()` RPC 失败 | 顶部错误条 + ↻ 重试，**保留**上次列表 | error banner + 旧列表可见 |
| 2a | settings 写盘失败 | 回滚 Switch + 顶部 Toast + 行红闪 1.5s | Toast + 行 className 切换 |
| 2b | `entry.update` 抛错 | 同 2a | 同 2a |
| 2c | 用户 abort 旧 RPC（预期） | console.debug，UI 无变化 | 无 |
| 3 | Loader 推送事件丢失 | focus 时 refetch + 30s 心跳 | 无（兜底） |
| 4 | settings.yaml 外部编辑 | settings-file watcher → Gateway emit `inventory/changed` → client refetch | UI 自动同步 |
| 5a | 孤儿 settings key | list() 看不到，静默忽略 | 无 |
| 5b | 切换中插件被 cordis 卸载 | entry.update 抛 `entry-not-found` → 走 2b | Toast + 回滚 |

### Toast 模式（参考 ModelSelect）

```typescript
const [errorToast, setErrorToast] = useState<{ seq: number; text: string } | null>(null)
const toastSeq = useRef(0)

// flashError:
toastSeq.current += 1
setErrorToast({ seq: toastSeq.current, text: t('toggleError', { name, reason }) })

// render:
{errorToast && (
  <Toast
    key={errorToast.seq}
    text={errorToast.text}
    icon={<IconWarningOutline16 />}
    anchor={rootRef.current}
    onDone={() => setErrorToast(null)}
  />
)}
```

---

## 五、测试覆盖

### Layer 1: Host `PluginInventoryGateway`

```
list:
  - returns cordis-enabled entries with enabled=true by default
  - overlays user-disabled overrides from settings
  - marks disabledReason='user' when override exists
  - marks disabledReason='cordis' when cordis disabled but entry still in tree
  - ignores orphaned override keys
  - skips group entries
  - returns null fiberPhase for entries with no fiber
  - maps FiberState to PluginFiberPhase correctly

setEnabled:
  - persists user override to settings.pluginInventory.enabled
  - calls entry.update({ disabled: !enabled })
  - throws plugin-not-found for unknown entryId
  - rolls back settings if entry.update throws

pluginInventorySettingsSchema:
  - accepts missing pluginInventory key (backward compat)
  - accepts empty enabled record
  - rejects non-boolean values
```

### Layer 2: settings-file 集成

```
pluginInventory persistence:
  - round-trips user overrides through settings.yaml write/read
  - hot-publishes external edits and triggers inventory refetch
  - atomic write preserves unrelated settings sections
```

### Layer 3: Browser hooks

```
usePluginInventoryList:
  - fetches initial list on mount
  - refetches when host emits loader/init / loader/partial-dispose / loader/failed / inventory/changed
  - refetches on window focus
  - refetches every 30s (heartbeat, fake timers)
  - cleans up timers on unmount
  - keeps previous snapshot on list() error

usePluginToggle:
  - optimistically updates intended state immediately
  - debounces 500ms before flushing RPC
  - coalesces 5 rapid clicks into 1 RPC
  - aborts previous RPC when new click arrives during in-flight
  - flushes pending toggles on unmount
  - invokes onError callback on RPC failure
  - clears intended state after commit success
  - does not call RPC if same intended as committed (no-op)

useResolvedEntries:
  - merges intended on top of snapshot
  - falls back to snapshot when no intended for entryId
```

### Layer 4: UI 组件

```
PluginInventoryRow:
  - renders moduleName, status dot, and Switch
  - Switch reflects entry.enabled
  - Switch disabled when fiberPhase is loading/unloading
  - clicking Switch calls onToggle with !current
  - shows pending spinner when isPending=true
  - shows error flash class when error
  - tooltip on status dot explains disabledReason

PluginInventoryStatusDot:
  - green dot for active phase
  - blue dot for loading phase
  - red dot for failed phase
  - gray dot for pending/disposed
  - tooltip copy differs by phase

PluginInventorySettingsTab (integration):
  - renders loading state on initial mount
  - renders error state with retry on list() failure
  - renders empty state when no plugins
  - renders empty search state when no matches
  - search input filters by moduleName
  - toggle flow: click → debounce → flush → snapshot update
  - error flow: RPC fail → rollback → toast appears
```

### Layer 5: E2E

`apps/web/tests/plugin-inventory-toggle.e2e.ts`：
- 启动 dsh → 打开 Settings → 切换一个插件 → 验证 `~/.dsh/settings.yaml` 出现新键 → 重启 dsh → 验证状态保留

---

## 六、可复用性 — skill / mcp / agent 怎么搭顺风车

### 抽离矩阵

| 代码 | 抽到哪里 | 原因 |
|---|---|---|
| `<SwitchRow>` | `packages/client/ui-primitives/src/SwitchRow.tsx` | 4 个列表都要，纯 UI |
| `<StatusDot>` | `packages/client/ui-primitives/src/StatusDot.tsx` | 4 个列表都要 |
| `<SearchInput>`（可选） | `packages/client/ui-primitives/src/SearchInput.tsx` | 4 个列表都要 |
| `useDebouncedToggle` hook | 临时放 `ui-settings-plugin-inventory` 里 export，**签名按通用写**；≥ 2 个 domain 使用时抽到 `ui-toggleable` 新包 | 4 个列表都要 |
| 错误处理 + Toast 模式 | 各 domain 各自复制（10 行代码） | — |
| settings overlay schema | **不抽**（每个 domain 一个 namespace） | — |

### 通用 `<SwitchRow>` 签名

```typescript
interface SwitchRowProps {
  label: string                                    // 主标签
  caption?: string                                  // 副文本（"加载中…"等）
  status?: { phase: 'active' | 'loading' | 'failed' | 'pending'; tooltip: string }
  checked: boolean
  disabled?: boolean
  entryId?: string                                  // data-* 用于 e2e
  onCheckedChange: (checked: boolean) => void
}
```

### 通用 `useDebouncedToggle<TId>` 签名

```typescript
interface ToggleAction<TId extends string = string> {
  entryId: TId
  enabled: boolean
}

interface UseDebouncedToggleOptions<TId extends string> {
  commit: (action: ToggleAction<TId>, signal: AbortSignal) => Promise<void>
  debounceMs?: number   // default 500
  onError?: (action: ToggleAction<TId>, error: Error) => void
}

interface UseDebouncedToggleApi<TId extends string> {
  isPending: (entryId: TId) => boolean
  schedule: (entryId: TId, enabled: boolean) => void
  flush: () => void
}
```

### 后续 domain 工作量预估

| Domain | Gateway 工作量 | UI 工作量 | 复用率 |
|---|---|---|---|
| pluginInventory（本期） | 新建 1 个 Gateway，1 个 zod schema | 1 个 tab | — |
| skill | 新建 1 个 Gateway + 1 个 zod schema | 1 个 tab，复用 `<SwitchRow>` + `useDebouncedToggle` | 80% |
| mcp | 同上 | 同上 | 80% |
| agent | 同上 | 同上 | 80% |

**判断阈值**：`useDebouncedToggle` 在 ≥ 2 个 domain 使用时抽到 `ui-toggleable` 包。

---

## 七、关键设计决策

| 决策 | 选择 | 替代方案 |
|---|---|---|
| 持久化机制 | settings namespace（路径 B） | 写 cordis.yml / 独立 json |
| 持久化形态 | 增量 `Record<id, boolean>` | 全量 / 反 record / per-entry |
| 切换实现 | entry.update({disabled}) + settings 双写 | 仅 settings / 仅 cordis |
| Debounce 策略 | 500ms + 重置 + unmount flush | 仅基础 debounce |
| 并发控制 | AbortController 取消旧 RPC | 仅 clear 旧 timer |
| 订阅模式 | useSyncExternalStore + 事件推送 | 轮询 |
| 错误反馈 | Toast 组件 + 行红闪 | alert / 不提示 |
| 通用化 | SwitchRow / StatusDot 抽到 ui-primitives | 各自实现 |
| UI 复杂度 | 稿 1（极简流，一行一项） | 稿 2（带重置）/ 稿 3（分组折叠） |

---

## 八、风险与缓解

| 风险 | 缓解 |
|---|---|
| Loader.entries() 在切换时 race（entry 被外部卸载） | entry.update 抛错走 2b 错误路径 |
| settings-file watcher 在大量 toggle 时频繁回调 | 30s 心跳兜底 + window focus refetch + transition 标记 toggle 为低优 |
| Tab unmount 期间丢失 pending | useEffect cleanup 强制 flush（不完美但可接受） |
| React 18.2 没有 `useOptimistic` | 用 `useState` + `startTransition` 自实现等价语义 |
| es-toolkit 没作为 direct dep | 加到 `ui-settings-plugin-inventory` 的 deps（项目里已经在 `node_modules/.pnpm/es-toolkit@1.49.0` 间接用到，但本次需在 `package.json` 显式声明） |

---

## 九、不在本次范围

- skill / mcp / agent 列表（本次只做 plugin，但 hooks/组件按通用化设计）
- 分组折叠（稿 3，插件数量少不值得）
- 重置按钮（稿 2，本次先不做；`resetEnabled` RPC 已实现备用）
- Loader 单元的 stats（内存占用、错误计数）
- 孤儿 settings key 的主动 GC

---

## 十、验收标准

1. ✅ 列表每行 1 个插件，模块名 + 状态点 + Switch
2. ✅ Switch 立即翻转（乐观），500ms 防抖
3. ✅ 连点 N 次只发 1 次 RPC
4. ✅ 切换写到 `~/.dsh/settings.yaml` 的 `pluginInventory.enabled.<entryId>`
5. ✅ 当前进程立即生效（Cordis Fiber 停/起）
6. ✅ 重启 dsh 后状态保留
7. ✅ 切换失败 → Switch 回滚 + 顶部 Toast 报错 + 行红闪
8. ✅ 外部编辑 settings.yaml → UI 自动同步
9. ✅ 焦点回到 tab / 30s 心跳 → 兜底 refetch
10. ✅ 所有现有测试通过 + 新增测试通过
11. ✅ shadcn `Switch` 组件被使用（不写自定义 switch）
12. ✅ es-toolkit `debounce` 被使用（或自实现等价）

---

## 十一、改动文件清单

| 包 | 文件 | 改动类型 |
|---|---|---|
| `host/plugin-inventory` | `src/settings.ts` | 新建 |
| `host/plugin-inventory` | `src/index.ts` | 改 |
| `host/plugin-inventory` | `src/types.ts` | 改 |
| `host/plugin-inventory` | `tests/plugin-inventory-gateway.spec.ts` | 新建 |
| `client/ui-settings-plugin-inventory` | `src/client/PluginInventorySettingsTab.tsx` | 重写 |
| `client/ui-settings-plugin-inventory` | `src/client/usePluginInventoryList.ts` | 新建 |
| `client/ui-settings-plugin-inventory` | `src/client/usePluginToggle.ts` | 新建 |
| `client/ui-settings-plugin-inventory` | `src/client/PluginInventoryRow.tsx` | 新建 |
| `client/ui-settings-plugin-inventory` | `src/client/PluginInventoryStatusDot.tsx` | 新建 |
| `client/ui-settings-plugin-inventory` | `src/client/locales.ts` | 改 |
| `client/ui-settings-plugin-inventory` | `tests/usePluginInventoryList.client.spec.tsx` | 新建 |
| `client/ui-settings-plugin-inventory` | `tests/usePluginToggle.client.spec.tsx` | 新建 |
| `client/ui-settings-plugin-inventory` | `tests/PluginInventoryRow.client.spec.tsx` | 新建 |
| `client/ui-settings-plugin-inventory` | `tests/browser-plugin.client.spec.tsx` | 改（适配新结构） |
| `client/ui-primitives` | `src/SwitchRow.tsx` | 新建 |
| `client/ui-primitives` | `src/StatusDot.tsx` | 新建 |
| `client/ui-primitives` | `src/index.ts` | 改（导出上面两个） |
| `client/ui-primitives` | `tests/SwitchRow.client.spec.tsx` | 新建 |
| `client/ui-primitives` | `tests/StatusDot.client.spec.tsx` | 新建 |
| `apps/web/tests` | `plugin-inventory-toggle.e2e.ts` | 新建 |

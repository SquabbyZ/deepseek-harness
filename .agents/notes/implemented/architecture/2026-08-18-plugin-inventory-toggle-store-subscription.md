# Agent Note: Settings plugin-inventory toggle — store-subscription pattern over host remote events

Status: implemented
Implemented: 2026-08-18
Implements: [`2026-08-18-plugin-inventory-toggle-design-rev1.md`](../../../docs/superpowers/specs/2026-08-18-plugin-inventory-toggle-design-rev1.md)

English | [中文](2026-08-18-plugin-inventory-toggle-store-subscription.zh.md)

## Problem

Settings → 插件 → 插件列表 tab is currently a read-only 2-column card grid ([`packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx`](../../../../packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx)) backed by [`packages/host/plugin-inventory`](../../../../packages/host/plugin-inventory/) `PluginInventoryGateway.@Remote('list')`. User feedback wants:

1. **Dynamic enable/disable**: Switch click → immediate Cordis Fiber stop/start → no `dsh` restart.
2. **Persistence**: Toggle writes `~/.dsh/settings.yaml`; survives `dsh` restart.
3. **Debounce**: N rapid clicks coalesce to 1 RPC; in-flight RPC must abort on new click.
4. **Failure rollback**: Switch reverts + Toast + row flash on RPC failure.
5. **Reuse**: skill / mcp / agent lists adopt the same mechanism.

The original design (`docs/superpowers/specs/2026-08-17-plugin-inventory-toggle-design.md`) proposed `usePluginInventoryList` using `useSyncExternalStore` to subscribe directly to host-pushed events (`loader/init`, `loader/partial-dispose`, `loader/failed`, `inventory/changed`). Review against [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) surfaced two hard problems:

- **Subscription discipline**: `packages/client/AGENTS.md` reactive-read rule 2 forbids business components from "no `useSyncExternalStore`, no manual subscribe wiring, no mirroring an external snapshot into local state or a second store." `useSyncExternalStore` is permitted **only against a declared store surface** — see [`packages/client/ui-model-selection/src/client/ModelSelect.tsx:77`](../../../../packages/client/ui-model-selection/src/client/ModelSelect.tsx) and [`packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:72`](../../../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx). The original design mirrored the host event channel directly into a `useSyncExternalStore` hook — wrong layer.
- **Wire protocol existence**: The original design assumed host↔client already carries `loader/init` / `loader/partial-dispose` / `loader/failed` / `inventory/changed` as distinct mux frames. It does not. The existing apiproxy has one general wrapper, [`host/remote-event`](../../../../packages/host/apiproxy/src/api/events.ts#L154), driven by an allowlist ([`API_REMOTE_FORWARDED_EVENTS`](../../../../packages/api/remotes/src/remote-events.ts)) and a forwarding loop at [`packages/host/apiproxy/src/api-proxy.ts:3708`](../../../../packages/host/apiproxy/src/api-proxy.ts). Adding a new dedicated frame duplicates mechanism and contradicts the [remote-event-delivery decision](../../implemented/architecture/2026-08-10-remote-event-delivery.md).

A smaller, third concern: the original spec held `useDebouncedToggle` inside `ui-settings-plugin-inventory` and planned to lift it to a new `ui-toggleable` package once a second domain used it. `packages/client/AGENTS.md` rule 3 forbids cross-package imports between plugin packages; the only legal shared-hook home is `ui-primitives`. Lifting it later does not help — the second domain still cannot import it from a plugin package.

## Proposal

### Client: declared store + inject face, identical to ui-cordis

Mirror [`packages/extensions/ui-cordis/src/client/inventory.ts`](../../../../packages/extensions/ui-cordis/src/client/inventory.ts) (the canonical plugin-inventory-over-remote-events template). The host owns the registry; the client owns a snapshot plus a refresh trigger.

`packages/client/ui-settings-plugin-inventory/src/client/inventory-store.ts` (new):

```ts
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  readonly read: boolean
  readonly error?: string
}

export interface PluginInventoryStore extends HostObservable<PluginInventorySnapshot> {
  refresh(): void
  reset(): void
}

export function createPluginInventoryStore(
  port: { list: (signal: AbortSignal) => Promise<PluginInventorySnapshot> },
  onError: (error: unknown) => void,
): PluginInventoryStore { /* single-flight, generation-bumped on reset, identical to ui-cordis */ }
```

`packages/client/ui-settings-plugin-inventory/src/client/apply.ts` (new or in `index.ts`) wires apply():

```ts
const store = createPluginInventoryStore({ list: ctx.remote.pluginInventory.list }, console.error)
ctx.effect(() => ctx.remote.$on('plugin-inventory/changed', () => { store.refresh() }), 'ui-settings-plugin-inventory: refresh on remote event')
ctx.effect(() => ctx.on('connection/reset', () => { store.reset(); store.refresh() }), 'ui-settings-plugin-inventory: reset on reconnect')
ctx.slots.register({ name: 'settings.plugins.tab', id: 'plugin-inventory', inject: () => ({ hooks: { inventory: store }, toggle: ctx.remote.pluginInventory.setEnabled, ... }) }, PluginInventorySettingsTab)
```

Components subscribe via the inject face, exactly as in [`packages/extensions/ui-cordis/src/client/index.ts:88-95`](../../../../packages/extensions/ui-cordis/src/client/index.ts):

```tsx
const snapshot = useSyncExternalStore(props.hooks.inventory.subscribe, props.hooks.inventory.getSnapshot)
```

`useSyncExternalStore` now subscribes the **declared store**, not the host event channel — `packages/client/AGENTS.md` rule 2 satisfied.

### Toggle: hook in ui-primitives, not in the consumer package

Per `packages/client/AGENTS.md` rule 3 ("Cross-package imports of another plugin's symbols are in principle forbidden"), `useDebouncedToggle<TId>` lives in [`packages/client/ui-primitives`](../../../../packages/client/ui-primitives/) alongside `<SwitchRow>`, `<StatusDot>`, and `<SearchInput>`. Skill / mcp / agent lists import it through `ui-primitives`; no `ui-toggleable` package exists.

```ts
// packages/client/ui-primitives/src/useDebouncedToggle.ts
export interface DebouncedToggleAction<TId extends string = string> {
  readonly entryId: TId
  readonly enabled: boolean
}
export interface UseDebouncedToggleOptions<TId extends string> {
  readonly commit: (action: DebouncedToggleAction<TId>, signal: AbortSignal) => Promise<void>
  readonly debounceMs?: number            // default 500
  readonly onError?: (action: DebouncedToggleAction<TId>, error: unknown) => void
  readonly isCommitted?: (entryId: TId, intended: boolean) => boolean
}
export interface UseDebouncedToggleApi<TId extends string> {
  readonly isPending: (entryId: TId) => boolean
  readonly schedule: (entryId: TId, enabled: boolean) => void
  readonly reset: () => void              // unmount: abort in-flight, clear timers; no forced flush
}
```

Internal `intended`, `timersRef`, `controllersRef` are component-private local state per `packages/client/AGENTS.md` rule 4 ("Component-internal behavioral hooks that subscribe to nothing external are fine"). The hook does not subscribe; it only orchestrates local debounce + abort.

### Host: settings/updated → ctx.emit → API_REMOTE_FORWARDED_EVENTS forwarding

The whole wire path collapses to one allowlist entry. The forwarding loop in [`packages/host/apiproxy/src/api-proxy.ts:3708`](../../../../packages/host/apiproxy/src/api-proxy.ts) already subscribes to every name in `API_REMOTE_FORWARDED_EVENTS` and wraps each emit into a `host/remote-event` frame; the client runtime at [`packages/client/runtime/src/client/index.ts:216`](../../../../packages/client/runtime/src/client/index.ts) already dispatches via `ctx.remote.$dispatch`. Add the name once, host emit once, client `$on` once.

Three files change for the wire side:

1. `packages/api/remotes/src/remote-events.ts` — add `'plugin-inventory/changed'` to `API_REMOTE_FORWARDED_EVENTS`. This is the **wire-protocol entry point** and the first file to land.
2. `packages/host/plugin-inventory/src/types.ts` — declare the cordis event in `Events`:
   ```ts
   declare module '@deepseek-ai/cordis' {
     interface Events {
       /** One effective inventory snapshot changed; payload is the full snapshot. */
       'plugin-inventory/changed'(snapshot: PluginInventorySnapshot): void
     }
   }
   ```
3. `packages/host/plugin-inventory/src/index.ts` — `setEnabled` writes settings, calls `entry.update({ disabled })`, and emits on the host's own `settings/updated` hook:
   ```ts
   ctx.on('settings/updated', (ns, next, prev) => {
     if (String(ns) !== PLUGIN_INVENTORY_NS) return
     this.ctx.emit('plugin-inventory/changed', this.list())
   })
   ```

No apiproxy frame union change, no zod schema change, no client connection mux branch, no client runtime sink. The general wrapper already carries the new event by virtue of the allowlist entry.

### Settings overlay

Per [`packages/settings/settings-file`](../../../../packages/settings/settings-file/) precedent, settings namespaces live in `~/.dsh/settings.yaml`. New namespace:

```yaml
# ~/.dsh/settings.yaml
pluginInventory:
  enabled:
    '@deepseek-ai/dsh-host-tool-bash': false
```

Schema (incremental `Record<entryId, boolean>` so unset entries default to cordis.yml default):

```ts
// packages/host/plugin-inventory/src/settings.ts
export const PLUGIN_INVENTORY_NS = settingsNamespace('pluginInventory')
export const pluginInventorySettingsSchema = z.object({
  enabled: z.record(z.string(), z.boolean()).default({}),
})
```

`list()` overlays this namespace onto cordis.yml state. `setEnabled` writes the namespace then calls `entry.update({ disabled: !enabled })`. No data migration is needed; missing key defaults to `{}`.

### Component contract additions

`PluginInventoryEntry` gains one field, `disabledReason: 'user' | 'cordis' | null` — orthogonal to `enabled` (which is the effective boolean; `disabledReason` is why). This is the only wire-field delta for the `@Remote('list')` response.

## Alternatives considered

### Why not `useSyncExternalStore` directly against the host event channel?

The original spec put the wire event name into the component and subscribed the store to it. This violates `packages/client/AGENTS.md` reactive-read rule 2 ("Business components contain no subscription machinery — no `useSyncExternalStore`, no manual subscribe wiring, no mirroring an external snapshot into local state or a second store") and forces every consumer of plugin inventory to know the wire event name. The replacement — a declared store created in `apply()`, exposed via the inject face, and subscribed via `useSyncExternalStore(props.hooks.inventory.subscribe, props.hooks.inventory.getSnapshot)` — matches the `ui-cordis` template and lets the same store back every UI surface that wants plugin inventory (the Settings tab today, the side panel tomorrow).

### Why not a new `ui-toggleable` package for `useDebouncedToggle`?

`packages/client/AGENTS.md` rule 3 forbids cross-package imports between plugin packages: skill / mcp / agent lists cannot import a hook from `ui-settings-plugin-inventory`. The proposed alternative is to put `useDebouncedToggle<TId>` directly in [`packages/client/ui-primitives`](../../../../packages/client/ui-primitives/) next to `<SwitchRow>` / `<StatusDot>` / `<SearchInput>`. The hook is a UI primitive (it has no domain knowledge, no Cordis dependency, no host contract), so `ui-primitives` is the natural home. The threshold-based "extract when 2 domains use it" plan in the original spec is unnecessary because the home is already correct.

### Why not a new dedicated wire frame like `host/plugin-inventory-changed`?

The original spec assumed adding a new variant to `HostFrame`. The existing `host/remote-event` wrapper at [`packages/host/apiproxy/src/api/events.ts:154`](../../../../packages/host/apiproxy/src/api/events.ts) is purpose-built for verbatim Host event forwarding ([remote-event-delivery](../../implemented/architecture/2026-08-10-remote-event-delivery.md)); adding another wrapper either duplicates the mechanism or contradicts it. The chosen alternative is one entry in `API_REMOTE_FORWARDED_EVENTS` (a literal string in [`packages/api/remotes/src/remote-events.ts`](../../../../packages/api/remotes/src/remote-events.ts)) — the existing forwarding loop at [`packages/host/apiproxy/src/api-proxy.ts:3708`](../../../../packages/host/apiproxy/src/api-proxy.ts) and the existing `$dispatch` at [`packages/client/runtime/src/client/index.ts:216`](../../../../packages/client/runtime/src/client/index.ts) carry the event end-to-end. Zero new wire schema, zero new mux branch, zero new client sink.

### Why not `PluginInventoryGateway.@Remote('resetEnabled')`?

The original spec implemented a `resetEnabled` Remote that no UI consumer ever called. `packages/AGENTS.md` "Require a current owner and need" rejects the resulting dead method. Removing it is the chosen direction; if a reset UI ever ships, it goes through `ctx.settings.replace(PLUGIN_INVENTORY_NS, { enabled: {} })` and a single `entry.update({ disabled: false })` round, neither of which needs a dedicated Remote.

### Why not diff-shaped wire payloads?

The store carries the full entries array; the wire announcement is per-snapshot, not per-entry. The alternative — diffs — would let the client avoid re-rendering unchanged entries, but it would also force every refresh to reconcile against the loader event stream, which never reaches the client. Full snapshots match the `ui-cordis` precedent and keep the client simple. With ~50 plugins this is negligible; if the count climbs past a few hundred, a diff-shaped payload may become worth the extra reconciliation.

### Why not `cordis.yml` as the persistence target?

The original spec briefly considered writing back to `cordis.yml`. The vendored Cordis Loader API at [`vendor/loader/src/index.ts:162-164`](../../../../vendor/loader/src/index.ts) explicitly makes root `Loader.write()` a no-op, and the cordis.yml ownership belongs to the host deployer, not the user. The chosen alternative — `settings.yaml` — matches every other user-toggleable runtime setting in the harness.

## Acceptance criteria

### Required coverage

Per [`packages/client/AGENTS.md`](../../../../packages/client/AGENTS.md) "Testing and coverage" and [`packages/AGENTS.md`](../../../../packages/AGENTS.md) rule "Every package owns `./invariant`":

- `packages/host/plugin-inventory/tests/plugin-inventory-gateway.spec.ts` — `list()` overlay math, `setEnabled` settings write + `entry.update` order, `entry-not-found` failure, `disabledReason` semantics, `settings/updated` → emit trigger.
- `packages/host/plugin-inventory/tests/invariant.spec.ts` — `disabledReason` and `entryId` invariant relation.
- `packages/api/remotes/tests/remote-events.spec.ts` — `'plugin-inventory/changed'` in `API_REMOTE_FORWARDED_EVENTS`, type projection derivation, host forwarding round-trip via [`packages/host/apiproxy/tests/rpc-schemas.spec.ts`](../../../../packages/host/apiproxy/tests/rpc-schemas.spec.ts) and [`packages/client/runtime/tests/wire-events.client.spec.ts`](../../../../packages/client/runtime/tests/wire-events.client.spec.ts).
- `packages/client/ui-primitives/tests/SwitchRow.client.spec.tsx` / `StatusDot.client.spec.tsx` / `useDebouncedToggle.client.spec.tsx` — per-file 100% (component primitives).
- `packages/client/ui-settings-plugin-inventory/tests/inventory-store.client.spec.ts` — single-flight, generation bump on reset, error retention, no-op when in-flight.
- `packages/client/ui-settings-plugin-inventory/tests/PluginInventoryRow.client.spec.tsx` — Switch reflects committed + intended, debounce coalesces, rollback on error.
- `apps/web/tests/plugin-inventory-toggle.e2e.ts` — open Settings, toggle plugin, write to `~/.dsh/settings.yaml`, restart `dsh`, verify persistence.

### Behavior gates

1. List is one row per plugin: moduleName + status dot + Switch.
2. Switch flips immediately (optimistic via `intended`); 500ms debounce.
3. N rapid clicks → 1 RPC; new click during in-flight aborts old.
4. Toggle writes `~/.dsh/settings.yaml` `pluginInventory.enabled.<entryId>`.
5. Fiber stops/starts immediately in the current process.
6. State survives `dsh` restart.
7. Toggle failure → Switch rolls back + Toast + row flash.
8. External `settings.yaml` edit → UI auto-syncs.
9. Tab focus / 30s heartbeat → refetch fallback.
10. `pnpm run test:gui` green; new specs 100% per-file coverage.
11. `@deepseek-ai/dsh-client-ui-primitives/Switch` consumed (not a custom switch).
12. Debounce self-implemented; no new deps.

### Implementation order

1. `api/remotes/src/remote-events.ts` — add allowlist entry (Typert type projection gates the rest).
2. `host/plugin-inventory/src/{types,settings,index}.ts` — event declaration + Gateway changes.
3. `client/ui-primitives/src/{SwitchRow,StatusDot,SearchInput,useDebouncedToggle}.ts` — primitives.
4. `client/ui-settings-plugin-inventory/src/client/{apply,inventory-store,PluginInventorySettingsTab,PluginInventoryRow}.tsx` — package rewrite.
5. `apps/web/tests/plugin-inventory-toggle.e2e.ts` + snapshot recording.

## Risks

- `entry.update({ disabled })` race: the plugin may be unmounted between `list()` and `update()`; `setEnabled` must throw `entry-not-found` and let the client roll back. Existing loader emits are unaffected.
- Tab unmount with pending debounce: `useDebouncedToggle.reset()` aborts in-flight + clears timers; **no forced flush**. Uncommitted toggles are lost — the next mount re-reads the persisted state.
- settings-file watcher flood during burst toggles: mitigated by `connection/reset` refetch + 30s heartbeat in the existing UI; the store handles out-of-order refreshes by single-flight.
- `disabledReason` wire delta: old clients ignore it (TypeScript structural compatibility); the server can keep sending it as long as it is in `PluginInventoryEntry`. No removal without migration.
- Full-snapshot wire payload (not diffs): intentional match with `ui-cordis`, but means every refresh resends the whole entries array. With ~50 plugins this is negligible; if the plugin count climbs past a few hundred, a diff-shaped payload may become worth the extra client-side reconciliation.

## Supersession check

Searched the active tree for older notes covering "plugin inventory toggle", "settings/pluginInventory", or "useSyncExternalStore against host events". No matches. This is the first proposal for this decision.

## Companion spec

[`docs/superpowers/specs/2026-08-18-plugin-inventory-toggle-design-rev1.md`](../../../../docs/superpowers/specs/2026-08-18-plugin-inventory-toggle-design-rev1.md) is the user-facing spec that this note supersedes for design decisions. Both files are scheduled to land together as one PR; the note is the durable record, the spec is the user-facing artifact.

# Inventory Audit

Phase 2 Task 2.5.1. Read-only audit of the four host-side `*InventoryGateway`
classes that project a user-toggleable overlay on top of a Cordis-backed
registry. All four live under `packages/host/<domain>-inventory/src/index.ts`,
share a near-identical shape, and emit a `<domain>-inventory/changed` Cordis
event after every settings write.

The audit captures: (a) the Cordis services each package injects, (b) the
`@Remote(...)` surface that today's IPC consumers depend on, (c) the settings
namespace and shape, and (d) the migration path under the DSH client-first
refactor.

---

## packages/host/plugin-inventory

- **Service:** `PluginInventoryGateway extends TypertRemoteService`
- **`super(ctx, 'pluginInventory')`** registers the Typert remote handle with
  the `loader` + `settings` injector pair: `static inject = ['loader', 'settings']`.
- **`ctx.settings.register(PLUGIN_INVENTORY_SETTINGS_NAMESPACE, pluginInventorySettingsSchema)`**
  installs an overlay section keyed by entry id.
- **`ctx.on('settings/updated', ns => ...)`** forwards every commit as a
  `plugin-inventory/changed` Cordis event carrying `{ snapshot }`.
- **`@Remote('list')` → `list()`:** synchronous projection over
  `ctx.loader.entries()`, skipping `entry.options.group` rows. The row shape
  is `PluginInventoryEntry = { entryId, moduleName, enabled, disabledReason, fiberPhase }`.
  `FiberState` is materialized through a local mirror (`FIBER_PHASE`) because
  it is a cross-package const enum; runtime construction uses `entry.fiber.state`
  directly.
- **`@Remote('setEnabled')` → `async setEnabled({ entryId, enabled }, signal)`:**
  writes the overlay via `ctx.settings.update(ns, { enabled: next })`, then
  calls `entry.update({ disabled: !enabled })` on the matching Loader entry.
  The two writes are sequenced so a settings failure never leaves the Loader
  in a disabled state, and a loader-update failure rolls the settings write
  back via `ctx.settings.replace(ns, { enabled: current })` (the rollback
  uses `replace`, not `update`, because `update` would merge into the patch).
- **Settings namespace:** `plugin-inventory` in `~/.dsh/settings.yaml`,
  shape `z.object({ enabled: z.dict(z.boolean()).default({}) })`.
- **Typed errors:** `PLUGIN_INVENTORY_ERROR_ENTRY_NOT_FOUND`,
  `PLUGIN_INVENTORY_ERROR_SETTINGS_UPDATE`,
  `PLUGIN_INVENTORY_ERROR_LOADER_UPDATE` — every thrown `Error` carries
  `code` and `cause`.
- **Migration:** this is the only inventory that writes back through the
  Cordis Loader. Replace the server half with a client-side mutation that
  talks directly to the new host bridge: call `cordis.loader.entry(id).update({ disabled: !enabled })`
  locally and persist the overlay via the existing settings schema. The
  rollback-on-loader-failure semantics survive intact because the loader call
  is in-process after Phase 1; remove the Typert `setEnabled` method and the
  IPC payload, but keep the `plugin-inventory/changed` event so consumers
  using the existing remote-event forwarding path see live updates.

---

## packages/host/skill-inventory

- **Service:** `SkillInventoryGateway extends TypertRemoteService`
- **`super(ctx, 'skillInventory')`** with `static inject = ['skills', 'settings']`.
- **`ctx.settings.register(SKILL_INVENTORY_SETTINGS_NAMESPACE, skillInventorySettingsSchema)`**
  installs the overlay section keyed by skill name.
- **`ctx.on('settings/updated', ...)`** forwards every commit as a
  `skill-inventory/changed` Cordis event. The forwarded snapshot is currently
  emitted as an empty placeholder; consumers re-fetch via `list()`.
- **`@Remote('list')` → `async list(signal?)`:** async snapshot via
  `ctx.skills.snapshot({ signal })`, then a `project()` per `SkillSummary`
  that combines `skill.invocation.modelInvocable || userInvocable` (cordis
  baseline) with the user overlay. The empty case (no registry mounted) is
  typed `{ entries: [] }`. Entries are sorted by `name`.
- **`@Remote('setEnabled')` → `async setEnabled({ entryId, enabled }, signal)`:**
  writes the overlay via `ctx.settings.update(SKILL_INVENTORY_SETTINGS_NAMESPACE, { enabled: next })`.
  Unlike plugin-inventory, this does **not** call back into Cordis — the
  registry filters `modelInvocable` / `userInvocable` per summary, and
  consumers interpret the overlay.
- **Settings namespace:** `skill-inventory` in `~/.dsh/settings.yaml`, shape
  `z.object({ enabled: z.dict(z.boolean()).default({}) })`.
- **Typed errors:** `SKILL_INVENTORY_ERROR_ENTRY_NOT_FOUND`,
  `SKILL_INVENTORY_ERROR_SETTINGS_UPDATE`.
- **Migration:** the only stateful write is the settings commit. After the
  client-first refactor this becomes a client-side `useMutation` that hits
  the settings bridge (or the new in-client schemastery endpoint) — no Typert
  `setEnabled`, no IPC. Drop the Typert service and the gateway class; keep
  the `skill-inventory/changed` event for any direct listener. The list
  projection is plain reads off `ctx.skills`, which already lives client-side.

---

## packages/host/mcp-inventory

- **Service:** `McpInventoryGateway extends TypertRemoteService`
- **`super(ctx, 'mcpInventory')`** with `static inject = ['loader', 'settings']`.
- **`ctx.settings.register(MCP_INVENTORY_SETTINGS_NAMESPACE, mcpInventorySettingsSchema)`**
  installs the overlay section keyed by server name.
- **`ctx.on('settings/updated', ...)`** forwards every commit as a
  `mcp-inventory/changed` Cordis event carrying `{ snapshot: listSync() }`.
- **`@Remote('list')` → `list()`:** synchronous `listSync()` projection over
  `ctx.loader.entries()` that keeps only entries with
  `entry.options.name === '@deepseek-ai/dsh-mcp-client'`. Each row reads
  `serverName`, `transport`, and `target` out of `entry.options.config`
  (`serverName`, `transport: 'stdio' | 'streamable-http'`, `command` / `url`).
  The baseline is `cordisDisabled = entry.disabled === true`; user overlay wins
  outright when set. `toolCount` is currently always `0` (placeholder).
- **`@Remote('setEnabled')` → `async setEnabled({ entryId, enabled }, signal)`:**
  writes the overlay via `ctx.settings.update(MCP_INVENTORY_SETTINGS_NAMESPACE, { enabled: next })`.
  The runtime fiber's `disabled` flag is **left alone**; consumers that want
  to unload a server must reload the Loader composition.
- **Settings namespace:** `mcp-inventory` in `~/.dsh/settings.yaml`, shape
  `z.object({ enabled: z.dict(z.boolean()).default({}) })`.
- **Typed errors:** `MCP_INVENTORY_ERROR_SETTINGS_UPDATE` (no
  entry-not-found tag because the loader scan filters them out).
- **Migration:** the loader scan over the MCP-client package moves into the
  client: a client-side hook reads `cordis.loader.entries()` and filters by
  the same predicate. The overlay write is a client-side mutation against
  the settings bridge. Remove `McpInventoryGateway`, the Typert handle, and
  the IPC path; keep the `mcp-inventory/changed` event for the UI consumer
  that re-runs its own filter.

---

## packages/host/agent-inventory

- **Service:** `AgentInventoryGateway extends TypertRemoteService`
- **`super(ctx, 'agentInventory')`** with `static inject = ['settings', 'agentPresets']`.
- **`ctx.settings.register(AGENT_INVENTORY_SETTINGS_NAMESPACE, agentInventorySettingsSchema)`**
  installs the overlay section keyed by preset id.
- **`ctx.on('settings/updated', ...)`** forwards commits from **either** the
  `agent-inventory` overlay *or* the cross-package `agent-presets` namespace
  (whose `default` field flips `isDefault` in the rendered snapshot). The
  payload emitted with `agent-inventory/changed` is an empty placeholder for
  now.
- **`@Remote('list')` → `async list(signal?)`:** async list over
  `ctx.agentPresets.list()` (the `AgentPresets` registry on disk), with the
  user overlay and `readDefaultId()` (`agent-presets/default` settings
  section, returned as `isDefault`). Each row carries
  `classifySource(preset)`: `'system' → 'bundled'`, `'user' → 'user'`, else
  `'unknown'`. Entries are sorted by `presetId`.
- **`@Remote('setEnabled')` → `async setEnabled({ entryId, enabled }, signal)`:**
  writes the overlay via `ctx.settings.update(AGENT_INVENTORY_SETTINGS_NAMESPACE, { enabled: next })`.
  No Loader write; the preset definition stays on disk.
- **Settings namespace:** `agent-inventory` in `~/.dsh/settings.yaml`, shape
  `z.object({ enabled: z.dict(z.boolean()).default({}) })`. There is also the
  cross-package read of `agent-presets/default`.
- **Typed errors:** `AGENT_INVENTORY_ERROR_SETTINGS_UPDATE`.
- **Migration:** the disk-preset discovery (`AgentPresets.list()`) is the
  only data source, and it is read-only from the client's perspective today.
  After Phase 1 this becomes a client hook that calls the bridge directly;
  drop the Typert gateway class, the IPC, and the loader-style types of
  coupling — the overlay write survives as a plain settings commit.

---

## Common pattern

All four gateways share one shape; only the data source and what happens on
write differ.

1. Register a settings namespace under
   `'<domain>-inventory'` with `z.object({ enabled: z.dict(z.boolean()).default({}) })`
   and a flat-`boolean` per-entry overlay.
2. Forward every commit on that namespace (and `agent-inventory`'s extra
   `agent-presets` watcher) as a Cordis `<domain>-inventory/changed` event.
3. Expose `@Remote('list')` that projects the **cordis-side source of
   truth** (Loader entries for `plugin` / `mcp`, the `skills` registry for
   `skill`, `agentPresets.list()` for `agent`) onto a snapshot envelope of
   `{ entries: T[] }`, applying the user overlay as a flat record lookup
   (`overrides[entryId]` wins, else the cordis baseline).
4. Expose `@Remote('setEnabled')` that performs
   `ctx.settings.update(ns, { enabled: { ...current, [entryId]: enabled } })`.
   Only **plugin-inventory** additionally calls `entry.update({ disabled })`
   with rollback on failure; the other three rely on consumers (snapshot
   filters, registry re-evaluation, on-disk preset re-presentation) to
   observe the new overlay.

### What every gateway emits

- A `TypertRemoteService` registration under `super(ctx, '<name>Inventory')`,
  injecting a typed pair of Cordis services (`loader`+`settings`,
  `skills`+`settings`, `loader`+`settings`, or `settings`+`agentPresets`).
- A `ctx.settings.register(ns, schema)` call in the constructor.
- A settings-forwarder (`ctx.on('settings/updated', ...)`) that re-emits as
  `'<ns>-inventory/changed'`.
- Two `@Remote(...)` methods (`list`, `setEnabled`) with the same call
  signature: `setEnabled({ entryId: string; enabled: boolean }, signal: AbortSignal): Promise<void>`.
- A `readOverrides()` helper that returns the `enabled` map (defaulting to
  `{}`).
- A `resolveReason(userOverride, cordisDisabled, enabled)` helper that
  classifies a disabled row as `'user'`, `'cordis'`, or `null`.
- A typed-error factory that returns an `Error` plus `code` and optional
  `cause` (no special RpcError variant).

### What every gateway persists

Identical Zod schema in `settings.ts`:

```
z.object({ enabled: z.dict(z.boolean()).default({}) })
```

Living at `~/.dsh/settings.yaml` under `plugin-inventory`, `skill-inventory`,
`mcp-inventory`, or `agent-inventory` respectively. The overlay is keyed by
the public entry id (Loader id, skill name, MCP server name, or preset id)
and is the **only** persistence that survives a restart; nothing is
duplicated to a server-side store.

---

## Migration path (applies to all four)

Under the DSH client-first refactor the Typert `gateway <-> client` IPC
ceases to exist; the UI lives next to the loader, the skills registry, and
the settings store. The migration:

1. **Drop the gateway class and its Typert handle.** Each `<domain>-inventory`
   package's `index.ts` becomes empty of remote logic; keep the `settings.ts`
   schema (settings namespace ownership is the only durable artifact).
2. **Replace `@Remote('list')` with a client-side hook.** Read straight off
   the in-process Cordis source of truth:
   `cordis.loader.entries()` for plugin / mcp (with the same filter predicates),
   `cordis.skills.snapshot()` for skill, `cordis.agentPresets.list()` for agent.
   Wrap the read in a query hook (`useQuery`) and re-run it whenever the
   `<domain>-inventory/changed` Cordis event fires (the event listener stays;
   only the IPC layer goes).
3. **Replace `@Remote('setEnabled')` with a client-side `useMutation`.** The
   client calls `settings.update(ns, { enabled: { ...current, [id]: enabled } })`
   directly. `plugin-inventory` additionally calls `cordis.loader.entry(id).update({ disabled: !enabled })`
   in the same handler, preserving the rollback-on-loader-failure semantics
   that the current `setEnabled` documents. The Typert `signal: AbortSignal`
   parameter collapses to whatever the local mutation framework supports.
4. **Keep the `<domain>-inventory/changed` event.** The consumer mirror was
   relying on this event regardless of where the write came from; dropping
   it would break dashboards.
5. **Delete the IPC payload contracts.** With no Typert handle, the schema
   that travels over the wire (the generated `typert`/Typert enum) becomes
   internal-only. Move `<Domain>InventorySnapshot`, `<Domain>InventoryEntry`,
   and the typed-error tags (`*_ERROR_*`) into the client package — they are
   still useful as the wire vocabulary between the in-process mutation and
   the rendering hook.

Net effect per gateway: the host keeps the settings schema and the Cordis
event; the client owns the projection and the mutation. Nothing in
`~/.dsh/settings.yaml` is renamed or migrated because the user overlay
namespace and shape are identical across gateways and survive the move
verbatim.

---

## Cross-gateway invariants worth preserving

- **One namespace per inventory.** Do not collapse the four namespaces into
  a single section; the per-domain separation is what keeps the overlay
  readable in `settings.yaml`.
- **Idempotent `setEnabled`.** The current `setEnabled({ entryId, enabled })`
  builds `next = { ...current, [entryId]: enabled }` on every call, which is
  a merge not an assignment. The client mutation must keep the merge shape
  or it will erase other entries' overrides on every toggle.
- **`replace` vs `update` on rollback.** Only `plugin-inventory` writes
  back through a Cordis Loader entry, and that rollback uses `replace`,
  not `update`. Keep that distinction on the client: `replace` for full-section
  rewrites (rollback), `update` for patch merges (overlay commits).
- **Forward-declared local fiber mirror.** `plugin-inventory` is the only
  package that needs to read `entry.fiber.state`; the local mirror is a
  const-enum workaround for `FiberState`. If the migration moves the
  projection client-side, the mirror becomes unnecessary — read the
  underlying state directly.
- **Empty-snapshot forwarder.** `skill-inventory` and `agent-inventory`
  emit their `*/changed` event with `{ entries: [] }` placeholder payloads.
  If the client hooks re-query `list()` on the event anyway, the placeholder
  is harmless; if a future migration tries to read the snapshot from the
  event, this is the place to fix it.

---

## Summary

| Package | Source of truth | Cordis inject | Writes back to cordis? | Overlay namespace |
| --- | --- | --- | --- | --- |
| `plugin-inventory` | `cordis.loader.entries()` | `loader`, `settings` | yes (`entry.update({ disabled })` + rollback) | `plugin-inventory` |
| `skill-inventory` | `cordis.skills.snapshot()` | `skills`, `settings` | no (consumer interprets overlay) | `skill-inventory` |
| `mcp-inventory` | `cordis.loader.entries()` filtered by `name === '@deepseek-ai/dsh-mcp-client'` | `loader`, `settings` | no (consumers reload Loader) | `mcp-inventory` |
| `agent-inventory` | `cordis.agentPresets.list()` + `agent-presets/default` | `settings`, `agentPresets` | no (preset stays on disk) | `agent-inventory` |

All four follow the same `TypertRemoteService` template; the only divergent
detail is whether `setEnabled` reaches back into Cordis (only
`plugin-inventory` does), and which Cordis services back the projection.
The client-first migration replaces each gateway with an in-process
`useQuery` + `useMutation` pair against the same settings schema, removing
the Typert handle while leaving the settings overlay and the
`<domain>-inventory/changed` event intact.

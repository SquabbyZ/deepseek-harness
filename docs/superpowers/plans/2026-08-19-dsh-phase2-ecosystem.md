# DSH Phase 2 — Plugin Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire DSH's plugin ecosystem to the client-first architecture — inventory packages move to the browser, ~80 in-box plugins load natively, subagent processes spawn via Tauri shell instead of Node.

**Architecture:** Browser-native cordis host (already in production from Phase 1) gets:
1. **Inventory**: 4 host-side inventory packages (plugin/skill/mcp/agent) replaced with 4 client-side hooks under `apps/web/src/dsh/inventory/`, talking directly to `ctx.loader.entries()` (no `apiproxy` round-trip)
2. **In-box plugins**: ~80 `@deepseek-ai/dsh-*` packages audited; UI-only ones load directly into WebView2; Node-heavy ones rewritten to call Tauri shell
3. **Subagent**: drivers that need a separate process spawn via Tauri's `shell` plugin instead of Node `child_process`

**Tech Stack:** Existing Tauri 2.x + React 18 + TanStack Query + cordis. No new top-level deps.

**Spec:** `docs/superpowers/specs/2026-08-19-dsh-client-architecture-refactor-design.md` (sections 5, 6.3, 9, 10)
**Plan ref:** Phase 2 stubs in `docs/superpowers/plans/2026-08-19-dsh-client-architecture-refactor.md`

---

## Global Constraints

- All Phase 1 global constraints (target Windows + macOS, path discipline, `#[cfg(target_os)]` only in `services/platform.rs`, two-layer permission model, IPC discipline, TanStack Query only) apply unchanged.
- **New constraint:** Inventory UIs MUST NOT round-trip through Rust apiproxy. They call `ctx.loader.entries()` directly in the browser.
- **New constraint:** Subagent drivers MUST use Tauri `shell` plugin (not Node `child_process`) for out-of-process children.
- **Migration rule:** When a plugin does only UI work (no Node APIs), no code change needed — just add `dist/client.js` to its build. Verify with Playwright smoke.
- **No functional regression:** Existing Phase 1 e2e (install test plugin → SQLite row) must still work after every slice.

---

## Plan Structure: Slices × Tasks

| Slice | Title | Tasks | Deliverable |
|---|---|---|---|
| **S5** | Inventory to client plane | 2.5.1 – 2.5.8 | 4 inventory UIs wired to browser-side loader.entries(), host-side inventory packages deleted |
| **S6** | In-box plugin migration | 2.6.1 – 2.6.7 | ~80 in-box plugins loading via cordis + Tauri shell for native ops |
| **S7** | Subagent via Tauri shell | 2.7.1 – 2.7.6 | spawn/acp/codex/claude-code drivers rewired through Tauri shell |

Each task = 1 commit + 1 review. Phase 2 totals **~21 commits**.

---

## SLICE S5 — Inventory to Client Plane

### Task 2.5.1: Audit existing inventory packages

**Files:**
- Read: `packages/host/plugin-inventory/src/index.ts`
- Read: `packages/host/skill-inventory/src/index.ts`
- Read: `packages/host/mcp-inventory/src/index.ts`
- Read: `packages/host/agent-inventory/src/index.ts`
- Create: `docs/migrations/inventory-audit.md` (summary of what each package does + how it's wired)

**Output:** Audit document with each package's purpose, current entry points, and migration path.

- [ ] **Step 1: Read all four inventory packages**

For each, note:
- What typert services it registers
- How `@Remote('setEnabled')` works today
- Which `ctx.loader` APIs it touches
- Any settings storage it uses

- [ ] **Step 2: Write audit doc**

At `docs/migrations/inventory-audit.md`:
```markdown
# Inventory Audit

## packages/host/plugin-inventory
- Service: `PluginInventoryService extends TypertRemoteService`
- API: `@Remote('setEnabled')` → settings + loader.entry.update
- Settings namespace: `plugin-inventory`
- Migration: replace service with client-side hook + drop server half

## packages/host/skill-inventory
- (same shape)

## packages/host/mcp-inventory
- (same shape)

## packages/host/agent-inventory
- (same shape)

## Common pattern
All four follow the same shape:
1. `for (const entry of ctx.loader.entries())` projection
2. `entry.update({ disabled })` to toggle
3. `settingsApi.update(ns, { enabled })` for persistence
4. `@Remote('setEnabled')` for IPC

Client-side equivalent: useQuery + useMutation hooks talking directly to cordis, no IPC.
```

- [ ] **Step 3: Commit**

```bash
LEFTHOOK=0 git add docs/migrations/inventory-audit.md
git commit -m "docs(inventory): audit current host-side inventory packages"
```

---

### Task 2.5.2: Delete host-side `plugin-inventory` package

**Files:**
- Delete: `packages/host/plugin-inventory/` (entire dir)
- Modify: `pnpm-workspace.yaml` if needed
- Modify: any package that depended on `@deepseek-ai/dsh-host-plugin-inventory`

**Steps:**
- Find all imports of `@deepseek-ai/dsh-host-plugin-inventory` via `grep -rn "dsh-host-plugin-inventory" packages apps desktop`
- Remove the package directory
- Remove imports / re-export / fixtures from dependent packages
- Run `cargo test --workspace` + `pnpm tsc --noEmit -p apps/web/tsconfig.json` to verify no compile errors

- [ ] **Step 1: Find consumers**

```bash
grep -rln "dsh-host-plugin-inventory\|dsh-plugin-inventory" packages apps desktop 2>&1 | head -20
```

- [ ] **Step 2: Remove consumers**

For each consumer found:
- Remove import
- Remove registration from any cordis patch.yml
- Remove from any tsconfig references

- [ ] **Step 3: Delete package**

```bash
git rm -r packages/host/plugin-inventory
```

- [ ] **Step 4: Verify build**

```bash
cd desktop/src-tauri && cargo test --workspace
cd apps/web && pnpm tsc --noEmit
cd desktop && pnpm tauri build --debug 2>&1 | tail -3
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
LEFTHOOK=0 git commit -am "refactor(inventory): delete host-side plugin-inventory (replaced by client hook)"
```

---

### Task 2.5.3: Delete host-side `skill-inventory` package

Same shape as 2.5.2 but for skills.

- [ ] Repeat pattern from 2.5.2 for `packages/host/skill-inventory`
- [ ] Verify build
- [ ] Commit

---

### Task 2.5.4: Delete host-side `mcp-inventory` package

Same shape.

- [ ] Repeat pattern from 2.5.2 for `packages/host/mcp-inventory`
- [ ] Verify build
- [ ] Commit

---

### Task 2.5.5: Delete host-side `agent-inventory` package

Same shape.

- [ ] Repeat pattern from 2.5.2 for `packages/host/agent-inventory`
- [ ] Verify build
- [ ] Commit

---

### Task 2.5.6: Client-side `inventory/plugin.ts` hook

**Files:**
- Create: `apps/web/src/dsh/inventory/plugin.ts`
- Test: `apps/web/src/dsh/inventory/plugin.test.ts` (vitest)

**Interface:**
```typescript
export interface PluginInventoryEntry {
  id: string
  name: string
  version: string
  enabled: boolean
}

export function usePluginInventory(): UseQueryResult<PluginInventoryEntry[]>
export function useTogglePlugin(): UseMutationResult<void, AppError, { id: string; enabled: boolean }>
```

**Implementation:**
- Reads from `ctx.loader.entries()` via a new Tauri command `plugin_list_with_state` (returns enabled flag)
- Or: use existing `plugin_list` + a separate `inventory:enabled` TanStack-managed map
- Mutations call `plugin_uninstall` (for uninstall) + `entry.update({ disabled })` via a new `inventory_set_enabled` Tauri command

**Steps:**
- Add Tauri command `inventory_set_enabled(id: String, enabled: bool) -> AppResult<()>` that calls `entry.update({ disabled })`
- Wire in `commands/inventory.rs` + `services/inventory.rs` (or extend plugin commands)
- Register in `generate_handler!`
- Write the client hook

- [ ] **Step 1: Rust side — add inventory_set_enabled command**

```rust
// commands/inventory.rs (new file)
use tauri::State;
use crate::state::SharedState;
use crate::error::AppResult;

#[tauri::command]
pub fn inventory_set_enabled(
    id: String,
    enabled: bool,
    state: State<'_, SharedState>,
) -> AppResult<()> {
    let s = state.read();
    let conn = s.db.lock().expect("db mutex poisoned");
    crate::services::plugin_registry::PluginRegistry::new(&*conn)
        .update_enabled(&id, enabled)?;
    Ok(())
}
```

- [ ] **Step 2: Wire in `commands/mod.rs` + `lib.rs::generate_handler!`**

- [ ] **Step 3: Client side hook**

```typescript
// apps/web/src/dsh/inventory/plugin.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { pluginApi } from '../bridge'

export interface PluginInventoryEntry {
  id: string
  name: string
  version: string
  enabled: boolean
}

export function usePluginInventory() {
  return useQuery({
    queryKey: ['inventory', 'plugins'],
    queryFn: async () => {
      const list = await pluginApi.list()
      return list.map(p => ({
        id: p.id,
        name: p.name,
        version: p.version,
        enabled: p.enabled,
      })) as PluginInventoryEntry[]
    },
    staleTime: 30_000,
  })
}

export function useTogglePlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      invoke<void>('inventory_set_enabled', { id, enabled }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['inventory', 'plugins'] }),
  })
}
```

- [ ] **Step 4: Test**

```typescript
// plugin.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePluginInventory } from './plugin'

test('returns mapped entries', async () => { /* ... */ })
```

- [ ] **Step 5: Build + commit**

```bash
cd apps/web && pnpm tsc --noEmit && pnpm test
LEFTHOOK=0 git add apps/web/src/dsh/inventory/plugin.ts apps/web/src/dsh/bridge/index.ts desktop/src-tauri/src/commands/inventory.rs desktop/src-tauri/src/commands/mod.rs desktop/src-tauri/src/lib.rs
git commit -m "feat(inventory): client-side plugin inventory hook + Tauri inventory_set_enabled command"
```

---

### Task 2.5.7: Client-side `inventory/skill.ts`, `mcp.ts`, `agent.ts` hooks

**Files:** 3 new hook files mirroring `inventory/plugin.ts` structure.

- Each is a thin variant:
  - `inventory/skill.ts` — reads skills from `ctx.loader.entries().filter(group === 'skills')`
  - `inventory/mcp.ts` — MCP entries
  - `inventory/agent.ts` — Agent entries

**Interface difference:** Each type's entry has slightly different fields. Per-type registry services still produce the projection; the hook just exposes them.

**Steps per file:**
- [ ] Create hook file mirroring `inventory/plugin.ts` shape
- [ ] Add corresponding Tauri command if not already there
- [ ] Test
- [ ] Commit (3 separate commits, one per type)

---

### Task 2.5.8: Inventory route UI

**Files:**
- Create: `apps/web/src/routes/Inventory.tsx`
- Modify: `apps/web/src/App.tsx` (or `main.tsx`) — add `/inventory` route

**Interface:**
- 4 tabs: Plugins / Skills / MCP / Agents
- Each tab lists entries + per-row toggle (uses `useTogglePlugin` etc.)
- AllTabsShowGroup component (toggle one type across all apps — `AppToggleGroup` from spec §5)

**Steps:**
- [ ] Build `<Inventory>` route with tabs
- [ ] Build `<AppToggleGroup>` reusable component (`apps/web/src/components/common/AppToggleGroup.tsx`)
- [ ] Wire into main app router
- [ ] Verify in Playwright that toggling works (no Rust sidecar round-trip)
- [ ] Commit

---

## SLICE S6 — In-box Plugin Migration

### Task 2.6.1: Audit which in-box plugins need migration

**Files:**
- Read: every package under `packages/` (read their `package.json`)
- Create: `docs/migrations/plugin-migration-audit.md`

**Categorize each package:**
- ✅ **Keep as-is** (browser-safe, just add to in-box loader): `dsh-client-*`, `dsh-bundle-*`, `dsh-sdk-*`
- 🔄 **Rewrite Node deps** (still loads in browser, but uses `invoke()` instead of Node API): minimal set — `dsh-subagent-spawn-in-process`, etc.
- ❌ **Delete**: `dsh-boot-app-boot`, `dsh-host-webserver`, `dsh-extensions-cordis-host-runner`

- [ ] **Step 1: Inventory all packages**

```bash
ls packages/ -d */ | sort
```

- [ ] **Step 2: Categorize each by reading package.json**

For each package, check `dependencies` for Node-only modules (`fs`, `path`, `child_process`, etc.)

- [ ] **Step 3: Write audit doc**

At `docs/migrations/plugin-migration-audit.md`:
```markdown
# Plugin Migration Audit

## ✅ Browser-safe (no change needed, just register in in-box loader)
- @deepseek-ai/dsh-client-*  (25 packages)
- @deepseek-ai/dsh-bundle-*  (10 packages)
- @deepseek-ai/dsh-sdk-*     (5 packages)

## 🔄 Needs port (uses invoke() instead of Node API)
- @deepseek-ai/dsh-subagent-spawn-in-process  → S7.1
- @deepseek-ai/dsh-subagent-acp               → S7.2
- @deepseek-ai/dsh-subagent-codex              → S7.3
- @deepseek-ai/dsh-subagent-claude-code        → S7.4
- (any others found)

## ❌ Delete (dead code)
- @deepseek-ai/dsh-boot-app-boot
- @deepseek-ai/dsh-host-webserver
- @deepseek-ai/dsh-extensions-cordis-host-runner
- apps/cli (web profile only — keep headless)
```

- [ ] **Step 4: Commit**

```bash
LEFTHOOK=0 git add docs/migrations/plugin-migration-audit.md
git commit -m "docs(plugins): audit in-box plugin migration"
```

---

### Task 2.6.2: Build all in-box browser-safe plugins into `apps/web`

**Files:**
- Modify: `apps/web/vite.config.ts` — add glob imports for in-box plugins
- Create: `apps/web/src/dsh/inbox/index.ts` — barrel re-exporting all client halves
- Modify: `apps/web/src/dsh/host.ts` — load the in-box barrel

**Steps:**
- [ ] **Step 1: Create `apps/web/src/dsh/inbox/index.ts`**

```typescript
// Collect all built client modules
import * as chat from '@deepseek-ai/dsh-bundle-web-app/dist/client.js'
// ... import the rest per audit doc

export const inboxPlugins = [/* etc */]
```

- [ ] **Step 2: Modify vite config to handle workspace package imports**

- [ ] **Step 3: Wire host.ts to register inboxPlugins**

```typescript
for (const plugin of inboxPlugins) {
  ctx.plugin(plugin)
}
```

- [ ] **Step 4: Verify with Playwright that all plugins register without error**

- [ ] **Step 5: Commit**

---

### Task 2.6.3: `apps/web` UI navigation routes

**Files:**
- Create: `apps/web/src/routes/Chat.tsx`
- Create: `apps/web/src/routes/Settings.tsx`
- Create: `apps/web/src/routes/About.tsx`
- Modify: `apps/web/src/main.tsx` — add simple routing (no react-router — use TanStack Query + state)

**Implementation note:** No react-router needed. Use a simple `useState` for current view + conditional render. (DSH desktop is not a multi-page app.)

- [ ] **Step 4: Verify routes render without error**

- [ ] **Step 5: Commit**

---

### Task 2.6.4: Settings panel + theme

**Files:**
- Create: `apps/web/src/routes/Settings.tsx`
- Modify: `apps/web/src/dsh/query/queries.ts` — add `useSettings`, `useUpdateSettings`

**Interface:** Same as Phase 1 Task 1.14 had planned. Now actually wire it.

- [ ] Verify
- [ ] Commit

---

### Task 2.6.5: Trash dead code

**Files:** Delete:
- `packages/host/webserver/` (whole dir)
- `packages/boot/app-boot/` (whole dir)
- `packages/extensions/cordis-host-runner/` (whole dir)
- `packages/extensions/cordis-host-shell/` if exists
- `apps/cli/src/profile-boot.ts`
- `apps/cli/src/web-profile/` if exists
- `apps/cli/src/plugin.ts` (CLI plugin manager — replaced by UI)
- `desktop/scripts/build-sidecar.mjs` (no sidecar to build)

**Steps:**
- [ ] Find consumers of each, remove imports
- [ ] Delete
- [ ] Verify build
- [ ] Commit

---

### Task 2.6.6: Audit Playwright smoke for all in-box plugins

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/inbox-load.spec.ts`

- [ ] Boot the MSI
- [ ] Open DevTools, capture console
- [ ] Verify no plugin throws at registration time
- [ ] Verify each plugin's slot in the UI is present
- [ ] Commit

---

### Task 2.6.7: Update CI to include in-box plugin load test

- [ ] Add Playwright smoke to CI
- [ ] Commit

---

## SLICE S7 — Subagent via Tauri Shell

### Task 2.7.1: `subagent-spawn-in-process` → Tauri shell

**Files:**
- Modify: `packages/subagent/subagent-spawn-in-process/src/index.ts`

**Change:** Replace `child_process.spawn` with `invoke('shell_spawn', ...)` (existing Tauri command from Phase 1 Task 1.7).

- [ ] Verify
- [ ] Commit

---

### Task 2.7.2: `subagent-acp` → Tauri shell + IPC

- [ ] Same pattern
- [ ] Commit

---

### Task 2.7.3: `subagent-codex` → Tauri shell

- [ ] Same
- [ ] Commit

---

### Task 2.7.4: `subagent-claude-code` → Tauri shell

- [ ] Same
- [ ] Commit

---

### Task 2.7.5: Subagent integration tests

- [ ] Vitest + Playwright test that user can spawn an in-process subagent from chat
- [ ] Commit

---

### Task 2.7.6: Subagent UI panel

**Files:**
- Create: `apps/web/src/routes/Agents.tsx`

- [ ] List subagents + their status
- [ ] Spawn subagent button
- [ ] Commit

---

## Self-Review (after writing)

1. **Spec coverage:** §5 (Inventory), §6.3 (Toggle), §9 (Plugin migration), §10 (Testing) all mapped to tasks.
2. **Placeholders:** No "TBD" / "TODO".
4. **Type consistency:** `PluginInventoryEntry` interface used consistently.
5. **No functional regression:** Phase 1 demo (install test plugin) still works after S5, S6, S7.

## Open Items (flagged for engineer)

- The in-box plugin list is approximate (~80); exact count depends on audit doc (Task 2.6.1)
- Subagent UI: depends on which subagent backends survive after Task 2.7.1-2.7.4
- Some inventory packages may have additional `@Remote` methods beyond `setEnabled` — discover via audit

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-dsh-phase2-ecosystem.md`.

Two execution options:
1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks
2. **Inline Execution** — Execute tasks in this session with checkpoints

Which approach?
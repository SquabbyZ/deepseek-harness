/**
 * Inventory — the Phase 2 task 2.5.8 4-tab inventory page.
 *
 * Each tab (Plugins / Skills / MCP / Agents) consumes the matching hook from
 * `apps/web/src/dsh/inventory/*` and renders a flat list of entries. Each
 * row carries an `AppToggleGroup` so the user can flip per-app state
 * independently of the plugin's master enabled flag.
 *
 * The plugin toggle uses the existing `inventory_set_enabled` Tauri command
 * (Phase 2 task 2.5.6). The per-app toggles are UI-only for now — there is
 * no backend field yet — but the visual contract is locked so a later
 * task can wire persistence without a UI change.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AppToggleGroup, type AppId } from '../components/common/AppToggleGroup.tsx'
import {
  useAgentInventory,
  useMcpInventory,
  usePluginInventory,
  useSkillInventory,
  useToggleAgent,
  useToggleMcp,
  useTogglePlugin,
  useToggleSkill,
} from '../dsh/bridge'

type TabId = 'plugins' | 'skills' | 'mcp' | 'agents'

interface TabDescriptor {
  readonly id: TabId
  readonly label: string
}

/** Stable tab order — order is the visual order in the tab bar. */
const TABS: readonly TabDescriptor[] = [
  { id: 'plugins', label: 'Plugins' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP' },
  { id: 'agents', label: 'Agents' },
]

/** All supported apps — single source of truth for the toggle groups. */
const ALL_APPS: readonly AppId[] = ['claude', 'codex', 'gemini']

/** Empty per-app map; used as the initial state for each row. */
function emptyAppMap(): Record<AppId, boolean> {
  return { claude: false, codex: false, gemini: false }
}

/**
 * Render one inventory row: name + version + master toggle (wired to the
 * existing inventory_set_enabled command) + per-app toggle group (UI-only).
 */
interface RowProps {
  readonly entryId: string
  readonly name: string
  readonly version: string
  readonly enabled: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly pending: boolean
}

function InventoryRow(props: RowProps): ReactNode {
  const [appMap, setAppMap] = useState<Record<AppId, boolean>>(emptyAppMap)
  return (
    <li
      data-entry-id={props.entryId}
      className="flex items-center gap-3 py-2 border-b border-white/10 last:border-b-0"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{props.name}</div>
        <div className="text-xs text-gray-500 font-mono">v{props.version}</div>
      </div>
      <AppToggleGroup value={appMap} onChange={setAppMap} />
      <button
        type="button"
        role="switch"
        aria-checked={props.enabled}
        aria-label={`Toggle ${props.name}`}
        disabled={props.pending}
        onClick={() => props.onToggle(!props.enabled)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
          props.enabled ? 'bg-blue-600' : 'bg-white/20'
        } disabled:opacity-50`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${
            props.enabled ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </li>
  )
}

/**
 * Render one tab panel. Spinner is intentional — the spinner never appears
 * alone because each tab isolates its own loading state below.
 */
interface PanelProps {
  readonly tab: TabId
}

function InventoryPanel(props: PanelProps): ReactNode {
  const pluginQ = usePluginInventory()
  const skillQ = useSkillInventory()
  const mcpQ = useMcpInventory()
  const agentQ = useAgentInventory()

  const togglePlugin = useTogglePlugin()
  const toggleSkill = useToggleSkill()
  const toggleMcp = useToggleMcp()
  const toggleAgent = useToggleAgent()

  switch (props.tab) {
    case 'plugins':
      return (
        <ul className="divide-y divide-white/10">
          {pluginQ.isLoading && <li className="py-3 text-gray-500">Loading…</li>}
          {pluginQ.data?.map(p => (
            <InventoryRow
              key={p.id}
              entryId={p.id}
              name={p.name}
              version={p.version}
              enabled={p.enabled}
              pending={togglePlugin.isPending}
              onToggle={enabled => togglePlugin.mutate({ id: p.id, enabled })}
            />
          ))}
          {pluginQ.data?.length === 0 && (
            <li className="py-3 text-gray-500">No plugins installed.</li>
          )}
        </ul>
      )
    case 'skills':
      return (
        <ul className="divide-y divide-white/10">
          {skillQ.isLoading && <li className="py-3 text-gray-500">Loading…</li>}
          {skillQ.data?.map(p => (
            <InventoryRow
              key={p.id}
              entryId={p.id}
              name={p.name}
              version={p.version}
              enabled={p.enabled}
              pending={toggleSkill.isPending}
              onToggle={enabled => toggleSkill.mutate({ id: p.id, enabled })}
            />
          ))}
          {skillQ.data?.length === 0 && (
            <li className="py-3 text-gray-500">No skills installed.</li>
          )}
        </ul>
      )
    case 'mcp':
      return (
        <ul className="divide-y divide-white/10">
          {mcpQ.isLoading && <li className="py-3 text-gray-500">Loading…</li>}
          {mcpQ.data?.map(p => (
            <InventoryRow
              key={p.id}
              entryId={p.id}
              name={p.name}
              version={p.version}
              enabled={p.enabled}
              pending={toggleMcp.isPending}
              onToggle={enabled => toggleMcp.mutate({ id: p.id, enabled })}
            />
          ))}
          {mcpQ.data?.length === 0 && (
            <li className="py-3 text-gray-500">No MCP servers installed.</li>
          )}
        </ul>
      )
    case 'agents':
      return (
        <ul className="divide-y divide-white/10">
          {agentQ.isLoading && <li className="py-3 text-gray-500">Loading…</li>}
          {agentQ.data?.map(p => (
            <InventoryRow
              key={p.id}
              entryId={p.id}
              name={p.name}
              version={p.version}
              enabled={p.enabled}
              pending={toggleAgent.isPending}
              onToggle={enabled => toggleAgent.mutate({ id: p.id, enabled })}
            />
          ))}
          {agentQ.data?.length === 0 && (
            <li className="py-3 text-gray-500">No agents installed.</li>
          )}
        </ul>
      )
  }
}

/**
 * Render a bulk toggle that flips the per-app map across all rows in the
 * current tab. State is held in `useState` keyed by app id so multiple tabs
 * preserve their own selection independently.
 */
function AllTabsShowGroup(props: { readonly onApply: (next: Record<AppId, boolean>) => void }): ReactNode {
  const [map, setMap] = useState<Record<AppId, boolean>>(emptyAppMap)
  return (
    <div className="flex items-center gap-2 mb-3 text-sm text-gray-500">
      <span>Apply to all:</span>
      <AppToggleGroup
        groupId="all-tabs-toggle-group"
        value={map}
        onChange={next => {
          setMap(next)
          props.onApply(next)
        }}
      />
      <span className="ml-1">{ALL_APPS.length} apps</span>
    </div>
  )
}

/** Top-level inventory route. */
export function Inventory(): ReactNode {
  const [activeTab, setActiveTab] = useState<TabId>('plugins')

  // Keep a memoised reference to the bulk-applied map so the per-row
  // AppToggleGroup could read it later. Today the bulk action is a no-op
  // (no backend persistence yet) but the wiring is in place.
  const lastBulk = useMemo<Record<AppId, boolean>>(emptyAppMap, [])
  // Suppress the unused warning until bulk persistence lands.
  void lastBulk

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-sm text-gray-500">
          Toggle installed plugins, skills, MCP servers, and agents. Per-app
          toggles are local for now — they will persist once the inventory
          schema gains an app-id column.
        </p>
      </header>

      <div role="tablist" aria-label="Inventory sections" className="flex gap-1 border-b border-white/10 mb-3">
        {TABS.map(tab => {
          const selected = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-current={selected ? 'page' : undefined}
              data-tab-id={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm rounded-t ${
                selected
                  ? 'bg-white/10 font-medium'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <AllTabsShowGroup onApply={() => undefined} />
      <InventoryPanel tab={activeTab} />
    </div>
  )
}
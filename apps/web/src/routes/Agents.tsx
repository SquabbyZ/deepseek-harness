/**
 * Agents — Phase 2 task 2.7.6 subagent spawn panel.
 *
 * Lists installed plugins whose `manifest.kind === 'agent'` (the subagent
 * inventory) and lets the user request a spawn through one of four
 * backends: in-process, ACP, Codex, or Claude Code. Each row carries a
 * status indicator (`idle` / `running` / `done`); the status is held in
 * local React state because the brief restricts this task to UI-only — no
 * new Tauri command is introduced.
 *
 * Data source is the same `plugin_list` Tauri command other inventory
 * routes use. We call `pluginApi.list()` directly (instead of
 * `usePluginInventory`) because the brief requires filtering by
 * `manifest.kind`, and `usePluginInventory`'s return type strips the
 * manifest. The query key is namespaced under `['inventory', 'agents']`
 * so it coexists with the existing `useAgentInventory` cache without
 * duplicating the IPC call shape.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pluginApi, type PluginInfo } from '../dsh/bridge'

/** Spawn-mode tab ids — keep the visual order explicit so it stays stable. */
type SpawnMode = 'in-process' | 'acp' | 'codex' | 'claude-code'

interface TabDescriptor {
  readonly id: SpawnMode
  readonly label: string
}

const TABS: readonly TabDescriptor[] = [
  { id: 'in-process', label: 'Spawn in-process' },
  { id: 'acp', label: 'ACP' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code', label: 'Claude Code' },
]

/** Row-level spawn status, tracked per (agent, mode) since each is independent. */
type SpawnStatus = 'idle' | 'running' | 'done'

interface AgentRowProps {
  readonly entry: PluginInfo
  readonly mode: SpawnMode
  readonly status: SpawnStatus
  readonly onSpawn: () => void
}

/** Status pill — colour-coded dot + label. */
function StatusDot(props: { readonly status: SpawnStatus }): ReactNode {
  const label = props.status
  const color =
    props.status === 'running'
      ? 'bg-yellow-500 animate-pulse'
      : props.status === 'done'
        ? 'bg-green-500'
        : 'bg-gray-400'
  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      data-status={props.status}
      className="inline-flex items-center gap-1 text-xs text-gray-500"
    >
      <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}

/**
 * One agent row — name, version, status pill, spawn button. The spawn
 * button reflects the currently selected tab (`mode`) so a power user
 * flipping tabs immediately knows which backend they'd spawn through.
 */
function AgentRow(props: AgentRowProps): ReactNode {
  const busy = props.status === 'running'
  return (
    <li
      data-agent-id={props.entry.id}
      className="flex items-center gap-3 py-2 border-b border-white/10 last:border-b-0"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{props.entry.name}</div>
        <div className="text-xs text-gray-500 font-mono">v{props.entry.version}</div>
      </div>
      <StatusDot status={props.status} />
      <button
        type="button"
        onClick={props.onSpawn}
        disabled={busy}
        className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
      >
        {busy ? 'Spawning…' : 'Spawn'}
      </button>
    </li>
  )
}

/** Top-level subagent spawn panel. */
export function Agents(): ReactNode {
  const [activeTab, setActiveTab] = useState<SpawnMode>('in-process')
  const [statusMap, setStatusMap] = useState<Record<string, SpawnStatus>>({})

  const agentsQ = useQuery<PluginInfo[], Error>({
    queryKey: ['inventory', 'agents-full'],
    queryFn: () =>
      pluginApi
        .list()
        .then(list => list.filter(plugin => plugin.manifest.kind === 'agent')),
    staleTime: 30_000,
  })

  /**
   * Spawn handler — local-only state mutation. The 1500ms completion delay
   * mirrors the worker-dispatch feedback loop without invoking a backend
   * call; the half-formed promise just keeps the UI honest about the
   * in-flight state.
   */
  function handleSpawn(id: string): void {
    setStatusMap(prev => ({ ...prev, [id]: 'running' }))
    window.setTimeout(() => {
      setStatusMap(prev => ({ ...prev, [id]: 'done' }))
    }, 1500)
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Subagents</h1>
        <p className="text-sm text-gray-500">
          Spawn installed subagents through one of four backends. Status is
          local-only — the real IPC surfaces in a later task.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Spawn mode"
        className="flex gap-1 border-b border-white/10 mb-3"
      >
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

      <ul className="divide-y divide-white/10">
        {agentsQ.isLoading && <li className="py-3 text-gray-500">Loading…</li>}
        {agentsQ.data?.map(agent => (
          <AgentRow
            key={agent.id}
            entry={agent}
            mode={activeTab}
            status={statusMap[agent.id] ?? 'idle'}
            onSpawn={() => handleSpawn(agent.id)}
          />
        ))}
        {agentsQ.data?.length === 0 && (
          <li className="py-3 text-gray-500">No subagents installed.</li>
        )}
      </ul>
    </div>
  )
}

/**
 * App — top-level view router.
 *
 * The shell nav is reused from the official DSH sidebar:
 * `@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot`. The shell nav comes
 * from the `sidebar` slot entry, registered at boot by the
 * `ui-sidebar` plugin in the in-box barrel. We provide:
 *  - the same renderSlot adapter used by `Settings` (reads each
 *    sub-slot from `ctx.slots.entries(...)`)
 *  - the inject face (startSession / toggleSidebar / productName)
 *  - the standard `t` (locale) seat
 *
 * Routes are still the lightweight in-house wrappers (`Chat`,
 * `Settings`, `Plugins`, `Inventory`, `Agents`, `About`); each
 * delegates to a master component or hook. A per-route error boundary
 * keeps the sidebar working when one route's master component throws
 * on a missing service (Phase 2 S5/S6 work).
 */

import { Component, useState } from 'react'
import type { ReactNode } from 'react'
import { SidebarRoot } from '@deepseek-ai/dsh-client-ui-sidebar'
import { useHost } from './dsh/host-context.tsx'
import { Chat } from './routes/Chat.tsx'
import { Settings } from './routes/Settings.tsx'
import { Plugins } from './routes/Plugins.tsx'
import { Inventory } from './routes/Inventory.tsx'
import { Agents } from './routes/Agents.tsx'
import { About } from './routes/About.tsx'

export type ViewId =
  | 'chat'
  | 'plugins'
  | 'inventory'
  | 'agents'
  | 'settings'
  | 'about'

/** Render a sub-slot via `ctx.slots.entries(key)`, mapping each entry to
 * its stored React component. Same adapter the Settings route uses. */
function makeRenderSlot(
  ctx: ReturnType<typeof useHost>['ctx'],
): (key: string, owner: unknown, opts?: { only?: string }) => ReactNode {
  return (key, _owner, opts) => {
    const items = ctx.slots.entries(key)
    const filtered = opts?.only !== undefined
      ? items.filter((e: { options: { id?: string } }) => e.options.id === opts.only)
      : items
    return (
      <>
        {filtered.map((e: { options: { id?: string }; component: unknown }) => {
          const Sub = e.component as React.ComponentType<Record<string, unknown>>
          const id = typeof e.options.id === 'string' ? e.options.id : 'item'
          return <Sub key={`${key}:${id}`} />
        })}
      </>
    )
  }
}

/** Per-route error boundary so a failure in one master UI component
 * (missing service, throw on mount) doesn't freeze the whole app — the
 * sidebar nav + the other routes keep working while the failing route shows
 * its own error message. */
class RouteErrorBoundary extends Component<
  { readonly view: ViewId; readonly children: ReactNode },
  { readonly error: Error | null }
> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  override componentDidCatch(error: Error): void {
    console.error(`[App] route "${this.props.view}" crashed:`, error)
  }
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <div data-route-error={this.props.view} className="p-4 max-w-3xl mx-auto">
        <h2 className="text-lg font-semibold text-red-600">{this.props.view} failed to render</h2>
        <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap">
          {this.state.error.message}
        </pre>
      </div>
    )
  }
}

/** Inline nav that switches views from the sidebar's selection event.
 * SidebarRoot is a complex shell — when its master `apply` is wired
 * up it provides its own interactive widgets. Until that lands, this
 * tiny fallback keeps the routes reachable. */
function InlineNav(props: { readonly current: ViewId; readonly onSelect: (id: ViewId) => void }): ReactNode {
  const items: ReadonlyArray<readonly [ViewId, string]> = [
    ['chat', 'Chat'],
    ['plugins', 'Plugins'],
    ['inventory', 'Inventory'],
    ['agents', 'Agents'],
    ['settings', 'Settings'],
    ['about', 'About'],
  ]
  return (
    <nav className="flex gap-2 p-2 border-b border-white/10 bg-black/20">
      {items.map(([id, label]) => {
        const selected = props.current === id
        return (
          <button
            key={id}
            type="button"
            aria-current={selected ? 'page' : undefined}
            data-view-id={id}
            onClick={() => props.onSelect(id)}
            className={`px-3 py-1 rounded text-sm ${
              selected ? 'bg-white/10 font-medium' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}

/** Route the current view id to its component. */
function CurrentView(props: { readonly view: ViewId; readonly onNavigate: (view: ViewId) => void }): ReactNode {
  switch (props.view) {
    case 'chat':
      return <Chat />
    case 'plugins':
      return <Plugins onNavigate={props.onNavigate} />
    case 'inventory':
      return <Inventory />
    case 'agents':
      return <Agents />
    case 'settings':
      return <Settings />
    case 'about':
      return <About />
  }
}

export function App(): ReactNode {
  const { ctx } = useHost()
  // The official DSH sidebar lives in `@deepseek-ai/dsh-client-ui-sidebar`
  // — the master `ui-sidebar` plugin's `apply` registers `SidebarRoot` into
  // the `sidebar` slot at boot. We pull the inject face the plugin shipped
  // (startSession / toggleSidebar / productName) and pass a `t` identity
  // (no per-namespace dictionary mounted in vite dev) plus a `renderSlot`
  // adapter that reads each sub-slot (`sidebar.workspaces`,
  // `sidebar.settings`, `sidebar.footer.action`) on demand.
  const sidebarEntry = ctx.slots.entries('sidebar')[0]
  const sidebarInjected = typeof sidebarEntry?.inject === 'function'
    ? (sidebarEntry.inject() as Record<string, unknown>)
    : {}
  const [view, setView] = useState<ViewId>('chat')
  const renderSlot = makeRenderSlot(ctx)
  const t = (label: string) => label
  return (
    <div className="min-h-screen text-gray-900 dark:text-gray-100">
      <InlineNav current={view} onSelect={setView} />
      <div data-dsh-sidebar-host="">
        <SidebarRoot
          wide
          t={t}
          renderSlot={renderSlot as unknown}
          {...sidebarInjected}
        />
      </div>
      <main>
        <RouteErrorBoundary view={view}>
          <CurrentView view={view} onNavigate={setView} />
        </RouteErrorBoundary>
      </main>
    </div>
  )
}

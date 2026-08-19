/**
 * App — Phase 2 task 2.6.3 top-level view router.
 *
 * Deliberately simple: a `useState` that holds the current view id, no
 * react-router. Routes `plugins` (Phase 1 demo), `inventory` (Phase 2
 * task 2.5.8), and the Phase 2 task 2.6.3 stubs `chat`, `settings`,
 * `about`. The router stays in this file until react-router lands in a
 * later task.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Plugins } from './routes/Plugins.tsx'
import { Inventory } from './routes/Inventory.tsx'
import { Chat } from './routes/Chat.tsx'
import { Settings } from './routes/Settings.tsx'
import { About } from './routes/About.tsx'

export type ViewId = 'chat' | 'plugins' | 'inventory' | 'settings' | 'about'

interface NavItem {
  readonly id: ViewId
  readonly label: string
}

const NAV: readonly NavItem[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
]

/** Top bar with a single nav button per view. */
function Nav(props: { readonly current: ViewId; readonly onSelect: (id: ViewId) => void }): ReactNode {
  return (
    <nav className="flex gap-2 p-2 border-b border-white/10 bg-black/20">
      {NAV.map(item => {
        const selected = props.current === item.id
        return (
          <button
            key={item.id}
            type="button"
            aria-current={selected ? 'page' : undefined}
            data-view-id={item.id}
            onClick={() => props.onSelect(item.id)}
            className={`px-3 py-1 rounded text-sm ${
              selected ? 'bg-white/10 font-medium' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}

/** Route the current view id to its component. */
function CurrentView(props: { readonly view: ViewId }): ReactNode {
  switch (props.view) {
    case 'chat':
      return <Chat />
    case 'plugins':
      return <Plugins />
    case 'inventory':
      return <Inventory />
    case 'settings':
      return <Settings />
    case 'about':
      return <About />
  }
}

export function App(): ReactNode {
  const [view, setView] = useState<ViewId>('chat')
  return (
    <div className="min-h-screen text-gray-900 dark:text-gray-100">
      <Nav current={view} onSelect={setView} />
      <main>
        <CurrentView view={view} />
      </main>
    </div>
  )
}
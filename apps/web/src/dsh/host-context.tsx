/**
 * Host context provider.
 *
 * `startHost()` returns a cordis `Context` plus a plugin loader, but React
 * components need a way to subscribe to its services. This module wraps the
 * `Host` in a React `Context` + a `HostProvider` so route components and
 * shell pieces can read `ctx.slots.entries(...)`, `ctx.settingsScope.bind(...)`,
 * and any future `useXxx` hook sourced from the same context.
 *
 * Provider shape:
 *   <HostProvider value={host}>
 *     <App />
 *   </HostProvider>
 *
 * `useHost()` returns the raw `Host` so callers can also reach the loader
 * (`host.loader.entries()`) — the UI components don't need it today, but
 * routes that surface plugin inventory will.
 */
import { createContext, useContext } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type Loader from '@deepseek-ai/cordis-plugin-loader'

export interface Host {
  ctx: Context
  loader: Loader
}

const HostCtx = createContext<Host | null>(null)

export interface HostProviderProps {
  readonly value: Host
  readonly children: React.ReactNode
}

/** Wrap the React tree in a host-aware provider; mount once at boot. */
export function HostProvider(props: HostProviderProps): React.ReactNode {
  return <HostCtx.Provider value={props.value}>{props.children}</HostCtx.Provider>
}

/**
 * Access the boot-time `Host` from any descendant component.
 * @throws when used outside a `HostProvider` — that's a wiring bug, not a
 * runtime condition, so the throw is intentional and crashy.
 */
export function useHost(): Host {
  const host = useContext(HostCtx)
  if (host === null) {
    throw new Error('useHost called outside <HostProvider>')
  }
  return host
}

/**
 * Read one cordis service off the host, throwing if it isn't mounted yet.
 * The runtime contract for every service this app depends on is "mounted by
 * the time the React tree mounts", so a missing service is a boot bug.
 * @param key - the cordis service name (e.g. `'slots'`, `'locale'`).
 */
export function useService<K extends keyof Context>(key: K): NonNullable<Context[K]> {
  const { ctx } = useHost()
  const svc = ctx.get(key as never)
  if (svc === undefined || svc === null) {
    throw new Error(`useService('${String(key)}') — service not mounted on host ctx`)
  }
  return svc as NonNullable<Context[K]>
}

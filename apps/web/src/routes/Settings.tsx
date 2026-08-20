/**
 * Settings — mounts the official DSH settings shell from
 * `@deepseek-ai/dsh-client-ui-settings-general/client`.
 *
 * The shell (`SettingsRoot`) expects a full SettingsRootComponentProps
 * bundle: `wide` (sidebar owner share), `renderSlot` (read adapter for
 * the sub-slots it reads internally), and an `InjectFace` that resolves
 * `{ hooks: { sections, onboardingSteps, nav } }` into per-key
 * `useSections` / `useOnboardingSteps` / `useNav` props plus
 * `navActions` for imperative calls. Each `useXxx` is a host-observable
 * subscription bound to `ctx.slots.getVersion()`; we wrap them with
 * `useSyncExternalStore` so the shell rerenders when the ledger ticks.
 *
 * The component composition here is the exact one the master DSH web
 * app uses (after the bundle's `sidebar.settings` declare). Once the
 * in-box barrel mounts `dsh_client_ui_settings_general`, this route
 * becomes a one-liner.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { useHost } from '../dsh/host-context.tsx'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

interface HostObservable<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

interface SidebarSettingsEntry extends StoredEntry {
  inject?: () => Record<string, unknown>
}

/** Wrap a `HostObservable` as a `useSyncExternalStore` snapshot selector. */
function useObservable<T>(observable: HostObservable<T> | undefined): T | undefined {
  return useSyncExternalStore(
    onStoreChange => observable?.subscribe(onStoreChange) ?? (() => undefined),
    () => observable?.getSnapshot() as T | undefined,
    () => observable?.getSnapshot() as T | undefined,
  )
}

/** Turn the shell's `{ hooks: { sections, onboardingSteps, nav } }`
 * inject face into the per-key hook functions SettingsRoot expects. */
function makeHooksFromInject(hooks: Record<string, unknown> | undefined): {
  useSections: <S>(selector: (s: unknown) => S) => S
  useOnboardingSteps: <S>(selector: (s: unknown) => S) => S
  useNav: <S>(selector: (s: unknown) => S) => S
  useSessions: <S>(selector: (s: unknown) => S) => S
  useWorkspaces: <S>(selector: (s: unknown) => S) => S
} {
  const sections = hooks?.['sections'] as HostObservable<unknown> | undefined
  const onboardingSteps = hooks?.['onboardingSteps'] as HostObservable<unknown> | undefined
  const nav = hooks?.['nav'] as HostObservable<unknown> | undefined
  return {
    useSections: (selector) => {
      const snap = useObservable(sections) as Parameters<typeof selector>[0] | undefined
      return snap === undefined ? (undefined as never) : selector(snap)
    },
    useOnboardingSteps: (selector) => {
      const snap = useObservable(onboardingSteps) as Parameters<typeof selector>[0] | undefined
      return snap === undefined ? (undefined as never) : selector(snap)
    },
    useNav: (selector) => {
      const snap = useObservable(nav) as Parameters<typeof selector>[0] | undefined
      return snap === undefined ? (undefined as never) : selector(snap)
    },
    // Sessions / workspaces aren't in the inject face in vite dev (those
    // services aren't mounted yet). Return a stable empty object so the
    // shell's `useSessions(state => state.phase === 'ready')` and similar
    // reads return a falsy / non-blocking value.
    useSessions: ((_selector: (s: unknown) => unknown) => undefined) as never,
    useWorkspaces: ((_selector: (s: unknown) => unknown) => undefined) as never,
  }
}

export function Settings(): ReactNode {
  const { ctx } = useHost()
  const entries = ctx.slots.entries('sidebar.settings') as readonly SidebarSettingsEntry[]
  const entry = entries[0]
  if (entry === undefined) {
    return (
      <div className="p-4 max-w-3xl mx-auto" data-testid="settings-root">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500">
          The DSH settings shell (ui-settings-general) hasn&apos;t registered
          the <code className="font-mono">sidebar.settings</code> slot yet —
          check that the package is in the inbox barrel and its services
          (settingsScope, locale, connection) are mounted.
        </p>
      </div>
    )
  }
  const Component = entry.component as React.ComponentType<Record<string, unknown>>
  const injected = typeof entry.inject === 'function' ? entry.inject() : {}
  const hooks = makeHooksFromInject(
    (injected['hooks'] ?? {}) as Record<string, unknown>,
  )
  const navActions = (injected['navActions'] ?? { openSection: () => undefined, close: () => undefined }) as {
    openSection: (id: string) => void
    close: () => void
  }

  const renderSlot: SettingsRenderSlot = (key, owner, opts) => {
    const items = ctx.slots.entries(key)
    const filtered = opts?.only !== undefined
      ? items.filter((e: { options: { id?: string } }) => e.options.id === opts.only)
      : items
    // Chrome slots read `t` (locale) and a few read `controller` +
    // `useSnapshot` from the document store. We don't have a real
    // settingsScope / document store in vite dev, so we hand the shell
    // safe no-ops — components render their fallback state instead of
    // throwing on missing service bindings.
    const t = (label: string) => label
    const fallbackProps: Record<string, unknown> = { t }
    if (key === 'settings.action') {
      fallbackProps['controller'] = { isAvailable: false }
      fallbackProps['useSnapshot'] = <T,>(selector: (s: never) => T): T => selector({} as never)
    }
    if (key === 'settings.close') {
      fallbackProps['onClose'] = () => undefined
    }
    return (
      <>
        {filtered.map((e: { options: { id?: string }; component: unknown }) => {
          const Sub = e.component as React.ComponentType<Record<string, unknown>>
          const id = typeof e.options.id === 'string' ? e.options.id : 'item'
          // The shell passes its own owner/data as the second arg; we
          // forward the chrome fallback props first so they can be
          // overridden by the shell-supplied data.
          return <Sub key={`${key}:${id}`} {...fallbackProps} {...(owner as Record<string, unknown>)} />
        })}
      </>
    )
  }

  return (
    <div data-testid="settings-root">
      <Component
        wide
        renderSlot={renderSlot as unknown}
        navActions={navActions}
        useSections={hooks.useSections}
        useOnboardingSteps={hooks.useOnboardingSteps}
        useNav={hooks.useNav}
        useSessions={hooks.useSessions}
        useWorkspaces={hooks.useWorkspaces}
      />
    </div>
  )
}

type SettingsRenderSlot = (
  key: string,
  owner: unknown,
  opts?: { only?: string },
) => ReactNode

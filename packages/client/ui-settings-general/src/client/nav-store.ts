/**
 * Cross-feature settings navigation store.
 *
 * Lifts the panel `open` and `activeId` state out of `SettingsRoot` so other
 * packages (notably `ui-conversation` workspace selection failures) can
 * programmatically open the settings panel and jump to a specific section,
 * without each package having to mount a shadow panel or simulate clicks.
 *
 * Subscribed via the same `SnapshotStore` machinery as every other viewing
 * store in the client (uSES-compatible). The `SettingsRoot` reads through a
 * `useNavSnapshot` hook so the panel mirror its source of truth.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-general/nav-store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Reactive state of the settings panel. */
export interface SettingsNavState {
  /** Whether the panel is currently visible. */
  open: boolean
  /** Currently active section id, or undefined when no section is active. */
  activeId: string | undefined
}

/** Programmatic navigation handle. */
export interface SettingsNavHandle {
  /** Open the panel and activate the named section. */
  openSection(id: string): void
  /** Close the panel without changing the active section. */
  close(): void
}

/** Bundle of the snapshot store and its imperative actions. */
export interface SettingsNavStore extends SettingsNavHandle {
  readonly store: SnapshotStore<SettingsNavState>
}

/** Build a fresh settings-nav store (one per session; ui-settings-general owns the lifetime). */
export function createSettingsNavStore(): SettingsNavStore {
  const store = createSnapshotStore<SettingsNavState>({ open: false, activeId: undefined })
  return {
    store,
    openSection(id) {
      store.set({ open: true, activeId: id })
    },
    close() {
      store.set({ open: false, activeId: undefined })
    },
  }
}

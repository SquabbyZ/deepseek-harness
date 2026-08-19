/**
 * Settings — Phase 2 task 2.6.3 placeholder shell.
 *
 * The real settings UI is composed of in-box `dsh-client-ui-settings-*`
 * plugins and is wired up in Phase 2 task 2.6.4. This stub is here so the
 * App router has a `settings` view id and the placeholder is visually
 * consistent with the other routes.
 */

import type { ReactNode } from 'react'

export function Settings(): ReactNode {
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-gray-500">
          Settings panels land in a later task — this is a placeholder shell.
        </p>
      </header>
      <div
        className="rounded border border-dashed border-white/10 p-6 text-sm text-gray-500"
        aria-label="Settings placeholder"
      >
        Settings content will be rendered here.
      </div>
    </div>
  )
}
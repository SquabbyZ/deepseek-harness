/** Optional settings-header action for opening a file-backed Host document. */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { SettingsDocumentState, SettingsDocumentStore } from './settings-document-store.ts'

/** Registrant-owned dependencies of {@link SettingsDocumentAction}. */
export interface SettingsDocumentActionInjected {
  /** Provider metadata and action state owner. */
  controller: SettingsDocumentStore
  /** Bound selector hook for the controller snapshot. */
  useSnapshot: SnapshotSelectorHook<SettingsDocumentState>
}

/** Header-action owner share, localized copy, and the registrant's state face. */
export type SettingsDocumentActionProps =
  PropsRuntime<'settings.action'> & PropsLocale<'settings'> & SettingsDocumentActionInjected

/**
 * Render the open-document action only after Host metadata confirms document availability.
 * @param props - header owner props, localized copy, and injected document state.
 * @returns the action, or null while unavailable or unresolved.
 */
export function SettingsDocumentAction({ controller, useSnapshot, t }: SettingsDocumentActionProps): ReactNode {
  const state = useSnapshot(snapshot => snapshot)

  useEffect(() => {
    void controller.load()
  }, [controller])

  if (state.status !== 'ready') return null

  return (
    <div className="flex min-w-0 items-center gap-2">
      {state.error === null ? null : <span className="max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-[18px] text-[var(--dsw-alias-state-error-primary)]" role="alert">{t('openDocument.error')}</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={state.opening}
        onClick={() => { void controller.open() }}
      >
        {t('openDocument')}
      </Button>
    </div>
  )
}

/**
 * Account settings section: the linked GitHub identity and the login/logout
 * controls. Pure presentation — identity, status, and actions arrive through
 * the four props shares (the inject face); the wire and the polling loop live
 * in the registrant's {@link AccountController}, never here.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountState } from './account-store.ts'

/** Registrant-owned dependencies of {@link AccountSection}. */
export interface AccountSectionInjected {
  hooks: {
    /** Account snapshot bound by the renderer as `useAccount`. */
    account: SnapshotStore<AccountState>
  }
  /** Read the linked identity once when the section first renders. */
  load: () => Promise<void>
  /** Start the GitHub OAuth flow and poll until it settles. */
  login: () => Promise<void>
  /** Unlink the GitHub identity. */
  logout: () => Promise<void>
}

/** Section owner share, localized copy, and the registrant's account face. */
export type AccountSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'account'> & InjectFace<AccountSectionInjected>

/**
 * Render the account section.
 * @param props - composed slot props.
 * @returns the signed-in identity row or the sign-in control.
 */
export function AccountSection({ t, useAccount, login, logout, load }: AccountSectionProps): ReactNode {
  const state = useAccount(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  const signingIn = state.status === 'signing-in'

  if (state.identity !== null) {
    return (
      <div>
        <p>{t('signedIn', { name: state.identity.name })}</p>
        <button type="button" onClick={() => { void logout() }}>{t('logout')}</button>
      </div>
    )
  }

  return (
    <div>
      <button type="button" onClick={() => { void login() }} disabled={signingIn}>
        {signingIn ? t('waiting') : t('login')}
      </button>
      {state.error === null ? null : <p role="alert">{t(state.error)}</p>}
    </div>
  )
}

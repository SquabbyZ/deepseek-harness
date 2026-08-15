/**
 * Sidebar account seat: the avatar/name control pinned at the sidebar foot.
 * Signed-out/checking renders a neutral placeholder avatar that opens the
 * GitHub login dialog; signed-in renders the avatar (image or initial) plus
 * the name (wide column only) and opens a dropdown with a single logout item.
 * Pure presentation — identity, status, and actions arrive through the inject
 * face; the wire and the polling loop live in the registrant's
 * {@link AccountController}, never here.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  IconUserOutline16, Modal, ShadcnButton, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar footer.action slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { AccountIdentity, AccountState } from './account-store.ts'

/** Shared 24px avatar circle (image, initial, or placeholder). */
const AVATAR_BASE = 'flex-none inline-flex size-6 items-center justify-center overflow-hidden rounded-full object-cover'

const AVATAR_INITIAL_BASE = 'flex-none inline-flex size-6 items-center justify-center overflow-hidden rounded-full bg-[var(--dsw-alias-button-tool-bar-fill)] text-[13px] font-medium leading-5'

const AVATAR_PLACEHOLDER_BASE = 'flex-none inline-flex size-6 items-center justify-center overflow-hidden rounded-full bg-[var(--dsw-alias-interactive-bg-hover)] text-[var(--dsw-alias-label-secondary)]'

/** Seat: compact pill (avatar + name) matching the settings trigger's rhythm. */
const SEAT_BASE = 'flex-none inline-flex items-center justify-start gap-2 max-w-full h-[34px] cursor-pointer rounded-xl border-none bg-transparent px-2 py-[5px] text-sm font-normal leading-[22px] text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)]'

/** Rail seat: the same 36x36 circle box as the other rail controls. */
const SEAT_RAIL = 'size-9 justify-center gap-0 rounded-full p-0'

/** Registrant-owned dependencies of {@link SidebarAccount}. */
export interface SidebarAccountInjected {
  hooks: {
    /** Account snapshot bound by the renderer as `useAccount`. */
    account: SnapshotStore<AccountState>
  }
  /** Read the linked identity once when the seat first renders. */
  load: () => Promise<void>
  /** Start the GitHub OAuth flow and poll until it settles. */
  login: () => Promise<void>
  /** Unlink the GitHub identity. */
  logout: () => Promise<void>
}

/** Seat owner share (wide/rail column state), localized copy, and the account face. */
export type SidebarAccountProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<'account'> & InjectFace<SidebarAccountInjected>

/** The standard GitHub Octocat mark (octicon mark-github), inlined — there is no brand glyph in ui-primitives yet. */
function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Avatar cell: the linked avatar image, or a circle with the name's first letter. */
function Avatar({ identity }: { identity: AccountIdentity }) {
  if (identity.avatar !== undefined && identity.avatar !== '') {
    return <img className={AVATAR_BASE} src={identity.avatar} alt="" />
  }
  const initial = identity.name.trim().charAt(0).toUpperCase()
  return <span className={AVATAR_INITIAL_BASE}>{initial}</span>
}

/**
 * Render the sidebar account seat.
 * @param props - composed slot props.
 * @returns the avatar/name control plus its login dialog and logout menu.
 */
export function SidebarAccount({ wide, t, useAccount, load, login, logout }: SidebarAccountProps): ReactNode {
  const state = useAccount(snapshot => snapshot)
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const signedIn = state.status === 'signed-in'
  // The login dialog closes itself once the flow links an identity.
  useEffect(() => {
    if (signedIn) setLoginOpen(false)
  }, [signedIn])

  const identity = state.identity
  const signingIn = state.status === 'signing-in'

  return (
    <>
      {signedIn && identity !== null
        ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton variant="ghost" className={`${SEAT_BASE}${wide ? '' : ` ${SEAT_RAIL}`}`} aria-label={identity.name}>
                <Avatar identity={identity} />
                {wide && <span className="min-w-0 max-w-[160px] overflow-hidden whitespace-nowrap text-ellipsis">{identity.name}</span>}
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => { void logout() }}>{t('logout')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
        : (
          <Tooltip label={t('notSignedIn')} delayMs={500}>
            <ShadcnButton
              variant="ghost"
              className={`${SEAT_BASE}${wide ? '' : ` ${SEAT_RAIL}`}`}
              aria-label={t('notSignedIn')}
              onClick={() => { setLoginOpen(true) }}
            >
              <span className={AVATAR_PLACEHOLDER_BASE}><IconUserOutline16 size={16} /></span>
            </ShadcnButton>
          </Tooltip>
        )}

      <Modal open={loginOpen} onClose={() => { setLoginOpen(false) }} title={t('loginTitle')} closeLabel={t('close')}>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            className="w-full justify-center"
            icon={<GitHubMark />}
            disabled={signingIn}
            onClick={() => { void login() }}
          >
            {signingIn ? t('signingIn') : t('signIn')}
          </Button>
          {state.error !== null && <p role="alert" className="m-0 text-[13px] leading-5 text-[var(--dsw-alias-state-error-primary)]">{t(state.error)}</p>}
        </div>
      </Modal>
    </>
  )
}

// @vitest-environment jsdom
/**
 * The sidebar account seat's rendering rules: the signed-out placeholder and
 * its login dialog, the GitHub sign-in call, the auto-close once the identity
 * links, the signed-in avatar (initial/name/image), and the logout dropdown.
 * All actions are spies — the wire lives in the controller, never the component.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { SidebarAccount } from '../src/client/SidebarAccount.tsx'
import type { SidebarAccountProps } from '../src/client/SidebarAccount.tsx'
import type { AccountIdentity, AccountState } from '../src/client/account-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** jsdom has no ResizeObserver; the dropdown's popper watches its own box through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => { vi.unstubAllGlobals() })

const IDENTITY: AccountIdentity = { id: 'u1', provider: 'github', name: 'octocat' }
const IDENTITY_WITH_AVATAR: AccountIdentity = {
  id: 'u1', provider: 'github', name: 'octocat', avatar: 'https://avatars.example/octocat.png',
}

/** English-dictionary translate stub (the assertions query the en copy). */
const t: SidebarAccountProps['t'] = key => (en as Record<string, string>)[key] ?? key

/** Render the seat over a fixed snapshot; returns the store and action spies. */
function renderSeat(state: Partial<AccountState> = {}, wide = true) {
  const store = createSnapshotStore<AccountState>({
    status: 'signed-out', identity: null, error: null, ...state,
  })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    login: vi.fn(() => Promise.resolve()),
    logout: vi.fn(() => Promise.resolve()),
  }
  const props = {
    ...actions,
    wide,
    useAccount: bindSnapshotSelector(store),
    t,
  } as unknown as SidebarAccountProps
  render(<SidebarAccount {...props} />)
  return { store, actions }
}

describe('SidebarAccount', () => {
  it('reads the identity once when it first renders', () => {
    const { actions } = renderSeat()
    expect(actions.load).toHaveBeenCalledTimes(1)
  })

  it('renders the signed-out placeholder and opens the login dialog', () => {
    renderSeat({ status: 'signed-out' })
    const avatar = screen.getByRole('button', { name: en.notSignedIn })
    expect(avatar).toBeTruthy()
    fireEvent.click(avatar)
    expect(screen.getByRole('dialog', { name: en.loginTitle })).toBeTruthy()
  })

  it('routes the GitHub sign-in button to the controller', () => {
    const { actions } = renderSeat()
    fireEvent.click(screen.getByRole('button', { name: en.notSignedIn }))
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(actions.login).toHaveBeenCalledTimes(1)
  })

  it('disables the CTA and reports the wait while the flow is in flight', () => {
    renderSeat({ status: 'signing-in' })
    fireEvent.click(screen.getByRole('button', { name: en.notSignedIn }))
    const button = screen.getByRole('button', { name: en.signingIn })
    expect(button).toHaveProperty('disabled', true)
  })

  it('closes the dialog once the flow links an identity', () => {
    const { store } = renderSeat({ status: 'signing-in' })
    fireEvent.click(screen.getByRole('button', { name: en.notSignedIn }))
    expect(screen.getByRole('dialog', { name: en.loginTitle })).toBeTruthy()
    act(() => { store.set({ status: 'signed-in', identity: IDENTITY, error: null }) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a localized failure alert in the dialog', () => {
    renderSeat({ status: 'signed-out', error: 'timeout' })
    fireEvent.click(screen.getByRole('button', { name: en.notSignedIn }))
    expect(screen.getByRole('alert').textContent).toBe(en.timeout)
  })

  it('shows the name and the first-letter initial when signed in', () => {
    renderSeat({ status: 'signed-in', identity: IDENTITY })
    expect(screen.getByRole('button', { name: 'octocat' })).toBeTruthy()
    expect(screen.getByText('octocat')).toBeTruthy()
    expect(screen.getByText('O')).toBeTruthy()
  })

  it('shows the linked avatar image when one is present', () => {
    renderSeat({ status: 'signed-in', identity: IDENTITY_WITH_AVATAR })
    const image = screen.getByAltText('')
    expect(image).toHaveProperty('src', 'https://avatars.example/octocat.png')
  })

  it('routes the logout menu item to the controller', async () => {
    const { actions } = renderSeat({ status: 'signed-in', identity: IDENTITY })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'octocat' }))
    const item = await screen.findByRole('menuitem', { name: en.logout })
    fireEvent.click(item)
    expect(actions.logout).toHaveBeenCalledTimes(1)
  })

  it('renders avatar-only in the collapsed rail (no name)', () => {
    renderSeat({ status: 'signed-in', identity: IDENTITY }, false)
    expect(screen.getByRole('button', { name: 'octocat' })).toBeTruthy()
    expect(screen.queryByText('octocat')).toBeNull()
    expect(screen.getByText('O')).toBeTruthy()
  })
})

// @vitest-environment jsdom
/**
 * The account section's rendering rules: the signed-out control, the linked
 * identity row, the in-flight login state, and the localized failure alert.
 * All actions are spies — the wire lives in the controller, never the component.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { AccountSection } from '../src/client/AccountSection.tsx'
import type { AccountSectionProps } from '../src/client/AccountSection.tsx'
import type { AccountIdentity, AccountState } from '../src/client/account-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const IDENTITY: AccountIdentity = { id: 'u1', provider: 'github', name: 'octocat' }

/** Interpolate `{name}` params like the real chain, over the English dictionary. */
const t: AccountSectionProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
}

function renderSection(state: Partial<AccountState> = {}) {
  const store = createSnapshotStore<AccountState>({
    status: 'signed-out', identity: null, error: null, ...state,
  })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    login: vi.fn(() => Promise.resolve()),
    logout: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
  }
  const props = {
    ...actions,
    useAccount: bindSnapshotSelector(store),
    t,
  } as unknown as AccountSectionProps
  render(<AccountSection {...props} />)
  return actions
}

describe('AccountSection', () => {
  it('reads the identity once when it first renders', () => {
    const actions = renderSection()
    expect(actions.load).toHaveBeenCalledTimes(1)
  })

  it('offers sign-in when signed out', () => {
    renderSection()
    expect(screen.getByRole('button', { name: en.login })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.logout })).toBeNull()
  })

  it('shows the linked identity and a sign-out control when signed in', () => {
    renderSection({ status: 'signed-in', identity: IDENTITY })
    expect(screen.getByText('Signed in as octocat')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.logout })).toBeTruthy()
  })

  it('disables sign-in and reports the wait while the flow is in flight', () => {
    renderSection({ status: 'signing-in' })
    const button = screen.getByRole('button', { name: en.waiting })
    expect(button).toHaveProperty('disabled', true)
  })

  it('shows a localized failure alert', () => {
    renderSection({ error: 'error' })
    expect(screen.getByRole('alert').textContent).toBe(en.error)
  })

  it('routes the login gesture to the controller', () => {
    const actions = renderSection()
    fireEvent.click(screen.getByRole('button', { name: en.login }))
    expect(actions.login).toHaveBeenCalledTimes(1)
  })

  it('routes the logout gesture to the controller', () => {
    const actions = renderSection({ status: 'signed-in', identity: IDENTITY })
    fireEvent.click(screen.getByRole('button', { name: en.logout }))
    expect(actions.logout).toHaveBeenCalledTimes(1)
  })
})

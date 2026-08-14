/**
 * Account controller: owns the GitHub identity status and the login/logout
 * wire (including the OAuth polling loop) so the section component stays pure
 * presentation. Declared in the apply closure and shared with the section
 * through the inject face's `hooks` compartment; the wire adapter is injectable
 * for tests.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** A linked GitHub identity as reported by the auth wire. */
export interface AccountIdentity {
  id: string
  provider: string
  name: string
  email?: string
  avatar?: string
}

/** Account-surface phase. */
export type AccountStatus = 'checking' | 'signed-out' | 'signing-in' | 'signed-in'

/** Localized-ready failure key, rendered by the section through `t`. */
export type AccountErrorKey = 'error' | 'timeout'

/** Account snapshot the section renders. */
export interface AccountState {
  status: AccountStatus
  identity: AccountIdentity | null
  error: AccountErrorKey | null
}

/** The changed `GET /auth/github/status` body: identity plus a server error. */
export interface AccountStatusResult {
  identity: AccountIdentity | null
  error: string | null
}

/** Wire face the controller drives; injectable so tests supply a stub. */
export interface AccountApi {
  status(): Promise<AccountStatusResult>
  start(): Promise<void>
  logout(): Promise<void>
}

const INITIAL: AccountState = { status: 'checking', identity: null, error: null }

const POLL_INTERVAL_MS = 1000
const POLL_ATTEMPTS = 300

/** Resolve after `ms`; the poll loop's pause between status reads. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Own the account state and its wire lifecycle. A monotonically increasing
 * generation guard drops stale results so a superseded operation (or a
 * disposal) can never commit over newer state.
 */
export class AccountController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AccountState> = createSnapshotStore(INITIAL)

  private generation = 0

  /**
   * @param api - the auth wire face.
   * @param poll - poll cadence; overridden by tests to keep suites fast.
   */
  constructor(
    private readonly api: AccountApi,
    private readonly poll = { intervalMs: POLL_INTERVAL_MS, attempts: POLL_ATTEMPTS },
  ) {}

  /** Invalidate in-flight operations so they stop committing. */
  dispose(): void {
    this.generation += 1
  }

  private set(patch: Partial<AccountState>): void {
    this.store.update((state) => { Object.assign(state, patch) })
  }

  /**
   * Read the linked identity once.
   * @returns once the snapshot reflects the status endpoint.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.set({ status: 'checking', error: null })
    try {
      const result = await this.api.status()
      if (generation !== this.generation) return
      if (result.identity !== null) {
        this.set({ status: 'signed-in', identity: result.identity })
      } else if (result.error !== null) {
        this.set({ status: 'signed-out', error: 'error' })
      } else {
        this.set({ status: 'signed-out', identity: null })
      }
    } catch {
      if (generation === this.generation) this.set({ status: 'signed-out', error: 'error' })
    }
  }

  /**
   * Start the GitHub OAuth flow and poll until it settles: an identity links,
   * a server error surfaces, or the poll window expires.
   * @returns once the flow settles or is superseded.
   */
  async login(): Promise<void> {
    const generation = ++this.generation
    this.set({ status: 'signing-in', error: null })
    try {
      await this.api.start()
      for (let attempt = 0; attempt < this.poll.attempts; attempt++) {
        await sleep(this.poll.intervalMs)
        const result = await this.api.status()
        if (generation !== this.generation) return
        if (result.identity !== null) {
          this.set({ status: 'signed-in', identity: result.identity })
          return
        }
        if (result.error !== null) {
          this.set({ status: 'signed-out', error: 'error' })
          return
        }
      }
      this.set({ status: 'signed-out', error: 'timeout' })
    } catch {
      if (generation === this.generation) this.set({ status: 'signed-out', error: 'error' })
    }
  }

  /**
   * Unlink the GitHub identity.
   * @returns once the logout settled or was superseded.
   */
  async logout(): Promise<void> {
    const generation = ++this.generation
    try {
      await this.api.logout()
      if (generation !== this.generation) return
      this.set({ status: 'signed-out', identity: null, error: null })
    } catch {
      if (generation === this.generation) this.set({ status: 'signed-out', error: 'error' })
    }
  }
}

/**
 * Browser wire adapter over `fetch`, reading the changed status shape
 * `{ identity, error }`. Defaults to the global `fetch` so the apply closure
 * stays free of an explicit binding.
 * @param fetchImpl - fetch implementation (injected by tests).
 * @returns the auth wire face.
 */
export function fetchAccountApi(fetchImpl: typeof fetch = fetch): AccountApi {
  return {
    async status(): Promise<AccountStatusResult> {
      const response = await fetchImpl('/auth/github/status')
      const body = await response.json() as { identity: AccountIdentity | null; error: string | null }
      return { identity: body.identity, error: body.error }
    },
    async start(): Promise<void> {
      await fetchImpl('/auth/github/start', { method: 'POST' })
    },
    async logout(): Promise<void> {
      await fetchImpl('/auth/github/logout', { method: 'POST' })
    },
  }
}

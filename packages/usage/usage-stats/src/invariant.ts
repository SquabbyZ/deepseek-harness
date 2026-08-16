/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-usage-stats`.
 * @module @deepseek-ai/dsh-usage-stats/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-usage-stats'

/** Cordis companion plugin name. */
export const name = 'usage-stats-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the collector's correctness relation (an accumulated
 * bucket equals the fold of the durable usage events) is only checkable by
 * re-folding the log — duplicating the implementation rather than detecting
 * drift — and its rows are display state, never authority. The durable
 * boundary is already schema-validated by the storage-domain layer on every
 * reopen, and the fold's replacement accounting is proven by the package
 * spec.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

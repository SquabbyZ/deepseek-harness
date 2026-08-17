/**
 * Package-owned invariant companion for the outbound proxy.
 *
 * The plugin owns no independent event relationship: the settings schema
 * already validates the stored URL before the global dispatcher reads it, so
 * there is no extra runtime invariant to install. The empty installer keeps
 * that absence explicit in composed invariant sets.
 *
 * @module @deepseek-ai/dsh-network/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-network'

/** Cordis companion plugin name. */
export const name = 'network-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: the settings schema owns the only mutable-value relationship. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

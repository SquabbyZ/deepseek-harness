/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-settings-skill/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-skill'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-skill-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the snapshot store subscribes to the existing
 * `host/remote-event` forwarding loop and the toggle writes through the
 * shared settings namespace; no new event vocabulary requires verification.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

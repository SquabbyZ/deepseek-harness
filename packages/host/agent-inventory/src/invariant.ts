/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-agent-inventory/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-agent-inventory'

/** Cordis companion plugin name. */
export const name = 'host-agent-inventory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every snapshot is projected directly from the
 * agent-presets registry plus the user overlay namespace; both surfaces
 * maintain their own change notifications.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

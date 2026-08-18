/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-plugin-inventory/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-plugin-inventory'

/** Cordis companion plugin name. */
export const name = 'host-plugin-inventory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * Reason: every projection the gateway publishes is derived directly from
 * authoritative Loader-owned state (`ctx.loader.entries()` and the
 * `pluginInventory` settings namespace). The Cordis Fiber lifecycle already
 * maintains `entry.fiber` and `Fiber.state`, and `settings/updated` already
 * fires after every namespace commit. Adding a third observer would only
 * introduce another lifecycle truth to keep synchronized with these two.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

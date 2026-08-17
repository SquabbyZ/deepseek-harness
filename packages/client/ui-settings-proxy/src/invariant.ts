/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-proxy`.
 * @module @deepseek-ai/dsh-client-ui-settings-proxy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-proxy'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-proxy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a nav-entry-only section plugin that reads the proxy
 * namespace and drives the host.testProxy RPC — it emits no cordis events and
 * owns no cross-plugin mutable relation. The wire contract is zod-validated by
 * the host api-proxy schemas on both the request and response paths.
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

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-media-intake`.
 * @module @deepseek-ai/dsh-media-intake/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-media-intake'

/** Cordis companion plugin name. */
export const name = 'media-intake-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: extracted text is content-addressed by SHA-256, so a read self-verifies against its key. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

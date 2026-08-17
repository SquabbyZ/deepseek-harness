/**
 * Async module-customization loader for on-demand provider-SDK download.
 *
 * `registerHooks` only accepts synchronous hooks, but the SDK download is a
 * network fetch — so this file is registered through `module.register` (the
 * async loader API) from `bin.ts`, and exports an async `resolve` that fetches
 * a pruned provider SDK into `~/.dsh/sdks` before the default loader would
 * throw `ERR_MODULE_NOT_FOUND`. Emitted as its own `lib/lazy-sdk-loader.js`
 * entry (see tsdown.config.ts) so it loads beside the bundled `bin.js`.
 *
 * @module @deepseek-ai/dsh/bin/lazy-sdk-loader
 */

import { ensureSdk, isLazySdk } from './lazy-sdk.ts'

/**
 * Resolve a bare specifier, downloading the provider SDK it names on first use.
 * @param specifier - the bare specifier being resolved.
 * @param context - the resolve context (parent URL, conditions).
 * @param nextResolve - the next hook in the chain.
 * @returns the resolved file URL (short-circuited) or the chained result.
 */
export async function resolve(
  specifier: string,
  context: { conditions?: readonly string[]; parentURL?: string },
  nextResolve: (specifier: string, context?: { conditions?: readonly string[]; parentURL?: string }) => { url: string },
): Promise<{ url: string; shortCircuit?: boolean }> {
  if (isLazySdk(specifier)) {
    return { url: await ensureSdk(specifier), shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

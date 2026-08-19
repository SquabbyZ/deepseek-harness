import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

/** Cordis services initialized for the browser runtime. */
export interface Host {
  ctx: Context
  loader: Loader
}

/**
 * Initialize Cordis and its browser-side plugin loader.
 * @returns The initialized Cordis context and loader service.
 */
export async function startHost(): Promise<Host> {
  const ctx = new Context()
  await ctx.plugin(Loader)

  const loader = ctx.loader
  // Phase 1 supports direct plugin imports; S4 replaces the remaining no-op hooks.
  loader.internal = {
    version: 'browser',
    loadCache: new Map(),
    import: async (
      specifier: string,
      _parentURL: string,
      _importAttributes: ImportAttributes,
    ) => {
      const id = specifier.replace(/[^a-zA-Z0-9]/g, '_')
      const url = `/plugins/${id}.js`
      return import(/* @vite-ignore */ url)
    },
    registerStatic: () => {},
    prefetch: async () => {},
    invalidate: () => {},
  } as never

  return { ctx, loader }
}

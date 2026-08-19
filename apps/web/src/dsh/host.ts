import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { inboxPlugins } from './inbox/index.ts'

/** Cordis services initialized for the browser runtime. */
export interface Host {
  ctx: Context
  loader: Loader
}

/**
 * Initialize Cordis and its browser-side plugin loader.
 *
 * Phase 2 task 2.6.2 also registers every in-box browser-safe plugin (see
 * `./inbox`). The loader's own module system stays available — extension /
 * loader-entry plugins still arrive through it — but the in-box set is wired
 * directly so the cordis services are usable on first mount without waiting
 * for a network roundtrip.
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

  for (const plugin of inboxPlugins) {
    await ctx.plugin(plugin)
  }

  return { ctx, loader }
}

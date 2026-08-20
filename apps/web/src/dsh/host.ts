import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { inboxPlugins } from './inbox/index.ts'
import { appApi } from './bridge/app.ts'
import * as dsh_shell_env from '@deepseek-ai/dsh-shell-env'

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

  // In-box plugins registered directly so the cordis services are usable on
  // first mount without waiting for the loader roundtrip. The polyfill config
  // in `vite.config.ts` excludes the broken `undici` / `util` / `fs` /
  // `path` / `string_decoder` / `buffer` internals so this barrel boots
  // without crashing the build; remaining misclassified plugins surface via
  // the boot error overlay instead of silently producing wrong results.
  for (const plugin of inboxPlugins) {
    // Some packages (e.g. @deepseek-ai/dsh-agent-default-model) re-export the
    // plugin as a named class while also attaching settings-namespace symbols;
    // a `import * as X` namespace import therefore exposes `{ default, ... }`,
    // not a valid cordis plugin shape. Default-import targets (Loader, modules
    // whose only export is the plugin) arrive as the plugin directly. Unwrap
    // `.default` when present so the barrel can mix both shapes.
    const resolved = (plugin as { default?: unknown }).default ?? plugin
    if (resolved === dsh_shell_env.default) {
      // Per spec §7.1 the WebView2 host resolves its home through Tauri
      // `app.path().app_config_dir()`. shell-env is the one inbox plugin
      // whose `apply` requires an explicit homedir, so we fetch it here and
      // wrap the apply function with a closure that forwards homedir to the
      // 3rd argument. Node-side callers continue to pass `os.homedir()`
      // directly into `apply(ctx, config, homedir)`.
      const homedir = await appApi.configDir()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped = ((ctx: any, config: any) =>
        (resolved as (a: unknown, b: unknown, c: string) => void)(ctx, config, homedir)
      ) as Parameters<typeof ctx.plugin>[0]
      await ctx.plugin(wrapped)
    } else {
      await ctx.plugin(resolved)
    }
  }

  return { ctx, loader }
}

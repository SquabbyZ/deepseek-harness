import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
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

  // Mount the slot registry up-front so the in-box ui-* plugins (which call
  // `ctx.slots.inject(...)` from their apply()) can find it. Without this
  // every settings / conversation / layout plugin throws on first inject.
  // The registry lives in `@deepseek-ai/dsh-client-runtime/client` (pure
  // core, no apply() of its own); its constructor calls
  // `super(ctx, 'slots')` which auto-registers the instance on the cordis
  // context, so we just `new` it and move on — no separate provide call.
  const slots = new SlotRegistry(ctx)
  void slots

  // Declare every shell slot the in-box ui-* plugins rely on. The slot
  // system is spec-first: `ctx.slots.inject(key, cb)` only fires its
  // callback once `key` has a declared spec. Each ui-* plugin's `apply()`
  // assumes the spec was declared upstream — typically by a "shell" plugin
  // that owns the layout (settings shell, conversation shell, sidebar
  // shell). None of those shells ship with the inbox today, so we publish
  // the spec here. New slot keys belong in this table; remove a key only
  // after retiring every plugin that injects into it.
  ctx.slots.register({
    name: 'root',
    children: {
      // Settings shell owns `sidebar.settings` and its child section list.
      'sidebar.settings': { kind: 'single', scope: 'root' },
      // Sidebar / workspace / theme shell slots.
      'sidebar': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'workspace.picker': { kind: 'single', scope: 'root' },
      'workspace.browser': { kind: 'single', scope: 'root' },
      'sidebar.workspace.directoryFlow': { kind: 'single', scope: 'root' },
      // Conversation shell (ui-conversation).
      'conversation': { kind: 'single', scope: 'session' },
      'conversation.chat.node': { kind: 'list', scope: 'session' },
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'conversation.input.dock': { kind: 'single', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'conversation.view': { kind: 'single', scope: 'session' },
      'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
    },
  } as never, null)

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
    invalidate: async () => {},
  } as never

  // In-box plugins registered directly so the cordis services are usable on
  // first mount without waiting for the loader roundtrip.
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
      try {
        await ctx.plugin(resolved)
      } catch (error) {
        const tag = (resolved as { name?: string }).name ?? (plugin as { name?: string }).name ?? 'unknown'
        console.error('[host] plugin apply failed:', tag, error)
      }
    }
  }

  return { ctx, loader }
}

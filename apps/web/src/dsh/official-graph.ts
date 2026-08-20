/**
 * The official client UI boot graph.
 *
 * The official SaaS UI is the client plugin graph under packages/client/*,
 * booted by `@deepseek-ai/dsh-client-web`'s AppWebEntry. The real host
 * (`dsh web`) composes this graph and injects it as `window.__DSH_BOOT__`; the
 * client-first desktop shell has no such host, so the graph is composed
 * statically by scripts/generate-official-roster.mjs from every package
 * declaring `dsh.client.platform: 'web'` (same source the host's
 * ClientModuleRegistry scans). Regenerate it after any client bundle rebuild
 * or `dsh.client` declaration change:
 *
 *     node apps/web/scripts/generate-official-roster.mjs
 *
 * The shell sets this graph on `window.__DSH_BOOT__` before `AppWebEntry` runs,
 * and the AppWebEntry module system loads each `/plugins/<id>/client.js` bundle
 * from a vite dev-server middleware (see vite.config.ts `officialBundleServer`).
 */
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import raw from './official-roster.generated.json'

export const officialGraph = raw as WebBootGraph

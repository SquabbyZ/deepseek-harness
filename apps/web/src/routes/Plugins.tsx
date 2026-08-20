/**
 * Plugins — index + install affordance.
 *
 * The full plugin management surface lives inside `routesSettings` under the
 * `plugins` tab (see `dsh_client_ui_settings_plugins/PluginsSettingsSection`),
 * which renders plugin cards with per-app enable/disable, agent-loop and
 * bash-configurable cards, and the credential-backed web search providers.
 * That section only mounts when the route lands on `/settings` AND the
 * settings nav picks the plugins tab.
 *
 * This route stays as a quick entry point: an installed-plugin index plus
 * a button that drops the developer into the settings/plugins tab. The
 * install command itself stays the Phase 1 fixed-folder smoke (`%TEMP%\
 * test-plugin`) until the `dsh_plugin_install` Tauri command from spec §6.4
 * lands and can replace the temporary folder spec.
 */
import type { ReactNode } from 'react'
import { useInstalledPlugins, useInstallPlugin } from '../dsh/query/queries'

const TEST_PLUGIN_PATH = 'C:\\Users\\smallMark\\AppData\\Local\\Temp\\test-plugin'

interface PluginsProps {
  readonly onNavigate: (view: 'settings') => void
}

export function Plugins(props: PluginsProps): ReactNode {
  const { data: plugins, isLoading } = useInstalledPlugins()
  const install = useInstallPlugin()

  function handleInstall(): void {
    install.mutate(`folder:${TEST_PLUGIN_PATH}`)
  }

  return (
    <div className="p-4 max-w-3xl mx-auto" data-testid="plugins-root">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Plugins</h1>
        <p className="text-sm text-gray-500">
          Installed plugin index. Full management surface lives in
          {' '}
          <button
            type="button"
            onClick={() => props.onNavigate('settings')}
            className="underline hover:text-blue-400"
          >
            Settings → Plugins
          </button>
          .
        </p>
      </header>

      <button
        type="button"
        onClick={handleInstall}
        disabled={install.isPending}
        className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
      >
        {install.isPending ? 'Installing…' : 'Install test plugin'}
      </button>

      {install.isError && (
        <div className="mt-2 text-red-600" role="alert">
          <p className="font-semibold">Install failed</p>
          <pre className="mt-1 text-sm whitespace-pre-wrap">
            {JSON.stringify(install.error, null, 2)}
          </pre>
        </div>
      )}

      <ul className="mt-4 space-y-1">
        {isLoading && <li className="text-gray-500">Loading…</li>}
        {plugins?.map(p => (
          <li key={p.id} className="font-mono">
            {p.name} v{p.version}
          </li>
        ))}
      </ul>
    </div>
  )
}

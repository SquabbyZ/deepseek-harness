import { useInstalledPlugins, useInstallPlugin } from '../dsh/query/queries'

/**
 * Phase 1 demo route: list installed plugins and trigger an install from a
 * fixed local folder. The path resolves to %TEMP%\test-plugin (Windows) or
 * /tmp/test-plugin (POSIX); the fixture lives at
 * C:\Users\smallMark\AppData\Local\Temp\test-plugin\ for the manual smoke.
 */
const TEST_PLUGIN_PATH =
  'C:\\Users\\smallMark\\AppData\\Local\\Temp\\test-plugin'

export function Plugins() {
  const { data: plugins, isLoading } = useInstalledPlugins()
  const install = useInstallPlugin()

  function handleInstall(): void {
    install.mutate(`folder:${TEST_PLUGIN_PATH}`)
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">Plugins</h1>
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
            {JSON.stringify(install.error, Object.getOwnPropertyNames(install.error ?? {}), 2)
              ?? String(install.error)}
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

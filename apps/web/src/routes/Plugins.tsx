/**
 * Plugins — official DSH plugin management section, reused from
 * `@deepseek-ai/dsh-client-ui-settings-plugins/client/PluginsSettingsSection`.
 *
 * This is the same section component that ships inside the master
 * `SettingsRoot` shell (registered into the `settings.section` slot with id
 * `plugins`). When `SettingsRoot` is mounted the section appears inside the
 * settings dialog. Here we render the same component standalone in a
 * top-level route so the user can navigate to it directly.
 *
 * The component's `useTabs` / `renderSlot` / `t` props are provided as
 * minimal stubs that satisfy the type contract; deeper service bindings
 * (`ctx.connection` for `describe`, `ctx.settingsScope.bind` for the
 * settings doc) throw 404s against the vite-dev stub, which is the
 * expected dev-loop behaviour.
 */
import { type ReactNode } from 'react'
import { PluginsSettingsSection } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

export function Plugins(): ReactNode {
  const noopTabs = <S,>(_sel: (s: unknown) => S): S => undefined as unknown as S
  return (
    <div className="p-4 max-w-3xl mx-auto" data-testid="plugins-root">
      <PluginsSettingsSection
        t={(label: string) => label}
        renderSlot={() => null}
        useTabs={noopTabs}
      />
    </div>
  )
}

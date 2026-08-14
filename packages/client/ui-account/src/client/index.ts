import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings slot declarations (the `settings.section`
// SlotMap entry) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AccountSection } from './AccountSection.tsx'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { AccountController, fetchAccountApi } from './account-store.ts'
import { en, zh, type AccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    account: AccountKey
  }
}

const NS = 'account'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-account: dictionaries')
  const t = ctx.locale.bind(NS)

  // The account lifecycle (identity read, login poll, logout) lives in a
  // registrant-owned controller; the section renders its snapshot and calls
  // its actions only. Disposal stops any in-flight poll on unload.
  const controller = new AccountController(fetchAccountApi())
  ctx.effect(() => () => { controller.dispose() }, 'ui-account: controller')

  const injected = (): AccountSectionInjected => ({
    hooks: { account: controller.store },
    load: () => controller.load(),
    login: () => controller.login(),
    logout: () => controller.logout(),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 100,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, AccountSection))
}

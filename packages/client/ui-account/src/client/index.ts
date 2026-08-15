import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the sidebar footer.action slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SidebarAccount } from './SidebarAccount.tsx'
import type { SidebarAccountInjected } from './SidebarAccount.tsx'
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

  // The account lifecycle (identity read, login poll, logout) lives in a
  // registrant-owned controller; the seat renders its snapshot and calls its
  // actions only. Disposal stops any in-flight poll on unload.
  const controller = new AccountController(fetchAccountApi())
  ctx.effect(() => () => { controller.dispose() }, 'ui-account: controller')

  const injected = (): SidebarAccountInjected => ({
    hooks: { account: controller.store },
    load: () => controller.load(),
    login: () => controller.login(),
    logout: () => controller.logout(),
  })

  // The account seat is a sidebar foot action (beside Settings). It is the
  // single account surface now — the settings-section page is gone.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'account',
    order: 0,
    locale: NS,
    inject: injected,
  }, SidebarAccount))
}

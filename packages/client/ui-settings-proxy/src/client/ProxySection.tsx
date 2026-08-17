/**
 * Outbound-proxy settings section: a proxy URL input with three actions —
 * 测试 (probe), 清除 (remove), 保存 (persist). The input's placeholder is the
 * default `http://127.0.0.1:7890`; a stored URL pre-fills it. Results report
 * through the shadcn (sonner) toast rather than inline copy.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ShadcnButton, ShadcnInput, Toaster, toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { DEFAULT_PROXY_URL, ProxySettingsController } from './controller.ts'
import type { ProxySettingsState } from './controller.ts'
import type { en } from './locales.ts'

const SECTION = 'flex flex-col gap-5 w-full text-foreground'
const TITLE = 'm-0 text-base leading-6 font-medium text-foreground'
const INTRO = 'm-0 text-sm leading-[22px] text-[var(--dsw-alias-label-tertiary)]'
const ROW = 'flex items-center gap-2'
const INPUT = 'h-[34px] flex-1 rounded-lg border-border bg-popover px-3 py-0 text-[13px] leading-[1.5] text-foreground shadow-none focus-visible:outline-none focus-visible:border-[var(--dsw-alias-brand-primary)] focus-visible:ring-0'

/** Injected dependencies of {@link ProxySection} (slot `inject`). */
export interface ProxySectionInjected {
  controller: ProxySettingsController
  useSnapshot: SnapshotSelectorHook<ProxySettingsState>
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type ProxySectionProps = Partial<ProxySectionInjected>

/**
 * Render the proxy section, or null until the shell has injected its deps.
 * @param props - slot-delivered injected dependencies.
 */
export function ProxySection(props: ProxySectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: ProxySectionInjected }): ReactNode {
  const { controller, useSnapshot, t } = injected
  const state = useSnapshot(snapshot => snapshot)
  const [draft, setDraft] = useState(state.value)
  // Follow a store value that changed outside the draft (load / save / clear).
  useEffect(() => { setDraft(state.value) }, [state.value])
  useEffect(() => { void controller.load() }, [controller])

  const runTest = async (): Promise<void> => {
    await controller.test(draft)
    const result = controller.store.getSnapshot().testResult
    if (result === null) return
    if (result.ok) toast.success(`${t('testOk')} (${result.latencyMs ?? '?'} ms)`)
    else toast.error(`${t('testFailed')}${result.error === undefined ? '' : `: ${result.error}`}`)
  }
  const runSave = async (): Promise<void> => {
    await controller.save(draft)
    const error = controller.store.getSnapshot().error
    if (error === null) toast.success(t('saveOk'))
    else toast.error(error)
  }
  const runClear = async (): Promise<void> => {
    await controller.clear()
    const error = controller.store.getSnapshot().error
    if (error === null) toast.success(t('clearOk'))
    else toast.error(error)
  }

  return (
    <div className={SECTION}>
      <Toaster />
      <h2 className={TITLE}>{t('title')}</h2>
      <p className={INTRO}>{t('intro')}</p>

      <div className={ROW}>
        <ShadcnInput
          className={INPUT}
          value={draft}
          placeholder={DEFAULT_PROXY_URL}
          aria-label={t('urlLabel')}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <ShadcnButton
          variant="outline"
          size="sm"
          className="h-8 flex-none"
          disabled={state.testing}
          onClick={() => { void runTest() }}
        >
          {state.testing ? t('testing') : t('test')}
        </ShadcnButton>
        <ShadcnButton
          variant="outline"
          size="sm"
          className="h-8 flex-none"
          onClick={() => { void runClear() }}
        >
          {t('clear')}
        </ShadcnButton>
        <ShadcnButton
          variant="default"
          size="sm"
          className="h-8 flex-none"
          onClick={() => { void runSave() }}
        >
          {t('save')}
        </ShadcnButton>
      </div>
    </div>
  )
}

/** Product-wide, versioned internal-testing notice. */

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WelcomeNoticeState, WelcomeNoticeStore } from './welcome-store.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'

/** Registration-side dependencies of {@link WelcomeNotice}. */
export interface WelcomeNoticeInjected {
  hooks: {
    /** Durable or process-local acknowledgement state. */
    welcome: SnapshotStore<WelcomeNoticeState>
  }
  /** Welcome acknowledgement controller. */
  controller: WelcomeNoticeStore
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type WelcomeNoticeProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<WelcomeNoticeInjected>

/**
 * Render the current notice until its exact copy version is acknowledged.
 * @param props - settings-shell owner state and welcome dependencies.
 * @returns the welcome modal or null while the step decides not to show.
 */
export function WelcomeNotice(props: WelcomeNoticeProps): ReactNode {
  const { complete, controller, useWelcome, t } = props
  const state = useWelcome(snapshot => snapshot)
  const finished = useRef(false)
  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.acknowledged) finish()
  }, [finish, state.acknowledged])

  if (state.status === 'idle' || state.status === 'loading' || state.acknowledged) return null

  const acknowledge = async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }
  const paragraphs = t('welcomeBody').split('\n\n')

  return (
    <OnboardingModal title={t('welcomeTitle')} focusTitle>
      <div className="text-sm leading-6 text-[var(--dsw-alias-label-secondary)] [&>p]:m-0 [&>p+p]:mt-3">
        {paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {state.error === null ? null : <p className="error m-0 mt-4 text-sm leading-[22px] text-[var(--dsw-alias-state-error-primary)]" role="alert">{t('welcomeError')}</p>}
      <div className="mt-6 flex justify-end">
        <Button
          variant="primary"
          className="min-w-[120px] max-[560px]:w-full"
          disabled={state.status === 'saving'}
          onClick={() => { void acknowledge() }}
        >
          {t('welcomeContinue')}
        </Button>
      </div>
    </OnboardingModal>
  )
}

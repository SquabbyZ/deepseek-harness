/**
 * First-run provider setup step. Readiness comes from the same
 * provider/settings/credential join as the Models page: any provider the user
 * can already talk to ends the step, and only a user with none is offered the
 * setup dialog. Unlike the DeepSeek-only draft it replaces, the dialog is not
 * bound to one vendor — it reuses the exact configurable-provider directory
 * the Models page offers, so the first provider can be DeepSeek, any other
 * route the adapters ship, or a hand-declared custom one.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Combobox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness, protocolChoices, providerUsable } from './store.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'

/** Sentinel select value naming the hand-declared (custom) route. */
const CUSTOM_PROVIDER = '__custom__'

const SELECT_TRIGGER = 'h-8 w-full rounded-lg border-border bg-card px-2.5 py-0 text-sm leading-[22px] text-foreground shadow-none focus:border-[var(--dsw-alias-brand-primary)] focus-visible:ring-0'

/** Registration-side dependencies of {@link ProviderOnboardingDialog}. */
export interface ProviderOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Existing wire face reused by the Models credential editor. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type ProviderOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<ProviderOnboardingInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected onboarding state')
}

/**
 * Prompt a first-run user for the first model provider while no provider can
 * serve requests. The step offers the same directory as the Models page, so
 * the choice of provider is the user's, never a hardcoded vendor.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function ProviderOnboardingDialog(props: ProviderOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, api, t } = props
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)

  // Provider-selection state must stay unconditional (React's hook rule), so
  // it lives here before any early return. The initial value is empty; the
  // effective selection resolves against the join once it loads.
  const [declaring, setDeclaring] = useState(false)
  const [selected, setSelected] = useState('')

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (
      readiness.kind === 'adapter-absent'
      || readiness.kind === 'provider-ready'
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind])

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'provider-ready':
    case 'unavailable':
      return null
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  // The configurable providers not yet usable, in directory order — the same
  // directory the Models page offers, so both surfaces stay one source of
  // truth. A provider already carrying a profile but no key is still offered,
  // with the credential-only editor.
  const addable = state.rows.filter(row => !providerUsable(row) && row.entry.settingsNs !== '')

  const finish = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load()
  }

  // The effective selection: the user's pick when it still names an addable
  // route, otherwise the first one the directory offers.
  const selectedRow = addable.find(row => row.entry.provider === selected)
    ?? (selected === '' ? addable[0] : undefined)
  const selectedNamespace = selectedRow === undefined
    ? undefined
    : state.namespaces.get(selectedRow.entry.settingsNs)
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'))
  const showCustom = declaring || selectedRow === undefined

  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className="m-0 text-sm leading-6 text-[var(--dsw-alias-label-secondary)]">{t('onboardingDescription')}</p>
      <div className="mt-6 max-[560px]:mt-5">
        <div className="mb-4">
          <label className="mb-1.5 block text-xs leading-[18px] font-medium text-[var(--dsw-alias-label-secondary)]">
            {t('provider')}
          </label>
          <Combobox
            options={[
              ...addable.map(row => ({
                value: row.entry.provider,
                label: row.entry.displayName,
                keywords: [row.entry.displayName],
              })),
              { value: CUSTOM_PROVIDER, label: t('customTitle'), keywords: [t('customTitle')] },
            ]}
            value={showCustom ? CUSTOM_PROVIDER : selectedRow?.entry.provider}
            onChange={(value) => {
              if (value === CUSTOM_PROVIDER) {
                setDeclaring(true)
                return
              }
              setDeclaring(false)
              setSelected(value)
            }}
            triggerAriaLabel={t('provider')}
            searchPlaceholder={t('providerSearch')}
            emptyText={t('providerEmpty')}
            className={SELECT_TRIGGER}
          />
        </div>
        {selectedRow === undefined || declaring
          ? (
            <CustomProviderCard
              taken={state.rows.map(row => row.entry.provider)}
              protocols={protocols}
              revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
              api={api}
              t={t}
              readOnly={!state.writable}
              onClose={(changed) => {
                if (changed) void controller.load()
              }}
            />
          )
          : selectedNamespace === undefined
            ? null
            : (
              <ProviderEditor
                provider={selectedRow.entry.provider}
                displayName={selectedRow.entry.displayName}
                namespace={selectedNamespace}
                settingsPath={selectedRow.entry.settingsPath}
                {...selectedRow.entry.baseUrl === undefined ? {} : { baseUrl: selectedRow.entry.baseUrl }}
                api={api}
                t={t}
                readOnly={false}
                hideTitle
                credentialOnly={selectedRow.configured}
                credentialRequired
                autoFocusCredential
                cancelLabel="onboardingLater"
                submitLabel="onboardingSave"
                submitBusyLabel="onboardingSaving"
                onClose={finish}
              />
            )}
      </div>
    </OnboardingModal>
  )
}

/**
 * Permission preference row: the default preset for subsequently created
 * sessions. Current-session switches remain on the composer `/permission`
 * control.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14, Menu, RiskConfirmation, ShadcnButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PermissionSettingsState } from './settings-store.ts'
import type { PermissionSettingsKey } from './locales.ts'
import { FULL_ACCESS_PRESET } from './presentation.ts'

/** Preset selector pill (figma capsule on the module-platform fill). */
const SELECTOR = 'inline-flex h-9 cursor-pointer items-center gap-3 rounded-[18px] border-none bg-[var(--dsw-alias-bg-module-platform)] px-[14px] py-0 text-sm font-normal leading-[22px] text-foreground hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] hover:enabled:text-foreground disabled:pointer-events-auto disabled:cursor-default disabled:opacity-100'

/** Permission preset ids with a localized product label; unknown/custom presets fall back to the host label. */
const PRESET_LABEL_KEYS: ReadonlySet<PermissionSettingsKey> = new Set([
  'preset.read-only',
  'preset.workspace-write',
  'preset.danger-full-access',
])

/** Localize a permission preset label, falling back to the host-supplied label. */
function presetLabel(id: string, fallback: string, t: (key: PermissionSettingsKey) => string): string {
  const key = `preset.${id}` as PermissionSettingsKey
  return PRESET_LABEL_KEYS.has(key) ? t(key) : fallback
}

/** Registration-side business face for the host-backed preference. */
export interface PermissionRowInjected {
  hooks: {
    /** Permission settings snapshot bound by the renderer as usePermission. */
    permission: SnapshotStore<PermissionSettingsState>
  }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist one advertised preset. */
  select: (preset: string) => Promise<void>
}

/** Full component props. */
export type PermissionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.permission'>
  & InjectFace<PermissionRowInjected>

/**
 * Render the new-session Permission default selector.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose permission settings.
 */
export function PermissionRow({ load, select, usePermission, t }: PermissionRowProps) {
  const state = usePermission(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [confirmingFullAccess, setConfirmingFullAccess] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(false)
    setAcknowledged(false)
    setConfirmingFullAccess(false)
  }, [state.status, state.writable])

  if (state.status === 'unavailable') return null
  const selected = state.options.find(option => option.id === state.currentValue)
  const busy = state.status === 'loading' || state.status === 'saving' || confirmingFullAccess
  const label = selected === undefined
    ? (busy ? t('loading') : t('unavailable'))
    : presetLabel(selected.id, selected.label, t)
  const description: string = state.error ?? t('description')

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1 pr-12">
          <div className="text-sm font-normal leading-[22px] text-foreground">{t('title')}</div>
          <div className="text-xs font-normal leading-[18px] text-[var(--dsw-alias-label-tertiary)]" role={state.error === null ? undefined : 'alert'}>{description}</div>
        </div>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={state.options.map(option => ({ id: option.id, label: presetLabel(option.id, option.label, t) }))}
          selectedId={state.currentValue}
          onSelect={(id) => {
            setOpen(false)
            if (id === state.currentValue) return
            if (id === FULL_ACCESS_PRESET) {
              setAcknowledged(false)
              setConfirmingFullAccess(true)
              return
            }
            void select(id)
          }}
          align="end"
          portal
          anchor={(
            <ShadcnButton
              variant="ghost"
              className={SELECTOR}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={busy || !state.writable || state.options.length === 0}
              onClick={() => { setOpen(value => !value) }}
            >
              {label}
              <IconChevronDownOutline14 className="flex-none" />
            </ShadcnButton>
          )}
        />
      </div>
      <RiskConfirmation
        open={confirmingFullAccess}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={!state.writable || state.status === 'saving'}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
        }}
        onConfirm={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
          void select(FULL_ACCESS_PRESET)
        }}
      />
    </>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}

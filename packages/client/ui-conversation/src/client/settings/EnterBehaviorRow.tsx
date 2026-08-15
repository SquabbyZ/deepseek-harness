/** General Settings row for the Composer's busy-state Enter preference. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu, ShadcnButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BusyEnterBehavior } from '../contract/composer-submission.ts'
import type { ConversationKey } from '../locales.ts'

/** Registration-side preference face. */
export interface EnterBehaviorRowInjected {
  hooks: {
    /** Persisted busy-state preference bound as useBusyEnter. */
    busyEnter: SnapshotStore<BusyEnterBehavior>
  }
  /** Change the busy-state plain-Enter behavior. */
  setBusyEnter: (behavior: BusyEnterBehavior) => void
}

/** Full Settings-row props. */
export type EnterBehaviorRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<EnterBehaviorRowInjected>

const OPTIONS: readonly {
  id: BusyEnterBehavior
  label: ConversationKey
}[] = [
  { id: 'queue', label: 'settings.enter.queue' },
  { id: 'steer', label: 'settings.enter.steer' },
]

/**
 * Render the busy-state Enter behavior selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function EnterBehaviorRow({ useBusyEnter, setBusyEnter, t }: EnterBehaviorRowProps) {
  const behavior = useBusyEnter(value => value)
  const [open, setOpen] = useState(false)
  const selectedLabel = behavior === 'queue' ? 'settings.enter.queue' : 'settings.enter.steer'

  return (
    <div className="flex items-center gap-2 border-b border-[var(--dsw-alias-border-l2)] py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1 pr-12">
        <div className="text-sm leading-[22px] text-foreground">{t('settings.enter.title')}</div>
        <div className="text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]">{t('settings.enter.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={behavior}
        onSelect={(id) => {
          setOpen(false)
          setBusyEnter(id as BusyEnterBehavior)
        }}
        align="end"
        portal
        anchor={(
          <ShadcnButton
            variant="ghost"
            className="h-9 gap-3 rounded-[18px] bg-[var(--dsw-alias-bg-module-platform)] px-[14px] text-sm leading-[22px] text-foreground hover:bg-[var(--dsw-alias-interactive-bg-hover)]"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selectedLabel)}
            <IconChevronDownOutline14 className="shrink-0" />
          </ShadcnButton>
        )}
      />
    </div>
  )
}

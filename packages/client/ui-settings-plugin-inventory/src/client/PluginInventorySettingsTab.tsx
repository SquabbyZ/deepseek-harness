import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
  ShadcnButton,
  ShadcnInput,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const SECTION = 'flex w-full max-w-[760px] flex-col gap-[14px] text-foreground'
const STATUS = 'm-0 text-[13px] leading-5 text-[var(--dsw-alias-label-tertiary)]'
const FAILURE = 'flex items-center gap-2.5 text-[13px] leading-5 text-[var(--dsw-alias-state-error-primary)]'
const RETRY = 'h-auto rounded-md border-border bg-transparent px-2.5 py-1 text-[13px] leading-5 font-normal text-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-0'
const CATALOG = 'flex flex-col gap-3'
const SEARCH = 'relative flex w-full items-center text-[var(--dsw-alias-label-tertiary)]'
const SEARCH_INPUT = 'h-9 rounded-lg border-border bg-card py-0 pl-9 pr-[34px] text-[13px] text-foreground shadow-none placeholder:text-[var(--dsw-alias-label-tertiary)] focus-visible:border-[var(--dsw-alias-state-business-primary)] focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--dsw-alias-state-business-primary)_18%,transparent)]'
const CATALOG_HEADING = 'flex items-baseline gap-[7px] px-0.5'
const CATALOG_HEADING_H3 = 'm-0 text-[13px] leading-5 font-semibold'
const CATALOG_HEADING_COUNT = 'text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)] [font-variant-numeric:tabular-nums]'
const CARDS = 'm-0 grid list-none grid-cols-2 items-start gap-2.5 p-0 max-[680px]:grid-cols-1'
const CARD = 'group min-w-0 overflow-hidden rounded-[10px] border border-border bg-popover data-[open=true]:border-[var(--dsw-alias-border-l1)] data-[open=true]:shadow-[var(--dsw-shadow-lv1)]'
const CARD_CONTENT = 'h-auto min-h-[52px] w-full items-center justify-between gap-3 rounded-none border-0 bg-transparent px-[14px] py-3 text-left text-inherit hover:bg-[var(--dsw-alias-interactive-bg-hover)] group-data-[open=true]:bg-[var(--dsw-alias-interactive-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-state-business-primary)] focus-visible:-outline-offset-2 focus-visible:ring-0'
const CARD_TITLE = 'min-w-0 overflow-hidden text-sm leading-5 font-semibold text-ellipsis whitespace-nowrap'
const CARD_TRAILING = 'inline-flex flex-none items-center gap-[7px] text-[var(--dsw-alias-label-tertiary)]'
const STATUS_DOT = 'inline-block h-[7px] w-[7px] flex-none rounded-full bg-[var(--dsw-alias-label-tertiary)] data-[phase=active]:bg-[var(--dsw-alias-state-success-primary)] data-[phase=failed]:bg-[var(--dsw-alias-state-error-primary)] data-[phase=loading]:bg-[var(--dsw-alias-state-business-primary)]'
const CONFIG_TAG = 'inline-flex min-h-5 items-center rounded-[5px] px-1.5 py-px bg-card text-[11px] leading-4 whitespace-nowrap text-[var(--dsw-alias-label-secondary)] data-[enabled=true]:bg-[color-mix(in_srgb,var(--dsw-alias-state-success-primary)_10%,transparent)] data-[enabled=true]:text-[var(--dsw-alias-state-success-primary)]'
const CHEVRON = 'flex-none text-[var(--dsw-alias-label-tertiary)] group-data-[open=true]:rotate-180 motion-safe:transition-transform motion-safe:duration-[140ms] motion-safe:ease-[var(--ds-ease-in-out)]'
const CARD_DETAILS = 'border-t border-border bg-[var(--dsw-alias-bg-module-platform)] px-[14px] pt-2.5 pb-3'
const ENTRY_VALUE = 'block text-[var(--dsw-alias-label-primary)] [font-family:var(--ds-font-family-code)] text-xs leading-[18px] [overflow-wrap:anywhere]'
const DETAILS = 'mt-2 grid grid-cols-[76px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5'
const DETAILS_DIV = '[display:contents]'
const DETAILS_DT = 'text-[11px] leading-[17px] text-[var(--dsw-alias-label-tertiary)]'
const DETAILS_DD = 'm-0 min-w-0 text-xs leading-[17px] text-[var(--dsw-alias-label-secondary)] [overflow-wrap:anywhere]'

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Render the read-only current Loader inventory. */
export function PluginInventorySettingsTab({ list, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  return (
    <div className={SECTION} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={STATUS}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={FAILURE}>
          <p className="m-0" role="alert">{t('error')}</p>
          <ShadcnButton variant="outline" className={RETRY} onClick={retry}>{t('retry')}</ShadcnButton>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={CATALOG}>
          <label className={SEARCH}>
            <IconSearchOutline16 className="pointer-events-none absolute left-3" aria-hidden="true" />
            <span className="sr-only">{t('search')}</span>
            <ShadcnInput
              type="search"
              className={SEARCH_INPUT}
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={CATALOG_HEADING}>
            <h3 className={CATALOG_HEADING_H3}>{t('catalog')}</h3>
            <span className={CATALOG_HEADING_COUNT} data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {state.snapshot.entries.length === 0 ? <p className={STATUS}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={STATUS}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={CARDS}>
              {filteredEntries.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const open = expanded === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                return (
                  <li
                    className={CARD}
                    key={entry.entryId}
                    data-plugin-entry={entry.entryId}
                    data-open={open ? 'true' : undefined}
                  >
                    <ShadcnButton
                      className={CARD_CONTENT}
                      variant="ghost"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
                      onClick={() => {
                        setExpanded(current => current === entry.entryId ? null : entry.entryId)
                      }}
                    >
                      <strong className={CARD_TITLE} title={entry.moduleName}>{title}</strong>
                      <span className={CARD_TRAILING}>
                        {entry.enabled ? (
                          <span
                            className={STATUS_DOT}
                            data-phase={entry.fiberPhase ?? 'unobserved'}
                            role="img"
                            aria-label={status}
                            title={status}
                          />
                        ) : null}
                        <span className={CONFIG_TAG} data-enabled={entry.enabled ? 'true' : 'false'}>
                          {configuration}
                        </span>
                        <IconChevronDownOutline14 className={CHEVRON} size={12} aria-hidden="true" />
                      </span>
                    </ShadcnButton>
                    {open ? (
                      <div className={CARD_DETAILS} id={detailId}>
                        <code className={ENTRY_VALUE} data-loader-entry>{entry.entryId}</code>
                        <dl className={DETAILS}>
                          <div className={DETAILS_DIV}>
                            <dt className={DETAILS_DT}>{t('configuration')}</dt>
                            <dd className={DETAILS_DD}>{configuration}</dd>
                          </div>
                          {entry.enabled ? (
                            <div className={DETAILS_DIV}>
                              <dt className={DETAILS_DT}>{t('cordis')}</dt>
                              <dd className={DETAILS_DD}>{status}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

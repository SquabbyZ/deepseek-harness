/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Combobox, FishLogo, IconPlusOutline16, Modal, ShadcnButton, cn } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { deriveKeyRef, messageOf, protocolChoices, providerUsable } from './store.ts'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store.ts'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor.tsx'
import type { en } from './locales.ts'

const SECTION = 'flex flex-col gap-3 max-w-[720px] text-foreground'
const TITLE = 'm-0 text-base leading-6 font-medium text-foreground'
const INTRO = 'm-0 text-sm leading-[22px] text-[var(--dsw-alias-label-tertiary)]'
const NOTICE = 'm-0 text-xs leading-[18px] text-[var(--dsw-alias-state-warn-label)]'
const SAVED_NOTICE = 'm-0 text-xs leading-[18px] text-[var(--dsw-alias-state-success-primary)]'
const ERROR = 'error m-0 text-xs leading-[18px] text-[var(--dsw-alias-state-error-primary)]'
const ROWS = 'mt-3 mb-0 flex list-none flex-col gap-2 px-0'
const ROW_CARD = 'flex flex-col gap-3 rounded-xl border border-border px-[14px] py-3'
const SETUP_CARD = 'flex list-none flex-col gap-[14px] rounded-xl bg-[var(--dsw-alias-bg-module-platform)] px-4 py-[14px]'
const ADD_CARD = 'flex list-none flex-col gap-[14px] rounded-xl bg-[var(--dsw-alias-bg-module-platform)] px-4 py-[14px]'
const ROW_HEAD = 'flex items-center gap-2.5'
const ROW_IDENTITY = 'inline-flex min-w-0 items-center gap-1.5'
const ROW_NAME = 'text-sm leading-[22px] font-medium text-foreground'
const ROW_TAG = 'flex-none rounded border border-input px-1.5 py-px text-[11px] leading-4 text-[var(--dsw-alias-label-secondary)]'
const CRED_DOT = 'inline-block h-2 w-2 flex-none rounded-full'
const ROW_ACTIONS = 'ml-auto inline-flex items-center gap-1'
const ADD_BLOCK = 'flex flex-col gap-3'
const ADD_ACTIONS = 'flex flex-wrap gap-2.5'
const FIELD = 'flex flex-col gap-1.5'
const FIELD_LABEL = 'inline-flex items-center gap-2.5 text-xs leading-[18px] font-medium text-[var(--dsw-alias-label-secondary)]'
const INPUT =
  'h-8 rounded-lg border-border bg-card px-2.5 py-0 text-sm leading-[22px] text-foreground shadow-none placeholder:text-[var(--dsw-alias-label-dimmed)] focus:border-[var(--dsw-alias-brand-primary)] focus-visible:ring-0 disabled:opacity-60 disabled:cursor-default'
const SECONDARY_BUTTON =
  'inline-flex h-9 items-center justify-center gap-1 rounded-[18px] border border-border bg-transparent px-[14px] text-sm leading-[22px] font-normal text-foreground hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover-solid)] hover:text-foreground disabled:opacity-40 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--dsw-alias-border-l3)]'
const ROW_SECONDARY_BUTTON =
  'inline-flex h-7 items-center justify-center gap-1 rounded-[14px] border border-border bg-transparent px-2.5 text-xs leading-[18px] font-normal text-foreground hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover-solid)] hover:text-foreground disabled:opacity-40 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--dsw-alias-border-l3)]'
const ROW_DANGER_BUTTON =
  'inline-flex h-7 items-center justify-center rounded-[14px] border-none bg-transparent px-2.5 text-xs leading-[18px] font-normal text-[var(--dsw-alias-state-error-primary)] hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover-danger)] hover:text-[var(--dsw-alias-state-error-primary)] disabled:opacity-40 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--dsw-alias-border-l3)]'
const ADD_BUTTON =
  'inline-flex h-11 min-w-[180px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-input bg-transparent px-[14px] text-sm leading-[22px] font-normal text-foreground hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover)] hover:text-foreground disabled:opacity-40 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_var(--dsw-alias-border-l3)]'
const EMPTY = 'flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border px-6 py-12 text-center'
const EMPTY_LOGO = 'text-[var(--dsw-alias-label-tertiary)] opacity-60'
const EMPTY_TITLE = 'm-0 text-base leading-6 font-medium text-foreground'
const EMPTY_BODY = 'm-0 max-w-[400px] text-sm leading-[22px] text-[var(--dsw-alias-label-tertiary)]'
const EMPTY_ACTIONS = 'flex flex-wrap justify-center gap-2.5'
const DELETE_DIALOG = 'w-[min(480px,100%)]'
const DELETE_CONFIRM =
  'enabled:border-[var(--dsw-alias-state-error-primary)] enabled:text-[var(--dsw-alias-state-error-primary)] hover:enabled:bg-[var(--dsw-alias-interactive-bg-hover-danger)]'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<ModelsSettingsState>
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
  /** The adapter's default endpoint, for the editor's base-URL prefill. */
  baseUrl?: string
}

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'api' | 't' | 'readOnly' | 'onClose'
> {
  target: EditorTarget
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, ...props }: ProviderEditorRenderProps): ReactNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true ? { declared: true } : {}}
      {...target.baseUrl === undefined ? {} : { baseUrl: target.baseUrl }}
      {...props}
    />
  )
}

/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRef?: string },
): Promise<string | undefined> {
  try {
    if (target.credentialRef !== undefined) {
      const credential = await api.credentials.unset({ ref: target.credentialRef })
      if (!credential.result.ok) return credential.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Absent is not "shipped": an adapter that answers nothing leaves the
    // route-level fields only a declared route owns off the card, exactly as
    // it leaves the custom tag off the row.
    ...row.entry.declared === true ? { declared: true } : {},
    ...row.entry.baseUrl === undefined ? {} : { baseUrl: row.entry.baseUrl },
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, t } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, api, t }} />
}

function Loaded({ injected }: { injected: ModelsSectionInjected }): ReactNode {
  const { controller, api, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [declaring, setDeclaring] = useState(false)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setEditing(undefined)
    setAdding(false)
    setDeclaring(false)
    if (changed) announceSaved(target)
  }

  /**
   * Close a setup card, which owns none of the state above: the row-editor,
   * add, and declare cards each own one of those, so clearing them here would
   * discard a draft the user opened beside this card. Dismissal is this card's
   * own — the provider falls back to an ordinary row for the rest of the
   * session, and reopens through Edit.
   */
  const closeSetup = (changed: boolean, target: ProviderIdentity): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(api, controller, deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={SECTION}>
        <p className={ERROR}>{`${t('loadFailed')}: ${errorText}`}</p>
        <ShadcnButton variant="ghost" className={SECONDARY_BUTTON} onClick={() => { void controller.load() }}>
          {t('retry')}
        </ShadcnButton>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a row
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  // One fact decides both first-run postures on this page and the onboarding
  // step: whether the user already has a provider to talk to.
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter(row => row.configured)
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')
  // The empty posture: no provider is configured and no card is open. The
  // DeepSeek route (the one this adapter ships) is the natural first choice.
  const isEmpty = state.status === 'ready' && configured.length === 0 && !adding && !declaring
  const deepseekRow = state.rows.find(row => row.entry.provider === 'deepseek-official')
  const configureDeepSeek = (): void => {
    if (deepseekRow === undefined) return
    setSavedTarget(undefined)
    setDeclaring(false)
    setAdding(true)
    setEditing(targetOf(deepseekRow))
  }
  const addTarget = adding ? editing : undefined
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs)
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'))

  return (
    <div className={SECTION}>
      <h2 className={TITLE}>{t('title')}</h2>
      <p className={INTRO}>{t('intro')}</p>
      {!state.writable && state.status === 'ready' ? <p className={NOTICE}>{t('readOnly')}</p> : null}
      {savedIdentity === undefined
        ? null
        : (
          <p className={SAVED_NOTICE} role="status" aria-live="polite">
            {providerCopy(t('savedProvider'), savedIdentity)}
          </p>
        )}
      {isEmpty
        ? (
          <div className={EMPTY}>
            <FishLogo size={40} className={EMPTY_LOGO} />
            <h3 className={EMPTY_TITLE}>{t('emptyTitle')}</h3>
            <p className={EMPTY_BODY}>{t('emptyBody')}</p>
            <div className={EMPTY_ACTIONS}>
              {deepseekRow === undefined
                ? null
                : (
                  <Button variant="primary" onClick={configureDeepSeek}>
                    {t('emptyPrimary')}
                  </Button>
                )}
              <Button
                variant="outline"
                onClick={() => {
                  const first = addable[0]
                  if (first === undefined) return
                  setSavedTarget(undefined)
                  setDeclaring(false)
                  setAdding(true)
                  setEditing(targetOf(first))
                }}
              >
                {t('emptySecondary')}
              </Button>
            </div>
          </div>
        )
        : null}
      <ul className={cn(ROWS, isEmpty ? 'hidden' : '')}>
        {configured.map((row) => {
          const target = targetOf(row)
          const namespace = state.namespaces.get(target.settingsNs)
          /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
          if (namespace === undefined) return null
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            // First-run posture: the provider exists but has no key — the
            // setup card IS its presence on the page, until the user closes it.
            return (
              <li key={row.entry.provider} className={SETUP_CARD}>
                {renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeSetup(changed, target) },
                })}
              </li>
            )
          }
          const open = !adding && editing?.provider === row.entry.provider
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
          return (
            <li key={row.entry.provider} className={ROW_CARD}>
              <div className={ROW_HEAD}>
                <span className={ROW_IDENTITY}>
                  <span className={ROW_NAME}>{row.entry.displayName}</span>
                  {/* Only the adapter can tell a hand-declared route from a
                      shipped one it also has a stored profile for, so the tag
                      follows its answer and stays off when it gives none. */}
                  {row.entry.declared === true
                    ? <span className={ROW_TAG}>{t('customTag')}</span>
                    : null}
                  {credentialConfigured
                    ? (
                      <span
                        className={cn(CRED_DOT, 'credentialDotConfigured bg-[var(--dsw-alias-state-success-primary)]')}
                        role="img"
                        aria-label={t('credentialConfigured')}
                        title={t('credentialConfigured')}
                      />
                    )
                    : credentialMissing
                      ? (
                        <span
                          className={cn(CRED_DOT, 'credentialDotMissing bg-[var(--dsw-alias-state-error-primary)]')}
                          role="img"
                          aria-label={t('credentialMissing')}
                          title={t('credentialMissing')}
                        />
                      )
                      : null}
                </span>
                <span className={ROW_ACTIONS}>
                  <ShadcnButton
                    variant="ghost"
                    className={ROW_SECONDARY_BUTTON}
                    aria-label={providerCopy(t('editProvider'), target)}
                    onClick={() => {
                      setSavedTarget(undefined)
                      // One card at a time: leaving `declaring` set would show
                      // the create card beside this editor, and closing either
                      // one discards the other's draft.
                      setDeclaring(false)
                      setAdding(false)
                      setEditing(open ? undefined : target)
                    }}
                  >
                    {t('edit')}
                  </ShadcnButton>
                  {row.removable
                    ? (
                      <ShadcnButton
                        variant="ghost"
                        className={ROW_DANGER_BUTTON}
                        aria-label={providerCopy(t('removeProvider'), target)}
                        disabled={!state.writable}
                        onClick={() => {
                          setSavedTarget(undefined)
                          setDeleteFailure(undefined)
                          setDeleteTarget(target)
                        }}
                      >
                        {t('remove')}
                      </ShadcnButton>
                    )
                    : null}
                </span>
              </div>
              {open
                ? renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeEditor(changed, target) },
                })
                : null}
            </li>
          )
        })}
      </ul>
      <div className={cn(ADD_BLOCK, isEmpty ? 'hidden' : '')}>
        {addTarget !== undefined && addNamespace !== undefined
          ? (
            <div className={ADD_CARD}>
              <div className={FIELD}>
                <span className={FIELD_LABEL}>{t('provider')}</span>
                <div className="max-w-[240px]">
                  <Combobox
                    options={addable.map(row => ({
                      value: row.entry.provider,
                      label: row.entry.displayName,
                      keywords: [row.entry.displayName],
                    }))}
                    value={addTarget.provider}
                    onChange={(value) => {
                      const row = addable.find(candidate => candidate.entry.provider === value)
                      /* v8 ignore next -- the combobox only lists addable rows */
                      if (row === undefined) return
                      setEditing(targetOf(row))
                    }}
                    triggerAriaLabel={t('provider')}
                    searchPlaceholder={t('providerSearch')}
                    emptyText={t('providerEmpty')}
                    className={INPUT}
                  />
                </div>
              </div>
              <ProviderEditor
                key={addTarget.provider}
                provider={addTarget.provider}
                displayName={addTarget.displayName}
                hideTitle
                namespace={addNamespace}
                settingsPath={addTarget.settingsPath}
                {...addTarget.baseUrl === undefined ? {} : { baseUrl: addTarget.baseUrl }}
                api={api}
                t={t}
                readOnly={!state.writable}
                onClose={(changed) => { closeEditor(changed, addTarget) }}
              />
            </div>
          )
          : declaring
            ? (
              <div className={ADD_CARD}>
                <CustomProviderCard
                  taken={state.rows.map(row => row.entry.provider)}
                  protocols={protocols}
                  /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                  revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                  api={api}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => {
                    setDeclaring(false)
                    if (changed) void controller.load()
                  }}
                />
              </div>
            )
            : (
              // One row for the two ways to gain a provider: adopt one the
              // adapter already knows, or declare one it does not. Side by side
              // and equal-width so they read as siblings and line up with the
              // rows above, rather than two pills of different lengths.
              <div className={ADD_ACTIONS}>
                <ShadcnButton
                  variant="ghost"
                  className={ADD_BUTTON}
                  disabled={addable.length === 0 || !state.writable}
                  onClick={() => {
                    const first = addable[0]
                    /* v8 ignore next -- the button is disabled while nothing is addable */
                    if (first === undefined) return
                    setSavedTarget(undefined)
                    setDeclaring(false)
                    setAdding(true)
                    setEditing(targetOf(first))
                  }}
                >
                  {/* Same glyph as the composer's attach button. */}
                  <IconPlusOutline16 size={14} />
                  {t('add')}
                </ShadcnButton>
                <ShadcnButton
                  variant="ghost"
                  className={ADD_BUTTON}
                  disabled={protocols.length === 0 || !state.writable}
                  onClick={() => {
                    setSavedTarget(undefined)
                    setAdding(false)
                    setEditing(undefined)
                    setDeclaring(true)
                  }}
                >
                  <IconPlusOutline16 size={14} />
                  {t('customAdd')}
                </ShadcnButton>
              </div>
            )}
      </div>
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRef === undefined
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={DELETE_DIALOG}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={DELETE_CONFIRM}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={ERROR}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}

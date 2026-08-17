/**
 * One provider's editor card, hand-written per adapter family: the primary
 * field is a single write-only **API key** input (the page never asks for an
 * environment-variable name — a typed key stores through `credentials.set`
 * under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile
 * has none. The pi-ai profile records that derivation as `apiKeyEnv` only when
 * a key is entered; a blank key materializes a reference-free profile for
 * provider-native authentication);
 * the collapsed 自定义设置 area carries the per-family extras (`baseURL` for
 * both families, DeepSeek's id/name/context-window model catalog, and the
 * display name and wire protocol of a pi-ai route the adapter does not ship —
 * the two fields the create card asked that route for, editable here for the
 * same reason).
 * Reasoning effort is deliberately absent: it is a per-MODEL capability, and
 * the models under one provider disagree about it, so a provider-scoped
 * control can only be set to a value some of them reject. The composer's
 * model picker offers each model its own levels; `settings.yaml` keeps the
 * profile field for a deployment that knows its route. Everything else stays
 * owned by `settings.yaml`. Profile edits land as minimal `settings.mutate`
 * path ops against the stored section — the card names only the fields it can
 * see instead of rebuilding the whole subtree from a partial descriptor.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CredentialView, IApiClient, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  deletePath, getPath, hasPath, nodeAtPath, rehydrateSchema, setPath, validateDraft,
} from '@deepseek-ai/dsh-client-schema-form'
import {
  IconCopyOutline16, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  ShadcnButton, ShadcnInput,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DeepSeekModelsEditor, modelDrafts, validateDeepSeekModels,
} from './DeepSeekModelsEditor.tsx'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import { deriveKeyRef, messageOf, protocolChoices } from './store.ts'
import type { en } from './locales.ts'

/** Per-adapter-family curated field sets (unknown namespaces get the hint alone). */
type EditorLayout = 'deepseek' | 'pi-ai' | 'unknown'

/** Sentinel select value naming "no protocol" (Radix forbids an empty item value). */
const UNSET_PROTOCOL = '__unset__'

const FIELD = 'flex flex-col gap-1.5'
const FIELD_LABEL = 'inline-flex items-center gap-2.5 text-xs leading-[18px] font-medium text-[var(--dsw-alias-label-secondary)]'
const EDITOR = 'flex flex-col gap-[14px] rounded-xl bg-[var(--dsw-alias-bg-module-platform)] px-4 py-[14px]'
const ADD_BLOCK = 'flex flex-col gap-3'
const EDITOR_HEADER = 'flex items-baseline gap-2'
const EDITOR_TITLE = 'text-sm leading-[22px] font-medium text-foreground'
const EDITOR_ROUTE = 'text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const ADVANCED_HINT = 'advancedHint m-0 text-xs leading-[18px] text-[var(--dsw-alias-label-tertiary)]'
const ERROR = 'error m-0 text-xs leading-[18px] text-[var(--dsw-alias-state-error-primary)]'
const INPUT =
  'h-8 rounded-lg border-border bg-card px-2.5 py-0 text-sm leading-[22px] text-foreground shadow-none placeholder:text-[var(--dsw-alias-label-dimmed)] focus:border-[var(--dsw-alias-brand-primary)] focus-visible:ring-0 disabled:opacity-60 disabled:cursor-default'
const CUSTOMIZED = 'border-t border-border pt-2.5'
const CUSTOMIZED_SUMMARY =
  'flex w-fit cursor-pointer list-none items-center gap-1.5 -ml-1 rounded-md px-1 py-0.5 text-xs leading-[18px] font-medium text-[var(--dsw-alias-label-secondary)] hover:text-foreground dsh-customized-summary'
const CUSTOMIZED_BODY = 'flex flex-col gap-3 pt-3'

/** Props of {@link ProviderEditor}. */
export interface ProviderEditorProps {
  /** Provider route id. */
  provider: string
  /** Display name for the card title. */
  displayName: string
  /** The adapter's default endpoint, prefill for the base-URL field. */
  baseUrl?: string
  /** Hide the title row (the add card renders its own provider select). */
  hideTitle?: boolean
  /**
   * Whether the adapter reports this route as hand-declared — absent from its
   * installed catalog. Such a route carries its own wire protocol, chosen when
   * it was created and editable here for the same reason; a catalog route's
   * models each carry theirs, so a route-level protocol there could only
   * override every one of them and the card does not offer it.
   */
  declared?: boolean
  /** The owning namespace view (schema, layers, secrets). */
  namespace: SettingsNamespaceView
  /** Path from the section root to this provider's profile. */
  settingsPath: readonly string[]
  /** Wire faces for writes and for interrogating a provider endpoint. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Render only the credential field and actions, without provider settings. */
  credentialOnly?: boolean
  /** Require a newly entered credential before this editor can submit. */
  credentialRequired?: boolean
  /** Give the credential field initial focus when this editor mounts. */
  autoFocusCredential?: boolean
  /** Override the dismiss action copy. */
  cancelLabel?: keyof typeof en
  /** Override the idle commit action copy. */
  submitLabel?: keyof typeof en
  /** Override the in-flight commit action copy. */
  submitBusyLabel?: keyof typeof en
  /** Close the editor; `changed` reports whether an Apply committed. */
  onClose: (changed: boolean) => void
}

/** A user-section subtree as a plain draft object (absent → empty). */
function draftAt(namespace: SettingsNamespaceView, path: readonly string[]): Record<string, unknown> {
  const subtree = getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return structuredClone(subtree) as Record<string, unknown>
}

/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 * @param base - path of the edited subtree inside the user section.
 * @param before - the subtree as loaded, or undefined when it is new.
 * @param after - the subtree as edited.
 * @returns ordered set/unset ops; empty when nothing changed.
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOpView[] {
  const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
    ? before as Record<string, unknown>
    : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** The editor layout the owning namespace selects. */
function layoutOf(ns: string): EditorLayout {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

/** The credential reference this profile resolves keys through. */
function refFor(namespace: SettingsNamespaceView, path: readonly string[], provider: string): string {
  const profile = getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider)
}

/**
 * Render one provider's editing card.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the editor card.
 */
export function ProviderEditor(props: ProviderEditorProps): ReactNode {
  const { namespace, settingsPath, api, t } = props
  const [draft, setDraft] = useState<Record<string, unknown>>(() => draftAt(namespace, settingsPath))
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<CredentialView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // The show / copy buttons work against two sources, in priority order:
  // a typed value the user has not yet saved, then the value resolved from
  // the credential store when no typed value is pending. Either source keeps
  // the input in sync with `keyDraft` so unmasking the field does not also
  // drop the unsaved edit. Both timers auto-clear their state so a hidden or
  // copied secret does not linger in DOM memory.
  const [keyRevealed, setKeyRevealed] = useState<string | undefined>(undefined)
  const [keyVisible, setKeyVisible] = useState(false)
  const [copyFlash, setCopyFlash] = useState<'idle' | 'done' | 'failed'>('idle')
  // A settings success advances both retry baselines immediately. Keeping the
  // derived fields in the draft prevents a pushed namespace refresh from
  // turning them into deletions when the following credential write is retried.
  const [committedOriginal, setCommittedOriginal] = useState<unknown>(
    () => getPath(namespace.user, settingsPath),
  )
  const [expectedRevision, setExpectedRevision] = useState(() => namespace.revision)
  const root = useMemo(() => rehydrateSchema(namespace.schema), [namespace.schema])
  const node = useMemo(() => nodeAtPath(root, settingsPath), [root, settingsPath])
  const fallback = getPath(namespace.value, settingsPath)
  const disabled = props.readOnly || busy
  const layout = layoutOf(namespace.ns)
  const keyRef = refFor(namespace, settingsPath, props.provider)
  // The same schema read the create card makes, so the choices offered here
  // and there cannot drift apart: both come from the adapter's own `Config`.
  // Only the pi-ai layout has a per-route protocol for the read to find, and
  // it rehydrates the whole section schema, so the other layouts skip it.
  const protocols = useMemo(
    () => layout === 'pi-ai' ? protocolChoices(namespace) : [],
    [layout, namespace],
  )

  useEffect(() => {
    let stale = false
    setKeyState(undefined)
    // The key state is a placeholder hint, not a precondition for editing:
    // neither a business rejection nor a transport failure may reach the
    // browser as an unhandled rejection, so the card simply renders without
    // the "already configured" hint.
    void api.credentials.describe({ refs: [keyRef] }).then(
      (response) => {
        if (stale || !response.result.ok) return
        setKeyState(response.result.value.credentials[keyRef])
      },
      () => undefined,
    )
    return () => { stale = true }
  }, [api.credentials, keyRef])

  const stringAt = (source: unknown, key: string): string | undefined => {
    const value = getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setField = (key: string, next: string | undefined): void => {
    // A value of nothing but whitespace is cleared, not stored: `stringAt`
    // already reports it as absent, so the field would otherwise render empty
    // while the draft still carried the spaces into `settings.yaml`, where
    // both adapters would accept that non-empty string as a real value.
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined ? deletePath(current, [key]) : setPath(current, [key], value))
  }
  // The value the show/copy buttons read: a freshly typed draft first, the
  // resolved stored value second. Empty draft + empty reveal = no key to act
  // on; the buttons disable themselves.
  const keyForActions = keyDraft.trim().length > 0 ? keyDraft : (keyRevealed ?? '')
  const hasKeyForActions = keyForActions.length > 0
  const toggleKeyVisible = (): void => {
    if (keyVisible) {
      setKeyVisible(false)
      return
    }
    if (keyDraft.trim().length > 0) {
      setKeyVisible(true)
      return
    }
    // No typed value: ask the host to resolve the stored one, then flip the
    // input type. The RPC is the only path that can echo back a configured
    // key — describe intentionally does not return the value.
    void api.credentials.reveal({ ref: keyRef }).then(
      (response) => {
        if (!response.result.ok) {
          setFailure('keyRevealFailed')
          return
        }
        if (response.result.value.value !== null) {
          setKeyRevealed(response.result.value.value)
          setKeyVisible(true)
        }
      },
      () => { setFailure('keyRevealFailed') },
    )
  }
  const copyKey = (): void => {
    if (!hasKeyForActions) return
    void navigator.clipboard.writeText(keyForActions).then(
      () => {
        setCopyFlash('done')
        setTimeout(() => { setCopyFlash('idle') }, 1500)
        // Auto-clear the clipboard after 30s so the secret does not outlive
        // the user's intent to paste it.
        setTimeout(() => {
          void navigator.clipboard.writeText('').catch(() => undefined)
        }, 30_000)
      },
      () => { setCopyFlash('failed') },
    )
  }

  // The model list is validated by the same per-row checker for both families,
  // so a bad row is named by its position rather than by a blanket message.
  const modelFailure = validateDeepSeekModels(getPath(draft, ['models']))
  const keyFailure = apiKeyFailure(keyDraft)
  // What a probe or a write must carry: the typed key with paste whitespace
  // removed. A blank field yields an empty string, which both call sites read
  // as "no key supplied" rather than as a key — that is how a card whose
  // provider already has a stored key is edited without re-entering it.
  const keyValue = keyDraft.trim()
  const credentialRequiredFailure = props.credentialRequired === true
    && keyDraft.length > 0 && keyValue.length === 0
    ? 'keyRequired' as const
    : undefined
  const shownKeyFailure = credentialRequiredFailure ?? keyFailure
  // What the form currently shows, which is what an interrogation must ask:
  // an edited-but-unsaved endpoint, and a key typed but not yet stored.
  const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api')
  const probeBaseURL = stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL')
  const probe = {
    settingsNs: namespace.ns,
    // Naming the route lets an adapter that already describes it answer from
    // its own registry — better metadata, no network call, no endpoint needed.
    provider: props.provider,
    ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
    ...probeApi === undefined ? {} : { api: probeApi },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue },
  }
  /**
   * The write for this card, or a failure message. Every edit travels as
   * path ops against the STORED section: the draft comes from the redacted
   * descriptor, so a wholesale replace rebuilt from it could delete fields
   * outside the card. Ops name only the fields this card can see.
   */
  const applyOnce = async (): Promise<string | undefined> => {
    const ns = namespace.ns
    // A pi-ai profile names the conventional reference only when this page is
    // about to store a key. Otherwise the provider keeps its native auth path.
    const next = layout === 'pi-ai' && stringAt(draft, 'apiKeyEnv') === undefined
      && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
      ? setPath(draft, ['apiKeyEnv'], keyRef)
      : draft
    if (props.credentialOnly !== true) {
      // The same checker gates the submit button, so a card cannot reach this
      // with a bad row; it stays because the schema check below would refuse
      // the write with a message naming a path instead of the row, and because
      // nothing but this function decides what is written.
      const failure = validateDeepSeekModels(getPath(next, ['models']))
      /* v8 ignore next 3 -- unreachable from the card: the same failure disables submit */
      if (failure !== undefined) {
        return `${t('model')} ${String(failure.index + 1)}: ${t(failure.key)}`
      }
    }
    /* v8 ignore next -- apply is only reachable from the rendered card, which required a resolved node */
    if (props.credentialOnly !== true && node !== undefined && settingsPath.length === 0) {
      const sectionError = validateDraft(node, next)
      if (sectionError !== undefined) return sectionError
    }
    // A dormant route (no base-layer profile and no user profile yet) that the
    // user is activating with a key but no other field still materializes an
    // empty profile object — the profile's existence is what registers the
    // route, and the schema defaults fill the rest (apiKeyEnv, models).
    const materializesProfile = (layout === 'pi-ai' || layout === 'deepseek')
      && fallback === undefined
      && committedOriginal === undefined
      && Object.keys(next).length === 0
    const ops: SettingsPathOpView[] = props.credentialOnly === true
      ? []
      : materializesProfile
        ? [{ op: 'set', path: [...settingsPath], value: {} }]
        : pathOps(settingsPath, committedOriginal, next)
    if (ops.length > 0) {
      const response = await api.settings.mutate({ ns, ops, expectedRevision })
      if (!response.result.ok) {
        return response.result.error.code === 'settings-conflict'
          ? t('conflict')
          : response.result.error.message
      }
      setCommittedOriginal(getPath(response.result.value.user, settingsPath))
      setExpectedRevision(response.result.value.revision)
      setDraft(next)
    }
    if (keyValue.length > 0) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    setKeyDraft('')
    return undefined
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const failure = await applyOnce()
      if (failure !== undefined) {
        setFailure(failure)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure (disconnect, a request the host refuses) rejects
      // rather than answering; without this the card would stay busy forever
      // with no error shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  if (node === undefined) {
    // A directory entry addressing a position its schema cannot resolve is a
    // host-side inconsistency; showing it beats a blank card.
    return <p className={ERROR}>{`${props.provider}: unresolvable settings path`}</p>
  }

  const keyLocked = keyState?.writable === false

  /**
   * The catalog beneath the user layer: what the composition entry pinned, or
   * else the schema default that `resolve` would supply. The effective value
   * cannot answer this — it still carries the stored override until the unset
   * is applied, so reading it would echo that override straight back the
   * moment reset drops it, leaving the rows unchanged until a reload.
   */
  const inheritedModels = (): unknown => {
    const pinned = getPath(namespace.base, [...settingsPath, 'models'])
    return pinned ?? nodeAtPath(root, [...settingsPath, 'models'])?.meta.default
  }

  /**
   * The curated fields of one known adapter family. The family arrives
   * narrowed so the per-family branches below are total: an unknown namespace
   * renders the hint instead and never reaches this body.
   */
  const curatedFields = (family: 'deepseek' | 'pi-ai'): ReactNode => {
    // What a hand-declared route names for itself and nothing else can supply.
    // A whole-section `llm-deepseek` profile is a composition fact with no
    // per-route identity for its schema to carry, hence the family test.
    const ownsIdentity = family === 'pi-ai' && props.declared === true
    const customModels = getPath(draft, ['models'])
    const modelsOverridden = hasPath(draft, ['models'])
    const models = modelDrafts(modelsOverridden ? customModels : inheritedModels())
    const defaultContextWindow = getPath(fallback, ['defaultContextWindow'])
    const defaultMaxTokens = getPath(fallback, ['maxTokens'])
    const keyPlaceholder = keyLocked
      ? t('keyEnvLocked')
      : keyState?.configured === true && props.credentialRequired !== true
        ? t('keyStored')
        : family === 'pi-ai' ? t('keyPlaceholderNative') : t('keyPlaceholder')
    /** What both family editors take: the rows, whose layer owns them, and the two writes. */
    const catalogProps = {
      models,
      overridden: modelsOverridden,
      t,
      disabled,
      onChange: (next: Record<string, unknown>[]) => {
        setDraft(current => setPath(current, ['models'], next))
      },
      onReset: () => { setDraft(current => deletePath(current, ['models'])) },
    }
    return (
      <>
        <div className={FIELD}>
          <span className={FIELD_LABEL}>{t('keyInput')}</span>
          <div className="flex items-stretch gap-1.5">
            <ShadcnInput
              className={INPUT + ' flex-1'}
              type={keyVisible ? 'text' : 'password'}
              autoComplete="off"
              value={keyDraft}
              placeholder={keyPlaceholder}
              aria-label={t('keyInput')}
              aria-invalid={shownKeyFailure !== undefined}
              required={props.credentialRequired === true}
              autoFocus={props.autoFocusCredential === true}
              disabled={disabled || keyLocked}
              onChange={(event) => {
                setKeyDraft(event.target.value)
                // A typed value makes the stored reveal moot: the user is now
                // editing, not verifying. Drop the resolved value so a later
                // unmask does not also reset their draft.
                if (keyRevealed !== undefined) setKeyRevealed(undefined)
              }}
            />
            <ShadcnButton
              type="button"
              variant="outline"
              className="h-8 shrink-0 rounded-lg border-border px-2.5 text-xs leading-[22px]"
              disabled={disabled || keyLocked || (!hasKeyForActions && keyState?.configured !== true)}
              aria-label={keyVisible ? t('keyHide') : t('keyShow')}
              onClick={toggleKeyVisible}
            >
              {keyVisible ? t('keyHide') : t('keyShow')}
            </ShadcnButton>
            <ShadcnButton
              type="button"
              variant="outline"
              className="h-8 w-8 shrink-0 rounded-lg border-border p-0"
              disabled={disabled || keyLocked || !hasKeyForActions}
              aria-label={copyFlash === 'done' ? t('keyCopyDone') : copyFlash === 'failed' ? t('keyCopyFailed') : t('keyCopy')}
              onClick={copyKey}
              title={copyFlash === 'done' ? t('keyCopyDone') : copyFlash === 'failed' ? t('keyCopyFailed') : t('keyCopy')}
            >
              <IconCopyOutline16 size={14} />
            </ShadcnButton>
          </div>
          {shownKeyFailure === undefined ? null : <p className={ERROR}>{t(shownKeyFailure)}</p>}
        </div>
        {props.credentialOnly === true ? null : (
          <>
            <div className={FIELD}>
              <span className={FIELD_LABEL}>{t('baseUrl')}</span>
              <ShadcnInput
                className={INPUT}
                type="text"
                value={stringAt(draft, 'baseURL') ?? ''}
                placeholder={props.baseUrl ?? stringAt(fallback, 'baseURL') ?? t('baseUrlDefault')}
                aria-label={t('baseUrl')}
                disabled={disabled}
                onChange={(event) => {
                  setField('baseURL', event.target.value === '' ? undefined : event.target.value)
                }}
              />
            </div>
            <details className={CUSTOMIZED}>
              <summary className={CUSTOMIZED_SUMMARY}>{t('customized')}</summary>
              <div className={CUSTOMIZED_BODY}>
                {/* The name and the protocol are the create card's two remaining
                profile fields; a route the adapter ships defaults both from
                its catalog entry and neither belongs on its card. */}
                {ownsIdentity
                  ? (
                    <div className={FIELD}>
                      <span className={FIELD_LABEL}>{t('customDisplayName')}</span>
                      <ShadcnInput
                        className={INPUT}
                        type="text"
                        value={stringAt(draft, 'displayName') ?? ''}
                        // What this route is called the moment the field is
                        // cleared, which is the layer beneath the one this field
                        // edits: a `cordis.yml` may pin a name for a route the
                        // catalog does not ship, and only when nothing does is
                        // the answer the route id. Reading the effective value
                        // instead would echo the stored override back as the
                        // thing clearing restores.
                        placeholder={stringAt(getPath(namespace.base, settingsPath), 'displayName')
                      ?? props.provider}
                        aria-label={t('customDisplayName')}
                        disabled={disabled}
                        onChange={(event) => { setField('displayName', event.target.value) }}
                      />
                    </div>
                  )
                  : null}
                {/* The protocol sits beside the endpoint it describes, as it does
                on the create card. */}
                {ownsIdentity
                  ? (
                    <div className={FIELD}>
                      <span className={FIELD_LABEL}>{t('customApi')}</span>
                      <div className="max-w-[240px]">
                        <Select
                          value={probeApi ?? UNSET_PROTOCOL}
                          disabled={disabled}
                          onValueChange={(value) => { setField('api', value === UNSET_PROTOCOL ? undefined : value) }}
                        >
                          <SelectTrigger className={INPUT} aria-label={t('customApi')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* A profile naming no protocol — hand-written into
                            settings.yaml with no model to need one — selects
                            nothing rather than reading as if it had picked the
                            first choice. The option is named because a screen
                            reader announces it either way, and an empty one is
                            announced as a choice with no identity. */}
                            {probeApi === undefined
                              ? <SelectItem value={UNSET_PROTOCOL}>{t('customApiUnset')}</SelectItem>
                              : null}
                            {protocols.map(choice => <SelectItem key={choice} value={choice}>{choice}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )
                  : null}
                {/* Both families edit the same rows through the same contract; only
                the extras differ — DeepSeek's inherited capacities, pi-ai's
                endpoint interrogation. */}
                {family === 'deepseek'
                  ? (
                    <DeepSeekModelsEditor
                      {...catalogProps}
                      defaultContextWindow={typeof defaultContextWindow === 'number'
                        ? defaultContextWindow
                        : undefined}
                      defaultMaxTokens={typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined}
                    />
                  )
                  : <ModelListEditor {...catalogProps} probe={probe} probeBlocked={keyFailure} api={api} />}
              </div>
            </details>
          </>
        )}
      </>
    )
  }

  return (
    <div className={props.hideTitle === true || props.credentialOnly === true ? ADD_BLOCK : EDITOR}>
      {props.hideTitle === true
        ? null
        : (
          <div className={EDITOR_HEADER}>
            <span className={EDITOR_TITLE}>{props.displayName}</span>
            {props.provider !== props.displayName
              ? <span className={EDITOR_ROUTE}>{props.provider}</span>
              : null}
          </div>
        )}
      {layout === 'unknown'
        ? <p className={ADVANCED_HINT}>{`${t('advancedHint')} (${namespace.ns})`}</p>
        : curatedFields(layout)}
      {failure !== undefined ? <p className={ERROR}>{failure}</p> : null}
      {props.credentialOnly === true || modelFailure === undefined
        ? null
        : (
          <p className={ADVANCED_HINT}>
            {`${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}
          </p>
        )}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || layout === 'unknown'
          || (props.credentialOnly !== true && modelFailure !== undefined)
          || shownKeyFailure !== undefined
          || (props.credentialRequired === true && keyValue.length === 0)}
        submitLabel={props.submitLabel ?? 'apply'}
        submitBusyLabel={props.submitBusyLabel ?? 'applying'}
        {...props.cancelLabel === undefined ? {} : { cancelLabel: props.cancelLabel }}
        onCancel={() => { props.onClose(false) }}
        onSubmit={() => { void apply() }}
      />
    </div>
  )
}

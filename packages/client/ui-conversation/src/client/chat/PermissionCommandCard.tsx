// PermissionCommandCard: the `/permission` command row. The host settlement
// text is `preset <name>`; this localizes the built-in preset name and leaves
// every other outcome (errors, the no-argument summary) to the generic card.

import type { CommandRowProps } from '../contract/slots.ts'
import type { ConversationKey } from '../locales.ts'
import { GenericCommandCard } from './GenericCommandCard.tsx'

/** Built-in preset ids with a localized product label; custom presets fall back. */
const PRESET_LABEL_KEYS: ReadonlySet<string> = new Set([
  'preset.read-only',
  'preset.workspace-write',
  'preset.danger-full-access',
])

/** Localize the preset name embedded in a `preset <name>` settlement text. */
function localizedSettlement(text: string, t: CommandRowProps['t']): string | undefined {
  const preset = /^preset (.+)$/.exec(text)?.[1]
  if (preset === undefined) return undefined
  const key = `preset.${preset}` as ConversationKey
  return PRESET_LABEL_KEYS.has(key) ? t(key) : preset
}

/**
 * Render one `/permission` command lifecycle under a localized preset label.
 * @param props - the commandview owner share + locale seat.
 * @returns the localized command row.
 */
export function PermissionCommandCard({ node, t }: CommandRowProps) {
  const outcome = node.outcome
  if (outcome === null || outcome.text === undefined) {
    return <GenericCommandCard node={node} t={t} />
  }
  const label = localizedSettlement(outcome.text, t)
  if (label === undefined) return <GenericCommandCard node={node} t={t} />
  return <GenericCommandCard node={{ ...node, outcome: { ...outcome, text: label } }} t={t} />
}

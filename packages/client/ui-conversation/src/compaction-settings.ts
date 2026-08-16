/** Auto-compact preference stored in the Host user-settings document. */

/** Settings namespace owned by the Host-side compaction-basic engine. */
export const COMPACTION_SETTINGS_NAMESPACE = 'compaction'

/** Enable automatic pressure / red-line / overflow compaction. */
export const DEFAULT_AUTO_COMPACT = true
/** Warn-level threshold as a fraction of the context window (80%). */
export const DEFAULT_THRESHOLD_RATIO = 0.8
/** Red-line threshold as a fraction of the context window (90%). */
export const DEFAULT_REDLINE_RATIO = 0.9

/**
 * The auto-compact fields this client reads and writes. All fields are
 * optional: the Host schema owns the resolved defaults, so an absent field
 * (no stored override yet) is `undefined` and the policy falls back to its
 * own default. Ratios are stored as fractions (0–1), not percentages.
 */
export interface CompactionSettings {
  auto?: boolean
  thresholdRatio?: number
  redlineRatio?: number
}

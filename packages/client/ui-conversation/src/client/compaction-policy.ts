/**
 * Auto-compact policy shared by the composer quick toggle and the General
 * settings row. One instance owns three live ratio stores (auto, warn
 * threshold, red line) and adopts a Host settings section over them; the
 * composer switch and the settings sliders read and write the same instance.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { CompactionSettings } from '../compaction-settings.ts'
import {
  DEFAULT_AUTO_COMPACT, DEFAULT_REDLINE_RATIO, DEFAULT_THRESHOLD_RATIO,
} from '../compaction-settings.ts'

export { DEFAULT_AUTO_COMPACT, DEFAULT_REDLINE_RATIO, DEFAULT_THRESHOLD_RATIO } from '../compaction-settings.ts'

/** The live auto-compact policy, mirroring the Host settings section. */
export class CompactionSettingsPolicy {
  /** Reactive enable flag for the composer switch and settings toggle. */
  readonly auto: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_AUTO_COMPACT)
  /** Reactive warn threshold ratio (0–1) for the settings slider. */
  readonly thresholdRatio: SnapshotStore<number> = createSnapshotStore(DEFAULT_THRESHOLD_RATIO)
  /** Reactive red-line threshold ratio (0–1) for the settings slider. */
  readonly redlineRatio: SnapshotStore<number> = createSnapshotStore(DEFAULT_REDLINE_RATIO)
  private readonly host: SettingsScope<CompactionSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<CompactionSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /** Toggle automatic compaction; publishes before the durable write starts. */
  setAuto(value: boolean): void {
    if (this.auto.getSnapshot() === value) return
    this.auto.set(value)
    void this.host?.set('auto', value)
  }

  /** Preview a warn threshold change locally without persisting (smooth drag). */
  previewThresholdRatio(value: number): void {
    this.thresholdRatio.set(value)
  }

  /** Preview a red-line change locally without persisting (smooth drag). */
  previewRedlineRatio(value: number): void {
    this.redlineRatio.set(value)
  }

  /** Set the warn threshold ratio (0–1). */
  setThresholdRatio(value: number): void {
    if (this.thresholdRatio.getSnapshot() === value) return
    this.thresholdRatio.set(value)
    void this.host?.set('thresholdRatio', value)
  }

  /** Set the red-line threshold ratio (0–1). */
  setRedlineRatio(value: number): void {
    if (this.redlineRatio.getSnapshot() === value) return
    this.redlineRatio.set(value)
    void this.host?.set('redlineRatio', value)
  }

  /** Adopt each accepted durable field without writing it back. */
  private adopt(host: SettingsScope<CompactionSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    if (section.auto !== undefined && this.auto.getSnapshot() !== section.auto) this.auto.set(section.auto)
    if (section.thresholdRatio !== undefined && this.thresholdRatio.getSnapshot() !== section.thresholdRatio) {
      this.thresholdRatio.set(section.thresholdRatio)
    }
    if (section.redlineRatio !== undefined && this.redlineRatio.getSnapshot() !== section.redlineRatio) {
      this.redlineRatio.set(section.redlineRatio)
    }
  }
}

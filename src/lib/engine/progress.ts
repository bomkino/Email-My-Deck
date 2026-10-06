/**
 * inspect: reading the file. tidy: lossless rewrite. photos: re-saving images
 * at their size. resize: shrinking images bigger than the slide needs (shares
 * the photos band). verify: assembling and checking. split: packing parts.
 */
export type EngineStage = 'inspect' | 'tidy' | 'photos' | 'resize' | 'verify' | 'split'

export type ProgressEvent = {
  stage: EngineStage
  label: string
  /** Whole-job progress, 0..1. Never goes backwards within a job. */
  fraction: number
  page?: number
  pages?: number
}

/** Share of the whole job each stage occupies. Splitting continues after `verify`. */
export const STAGE_BANDS: Record<EngineStage, [number, number]> = {
  inspect: [0.02, 0.06],
  tidy: [0.06, 0.16],
  photos: [0.16, 0.78],
  resize: [0.16, 0.78],
  verify: [0.78, 0.9],
  split: [0.9, 0.99],
}

export const STAGE_LABELS: Record<EngineStage, string> = {
  inspect: 'Reading your deck',
  tidy: 'Tidying the file (nothing visible changes)',
  photos: 'Re-saving photos a little lighter',
  resize: 'Resizing photos to screen size',
  verify: 'Checking every slide made it',
  split: 'Splitting into emails',
}

const MIN_INTERVAL_MS = 80

/** Turns stage-local progress into one monotonic, throttled whole-job fraction. */
export class ProgressReporter {
  private emitFn: (event: ProgressEvent) => void
  private now: () => number
  private value: number
  private band: [number, number] = [0, 1]
  private stage: EngineStage = 'inspect'
  private label = STAGE_LABELS.inspect
  private lastEmit = -Infinity

  constructor(emit: (event: ProgressEvent) => void, start = 0, now: () => number = () => performance.now()) {
    this.emitFn = emit
    this.value = start
    this.now = now
  }

  get fraction(): number {
    return this.value
  }

  enter(stage: EngineStage, label = STAGE_LABELS[stage], band = STAGE_BANDS[stage]): void {
    this.stage = stage
    this.label = label
    // A later request in the same job may start below this stage's usual band.
    this.band = [Math.max(band[0], this.value), Math.max(band[1], this.value)]
    this.push(0, {}, true)
  }

  /** Change what the current stage is called without restarting its share of the bar. */
  relabel(stage: EngineStage, label = STAGE_LABELS[stage]): void {
    if (stage === this.stage && label === this.label) return
    this.stage = stage
    this.label = label
    this.push(0, {}, true)
  }

  /** Report progress within the current stage (0..1). */
  update(within: number, extra: { page?: number; pages?: number; label?: string } = {}): void {
    if (extra.label) this.label = extra.label
    this.push(within, extra, false)
  }

  private push(within: number, extra: { page?: number; pages?: number }, force: boolean): void {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(within) ? within : 0))
    const next = this.band[0] + (this.band[1] - this.band[0]) * clamped
    if (next > this.value) this.value = next
    const time = this.now()
    if (!force && time - this.lastEmit < MIN_INTERVAL_MS) return
    this.lastEmit = time
    const event: ProgressEvent = { stage: this.stage, label: this.label, fraction: Math.round(this.value * 1000) / 1000 }
    if (extra.page !== undefined) event.page = extra.page
    if (extra.pages !== undefined) event.pages = extra.pages
    this.emitFn(event)
  }
}

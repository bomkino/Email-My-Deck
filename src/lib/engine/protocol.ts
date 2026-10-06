/**
 * Messages between the page and src/workers/pdf.worker.ts.
 *
 * Every field the first release used is unchanged; everything else is
 * optional and additive, so an older UI keeps working.
 */
import type { CompressionOutcome } from '../compression'
import type { TargetProfileId } from '../profiles'
import type { EngineErrorCode, ProtectedReason } from './errors'
import type { EngineStage } from './progress'

/** What this engine build can do beyond compressing and splitting. The page offers only what's here. */
export const ENGINE_FEATURES = {
  /** `split` honours `breakAfter`, and a result that doesn't fit carries `splitPlan`. */
  splitAt: true,
  /** `compress` with `mode: 'flatten'` turns pages into pictures. */
  flatten: false,
} as const

export type CompressRequest = {
  type: 'compress'
  jobId: number
  bytes: Uint8Array
  profileId: TargetProfileId
  /** Custom limit in decimal MB. */
  customMessageMB?: number
  /** Older name for the same decimal-MB value. */
  customMessageMiB?: number
  /** Split in the same job when nothing fits, and answer with `split-result` only. Without it, a result that doesn't fit carries `splitPlan`. */
  autoSplit?: boolean
}

export type SplitRequest = {
  type: 'split'
  jobId: number
  bytes: Uint8Array
  maxPartBytes: number
  /** Split after these pages (1-based, ascending), exactly. Without it, the fewest parts that fit. */
  breakAfter?: number[]
}

export type WorkerRequest = CompressRequest | SplitRequest

export type ProgressMessage = {
  type: 'progress'
  jobId: number
  label: string
  /** 0..1 for the whole job, compress and split together. Never decreases. */
  fraction: number
  stage?: EngineStage
  /** During 'photos': the slide being worked on. During 'split': pages placed so far. */
  page?: number
  pages?: number
}

export type CompressResultMessage = { type: 'compress-result'; jobId: number; outcome: CompressionOutcome }

/** `fits` is false for a part placed with `breakAfter` that measured over `maxPartBytes`. */
export type SplitResultPart = { bytes: Uint8Array; pages: number; startPage: number; endPage: number; fits?: boolean }

export type SplitResultMessage = {
  type: 'split-result'
  jobId: number
  parts: SplitResultPart[]
  /** Present for `autoSplit`; describes the version that was split. */
  outcome?: CompressionOutcome
}

export type ErrorMessage = {
  type: 'error'
  jobId: number
  message: string
  code?: EngineErrorCode
  reason?: ProtectedReason
  page?: number
}

export type WorkerMessage = ProgressMessage | CompressResultMessage | SplitResultMessage | ErrorMessage

import type { Attempt, EngineResult, ImageStats } from './engine/engine'
import type { SplitPlan } from './engine/split'
import type { PdfInspection } from './pdf'
import { estimatedMessageBytes, type TargetProfile } from './profiles'

export type CompressionCandidate = {
  bytes: Uint8Array
  engine: 'original' | 'qpdf' | 'images'
  quality: 'preserved' | 'optimized' | 'strong'
  notes: string[]
}

/** Facts for a plain-words receipt. Every number is measured on this device. */
export type CompressionReceipt = {
  originalBytes: number
  outputBytes: number
  pages: number
  images: ImageStats
  /** Long edge, in pixels, that a full-page image keeps (only when images were rewritten). */
  longEdgePx?: number
  /** JPEG quality 1–100 used for re-saved photos. */
  jpegQuality?: number
  /** True when no image or visible content changed. */
  lossless: boolean
  /** What was verified on the result: 'unchanged' | 'page-count' | 'page-size' | 'structure'. */
  checks: string[]
  attempts: Attempt[]
}

export type CompressionOutcome = {
  candidate: CompressionCandidate
  targetBytes: number
  estimatedMessageBytes: number
  /** True only when the checks in `receipt.checks` passed on `candidate.bytes`. */
  verified: boolean
  /** True when `candidate` is within `targetBytes`. When false, `candidate` is the version to split. */
  fits: boolean
  inspection: PdfInspection
  receipt: CompressionReceipt
  splitReason?: 'quality-floor' | 'browser-cannot-resize'
  /** When it doesn't fit: estimated part weights of `candidate`, for choosing where to split it. */
  splitPlan?: SplitPlan
  elapsedMs: number
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function describeResult(result: Pick<EngineResult, 'kind' | 'images' | 'rung'>): string[] {
  if (result.kind === 'original') return ['Your original already fits. Nothing was changed.']
  if (result.kind === 'lossless' || (result.kind === 'split-needed' && !result.rung)) {
    return ['Tidied the file’s internal structure only. Every slide and image is unchanged.']
  }
  const notes: string[] = []
  const { resized, resaved, untouched } = result.images
  if (resized && result.rung) notes.push(`Resized ${plural(resized, 'image')} for a ${result.rung.longEdgePx}-pixel-wide slide.`)
  if (resaved) notes.push(`Re-saved ${plural(resaved, 'photo')} a little lighter.`)
  if (untouched) notes.push(`${plural(untouched, 'image')} left exactly as they were.`)
  notes.push('Text, links and slide order are untouched.')
  return notes
}

export function toOutcome(result: EngineResult, originalBytes: number, profile: TargetProfile, targetBytes: number): CompressionOutcome {
  const rewroteImages = result.images.resized + result.images.resaved > 0
  const engine: CompressionCandidate['engine'] = result.kind === 'original' ? 'original' : rewroteImages ? 'images' : 'qpdf'
  const quality: CompressionCandidate['quality'] = !rewroteImages ? 'preserved' : result.images.resized ? 'strong' : 'optimized'
  return {
    candidate: { bytes: result.bytes, engine, quality, notes: describeResult(result) },
    targetBytes,
    estimatedMessageBytes: estimatedMessageBytes(result.bytes.byteLength, profile),
    verified: result.checks.length > 0,
    fits: result.kind !== 'split-needed' && result.bytes.byteLength <= targetBytes,
    inspection: { pages: result.pageCount, pageSizes: result.pageSizes, images: result.images.total },
    receipt: {
      originalBytes,
      outputBytes: result.bytes.byteLength,
      pages: result.pageCount,
      images: result.images,
      longEdgePx: rewroteImages ? result.rung?.longEdgePx : undefined,
      jpegQuality: rewroteImages && result.rung ? Math.round(result.rung.jpegQuality * 100) : undefined,
      lossless: !rewroteImages,
      checks: result.checks,
      attempts: result.attempts,
    },
    splitReason: result.splitReason,
    elapsedMs: result.elapsedMs,
  }
}

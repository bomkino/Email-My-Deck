import type { Placement } from './content'
import type { ImageRecord, PageInfo } from './inspect'

/**
 * The quality ladder. Each rung says how many pixels a full-page image keeps
 * along the page's long edge, and how gently photos are re-saved. The engine
 * picks the highest rung whose result fits; below the floor it splits instead.
 *
 * Pixels are measured against the page, not inches, because deck exporters
 * disagree wildly about page size (Keynote 1920 pt, PowerPoint 960 pt, A4 595 pt).
 */
export type Rung = {
  id: 'sharp' | 'retina' | 'screen' | 'floor'
  longEdgePx: number
  jpegQuality: number
}

export const RUNGS: readonly Rung[] = [
  { id: 'sharp', longEdgePx: 3840, jpegQuality: 0.85 },
  { id: 'retina', longEdgePx: 2880, jpegQuality: 0.82 },
  { id: 'screen', longEdgePx: 2400, jpegQuality: 0.8 },
  { id: 'floor', longEdgePx: 1920, jpegQuality: 0.76 },
]

/** Only resize when it removes a meaningful share of pixels; tiny resamples blur for little gain. */
export const RESIZE_THRESHOLD = 0.85
/** A same-size re-save must save at least this much, or the original stays. */
export const RESAVE_MIN_SAVING = 0.1
/** Lossless images with more bytes per sample than this behave like photos and may become JPEG. */
export const PHOTO_BYTES_PER_SAMPLE = 0.3

/** jpeg-gray is a one-channel JPEG we encode ourselves; canvas JPEGs are always three-channel. */
export type OutputFormat = 'jpeg' | 'jpeg-gray' | 'flate-rgb' | 'flate-gray'

export type ImageTarget = {
  width: number
  height: number
  format: OutputFormat
  quality?: number
  resized: boolean
}

export type ImagePlan = {
  image: ImageRecord
  /** May become a JPEG (photographic content). */
  photo: boolean
  firstPage: number
  pixels: number
  /** Target per rung index, or null when that rung leaves the image untouched. */
  targets: Array<ImageTarget | null>
}

/** Largest scale (≤ 1) any placement of the image needs at this rung. Unknown placement keeps full size. */
export function neededScale(image: ImageRecord, placements: Placement[] | undefined, pages: PageInfo[], rung: Rung): number {
  if (!placements || !placements.length) return 1
  let scale = 0
  for (const placement of placements) {
    const page = pages[placement.page - 1]
    if (!page) return 1
    const longEdge = Math.max(page.width, page.height)
    if (!(longEdge > 0)) return 1
    const pixelsPerUnit = rung.longEdgePx / longEdge
    scale = Math.max(scale, (placement.width * pixelsPerUnit) / image.width, (placement.height * pixelsPerUnit) / image.height)
  }
  if (!(scale > 0)) return 1
  return scale >= RESIZE_THRESHOLD ? 1 : scale
}

export function isPhotographic(image: ImageRecord): boolean {
  if (image.kind === 'jpeg') return true
  const samples = image.width * image.height * (image.colorModel === 'gray' ? 1 : 3)
  return samples > 0 && image.bytes / samples >= PHOTO_BYTES_PER_SAMPLE
}

export function planImage(image: ImageRecord, placements: Placement[] | undefined, pages: PageInfo[], rungs: readonly Rung[] = RUNGS): ImagePlan {
  const photo = isPhotographic(image)
  const firstPage = Math.min(...(placements?.map((placement) => placement.page) ?? []), ...(image.pages.length ? image.pages : image.reach), Number.MAX_SAFE_INTEGER)
  const targets = rungs.map((rung): ImageTarget | null => {
    if (!image.kind) return null
    // A soft mask with /Matte must keep the base image's exact dimensions.
    const scale = image.hasMatte ? 1 : neededScale(image, placements, pages, rung)
    const resized = scale < 1
    const width = resized ? Math.max(16, Math.round(image.width * scale)) : image.width
    const height = resized ? Math.max(16, Math.round(image.height * scale)) : image.height
    if (image.colorModel === 'gray') {
      // Gray stays gray. A gray photo becomes a gray JPEG; a soft mask drawn from lossless
      // samples stays lossless, because JPEG ringing would show along its hard edges.
      if (image.kind === 'jpeg' || (photo && !image.maskOf?.length)) return { width, height, format: 'jpeg-gray', quality: rung.jpegQuality, resized }
      return resized ? { width, height, format: 'flate-gray', resized } : null
    }
    if (photo) return { width, height, format: 'jpeg', quality: rung.jpegQuality, resized }
    return resized ? { width, height, format: 'flate-rgb', resized } : null
  })
  return { image, photo, firstPage: firstPage === Number.MAX_SAFE_INTEGER ? 1 : firstPage, pixels: image.width * image.height, targets }
}

export function sameTarget(a: ImageTarget | null, b: ImageTarget | null): boolean {
  if (!a || !b) return a === b
  return a.width === b.width && a.height === b.height && a.format === b.format && a.quality === b.quality
}

/** Keep a rewritten image only when it is actually lighter. */
export function acceptOutput(target: ImageTarget, originalBytes: number, outputBytes: number): boolean {
  if (target.resized) return outputBytes < originalBytes
  return outputBytes <= originalBytes * (1 - RESAVE_MIN_SAVING)
}

/**
 * Size model used only to decide which rungs are worth encoding:
 * bytes ≈ original × (pixel ratio)^PIXEL_EXPONENT × q, where q is measured on
 * this deck's own images as they are processed (defaults until then).
 */
export const PIXEL_EXPONENT = 0.85
const DEFAULT_Q = { photo: [0.75, 0.7, 0.65, 0.6], graphic: [1, 1, 1, 1] }

type Sample = { base: number; after: number }
export type Calibration = { photo: Sample[]; graphic: Sample[] }

export function emptyCalibration(rungCount = RUNGS.length): Calibration {
  return {
    photo: Array.from({ length: rungCount }, () => ({ base: 0, after: 0 })),
    graphic: Array.from({ length: rungCount }, () => ({ base: 0, after: 0 })),
  }
}

function pixelBase(plan: ImagePlan, target: ImageTarget): number {
  return plan.image.bytes * Math.pow((target.width * target.height) / plan.pixels, PIXEL_EXPONENT)
}

/** Record a measured output so later predictions use this deck's real behaviour. */
export function calibrate(calibration: Calibration, plan: ImagePlan, rungIndex: number, outputBytes: number): void {
  const target = plan.targets[rungIndex]
  if (!target) return
  const sample = calibration[plan.photo ? 'photo' : 'graphic'][rungIndex]
  sample.base += pixelBase(plan, target)
  sample.after += outputBytes
}

/** Expected bytes for an image at a rung, after the keep-only-if-lighter rule. */
export function predictImageBytes(plan: ImagePlan, rungIndex: number, calibration: Calibration): number {
  const target = plan.targets[rungIndex]
  if (!target) return plan.image.bytes
  const kind = plan.photo ? 'photo' : 'graphic'
  const sample = calibration[kind][rungIndex]
  const q = sample.base > 0 ? sample.after / sample.base : DEFAULT_Q[kind][rungIndex] ?? 1
  const predicted = pixelBase(plan, target) * q
  return acceptOutput(target, plan.image.bytes, predicted) ? predicted : plan.image.bytes
}

export type RungChoice = {
  /** Rungs to encode for every image, best first. */
  encode: number[]
  /** Index of the best rung expected to fit, or null when a split is expected. */
  expected: number | null
}

/**
 * Decide which rungs are worth encoding for the rest of the deck. The best
 * rung predicted to fit is encoded together with the next one down as a
 * safety net, plus the one above when it is borderline.
 */
export function chooseRungs(predicted: number[], budget: number): RungChoice {
  const fits = predicted.map((bytes) => bytes <= budget * 0.97)
  const best = fits.indexOf(true)
  if (best === -1) {
    // Even the floor is predicted to be too big: the result will be split.
    const floor = predicted.length - 1
    const parts = (bytes: number) => Math.ceil(bytes / (budget * 0.92))
    const fewest = parts(predicted[floor])
    // Highest-fidelity rung that should still need no more parts than the floor.
    const forSplit = predicted.findIndex((bytes) => parts(bytes) <= fewest)
    const encode = [...new Set([forSplit, floor])].sort((a, b) => a - b)
    return { encode, expected: null }
  }
  const encode = [best]
  if (best > 0 && predicted[best - 1] <= budget * 1.06) encode.unshift(best - 1)
  if (best + 1 < predicted.length) encode.push(best + 1)
  return { encode, expected: best }
}

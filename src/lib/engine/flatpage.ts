import type { Jpegli } from '../encoders/jpegli'
import { stripJpegMetadata } from './jpeg'
import { clarity, luminance, resample } from './perceptual'

/**
 * One flattened slide, re-saved at each rung and scored. Runs wherever there
 * is an OffscreenCanvas: on the flatten workers (`flatpage.worker.ts`), or in
 * the PDF worker when those can't start.
 */

/** Pixels across the slide's long edge, and JPEG quality. */
export type FlattenRung = { longEdgePx: number; jpegQuality: number }

/** One re-saved slide: its JPEG, its size, how clearly it reads, and the rung (index) it was written for. */
export type PageVersion = { bytes: Uint8Array; width: number; height: number; clarity: number; rung: number }

/**
 * Also write every rung with jpegli. Both versions are scored the same way and
 * the chooser keeps whichever reads clearer per byte, so jpegli only wins a
 * slide where it actually does better.
 */
export const FLATTEN_JPEGLI = true

/** jpegli's own mapping from libjpeg quality to its distance (libjxl's QualityToDistance, quality 30 and up). */
export function jpegliDistance(quality: number): number {
  return 0.1 + (100 - Math.round(quality * 100)) * 0.09
}

let jpegliLoad: Promise<Jpegli | null> | null = null

/** jpegli for this worker, loaded once; null when it can't run here, and the browser's JPEGs carry on alone. */
function flatJpegli(): Promise<Jpegli | null> {
  if (!FLATTEN_JPEGLI) return Promise.resolve(null)
  jpegliLoad ??= import('../encoders/jpegli').then(({ loadJpegli }) => loadJpegli()).catch((error) => {
    console.warn('Email My Deck is flattening with the browser\'s JPEGs only', error)
    return null
  })
  return jpegliLoad
}

export type FlatPageRequest = { reference: ImageBitmap; rungs: FlattenRung[]; comparePx: number }

function context2d(canvas: OffscreenCanvas, readBack = false): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: readBack }) as OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('2D canvas unavailable.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return context
}

/** RGB samples of a canvas, three bytes per pixel. */
function rgbOf(canvas: OffscreenCanvas): Uint8Array {
  const { width, height } = canvas
  const rgba = context2d(canvas).getImageData(0, 0, width, height).data
  const rgb = new Uint8Array(width * height * 3)
  for (let pixel = 0, from = 0, to = 0; pixel < width * height; pixel += 1, from += 4, to += 3) {
    rgb[to] = rgba[from]
    rgb[to + 1] = rgba[from + 1]
    rgb[to + 2] = rgba[from + 2]
  }
  return rgb
}

function pixels(image: CanvasImageSource, width: number, height: number): Uint8Array {
  const canvas = new OffscreenCanvas(width, height)
  const context = context2d(canvas, true)
  context.drawImage(image, 0, 0, width, height)
  const luma = luminance(context.getImageData(0, 0, width, height).data, width, height)
  canvas.width = canvas.height = 0
  return luma
}

/**
 * Re-save `reference` (the sharpest render, as wide as the first rung) at
 * every rung, with the browser's encoder and (when it runs here) jpegli, and
 * score each against it at `comparePx` across. The browser's version of the
 * first rung comes first.
 */
export async function flatPageVersions({ reference, rungs, comparePx }: FlatPageRequest): Promise<PageVersion[]> {
  const jpegli = await flatJpegli()
  const { width: fullWidth, height: fullHeight } = reference
  const long = Math.max(fullWidth, fullHeight)
  const compareScale = Math.min(1, comparePx / long)
  const compareWidth = Math.max(1, Math.round(fullWidth * compareScale))
  const compareHeight = Math.max(1, Math.round(fullHeight * compareScale))
  const sharp = resample(pixels(reference, fullWidth, fullHeight), fullWidth, fullHeight, compareWidth, compareHeight)
  const sized = new Map<number, OffscreenCanvas>()
  const samples = new Map<number, Uint8Array>()
  const versions: PageVersion[] = []
  const score = async (bytes: Uint8Array, width: number, height: number, rung: number) => {
    const decoded = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
    let luma: Uint8Array
    try {
      luma = pixels(decoded, width, height)
    } finally {
      decoded.close()
    }
    const seen = resample(luma, width, height, compareWidth, compareHeight)
    versions.push({ bytes, width, height, clarity: clarity(sharp, seen, compareWidth, compareHeight), rung })
  }
  try {
    for (const [index, rung] of rungs.entries()) {
      const scale = Math.min(1, rung.longEdgePx / long)
      const width = Math.max(1, Math.round(fullWidth * scale))
      const height = Math.max(1, Math.round(fullHeight * scale))
      // Rungs that share a size share one resize.
      let canvas = sized.get(width)
      if (!canvas) {
        canvas = new OffscreenCanvas(width, height)
        context2d(canvas).drawImage(reference, 0, 0, width, height)
        sized.set(width, canvas)
      }
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: rung.jpegQuality })
      if (blob.type !== 'image/jpeg') throw new Error('This browser cannot write JPEG images.')
      await score(stripJpegMetadata(new Uint8Array(await blob.arrayBuffer())), width, height, index)
      if (!jpegli) continue
      try {
        let rgb = samples.get(width)
        if (!rgb) samples.set(width, (rgb = rgbOf(canvas)))
        await score(jpegli.encode(rgb, width, height, 3, { distance: jpegliDistance(rung.jpegQuality), subsample420: true, progressive: true }), width, height, index)
      } catch (error) {
        // This rung keeps the browser's version only.
        console.warn('Email My Deck kept the browser\'s JPEG for one flattened slide', error)
      }
    }
    return versions
  } finally {
    for (const canvas of sized.values()) canvas.width = canvas.height = 0
    reference.close()
  }
}

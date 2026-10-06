import { stripJpegMetadata } from './jpeg'
import { clarity, luminance, resample } from './perceptual'

/**
 * One flattened slide, re-saved at each rung and scored. Runs wherever there
 * is an OffscreenCanvas: on the flatten workers (`flatpage.worker.ts`), or in
 * the PDF worker when those can't start.
 */

/** Pixels across the slide's long edge, and JPEG quality. */
export type FlattenRung = { longEdgePx: number; jpegQuality: number }

export type PageVersion = { bytes: Uint8Array; width: number; height: number; clarity: number }

export type FlatPageRequest = { reference: ImageBitmap; rungs: FlattenRung[]; comparePx: number }

function context2d(canvas: OffscreenCanvas, readBack = false): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: readBack }) as OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('2D canvas unavailable.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return context
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
 * every rung, and score each against it at `comparePx` across.
 */
export async function flatPageVersions({ reference, rungs, comparePx }: FlatPageRequest): Promise<PageVersion[]> {
  const { width: fullWidth, height: fullHeight } = reference
  const long = Math.max(fullWidth, fullHeight)
  const compareScale = Math.min(1, comparePx / long)
  const compareWidth = Math.max(1, Math.round(fullWidth * compareScale))
  const compareHeight = Math.max(1, Math.round(fullHeight * compareScale))
  const sharp = resample(pixels(reference, fullWidth, fullHeight), fullWidth, fullHeight, compareWidth, compareHeight)
  const sized = new Map<number, OffscreenCanvas>()
  const versions: PageVersion[] = []
  try {
    for (const rung of rungs) {
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
      const bytes = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()))
      const decoded = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
      let luma: Uint8Array
      try {
        luma = pixels(decoded, width, height)
      } finally {
        decoded.close()
      }
      const seen = resample(luma, width, height, compareWidth, compareHeight)
      versions.push({ bytes, width, height, clarity: clarity(sharp, seen, compareWidth, compareHeight) })
    }
    return versions
  } finally {
    for (const canvas of sized.values()) canvas.width = canvas.height = 0
    reference.close()
  }
}

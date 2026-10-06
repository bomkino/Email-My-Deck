import { encodeGrayJpeg } from './grayjpeg'
import { stripJpegMetadata } from './jpeg'
import type { OutputFormat } from './ladder'

export type CodecSource =
  | { kind: 'jpeg'; bytes: Uint8Array }
  | { kind: 'raw'; bytes: Uint8Array; width: number; height: number; components: 1 | 3 }

export type CodecOutput = { width: number; height: number; format: OutputFormat; quality?: number }
export type CodecResult = { bytes: Uint8Array; width: number; height: number; format: OutputFormat }

/** Decodes an image once and produces each requested output from it. */
export interface ImageCodec {
  encode(source: CodecSource, outputs: CodecOutput[]): Promise<CodecResult[]>
  /** How many images may be in flight at once. */
  concurrency?: number
}

export function browserCodecAvailable(): boolean {
  return typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function' && typeof CompressionStream === 'function'
}

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" in the Compression Streams API is the zlib format, which is exactly FlateDecode.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function rawToImageData(source: Extract<CodecSource, { kind: 'raw' }>): ImageData {
  const { width, height, components, bytes } = source
  const count = width * height
  if (bytes.byteLength < count * components) throw new Error('Image samples are shorter than the image size.')
  const rgba = new Uint8ClampedArray(count * 4)
  const words = new Uint32Array(rgba.buffer)
  // ImageData is RGBA in memory; on little-endian machines that is 0xAABBGGRR per pixel.
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1
  if (components === 3) {
    for (let pixel = 0, sample = 0; pixel < count; pixel += 1, sample += 3) {
      const r = bytes[sample], g = bytes[sample + 1], b = bytes[sample + 2]
      words[pixel] = littleEndian ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0
    }
  } else {
    for (let pixel = 0; pixel < count; pixel += 1) {
      const v = bytes[pixel]
      words[pixel] = littleEndian ? (0xff000000 | (v << 16) | (v << 8) | v) >>> 0 : ((v << 24) | (v << 16) | (v << 8) | 0xff) >>> 0
    }
  }
  return new ImageData(rgba, width, height)
}

async function decode(source: CodecSource): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }
  if (source.kind === 'jpeg') {
    return createImageBitmap(new Blob([stripJpegMetadata(source.bytes) as BlobPart], { type: 'image/jpeg' }), options)
  }
  return createImageBitmap(rawToImageData(source), options)
}

function context2d(canvas: OffscreenCanvas, readBack: boolean): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: readBack }) as OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('2D canvas unavailable.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return context
}

type Surface = { image: CanvasImageSource; width: number; height: number; canvas: OffscreenCanvas | null }

/**
 * Draw `width`×`height` from the smallest surface already made that is at
 * least that big, halving until within 2× first (large single-step
 * reductions alias in some browsers). Every canvas made is kept in
 * `surfaces`, so several outputs of one image share the expensive steps.
 */
function drawScaled(surfaces: Surface[], width: number, height: number, readBack: boolean): OffscreenCanvas {
  const exact = surfaces.find((surface) => surface.canvas && surface.width === width && surface.height === height)
  if (exact?.canvas) return exact.canvas
  let from = surfaces[0]
  for (const surface of surfaces) {
    if (surface.width >= width && surface.height >= height && surface.width * surface.height < from.width * from.height) from = surface
  }
  let current = from
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const nextWidth = Math.max(width, Math.floor(current.width / 2))
    const nextHeight = Math.max(height, Math.floor(current.height / 2))
    const step = new OffscreenCanvas(nextWidth, nextHeight)
    context2d(step, false).drawImage(current.image, 0, 0, nextWidth, nextHeight)
    current = { image: step, width: nextWidth, height: nextHeight, canvas: step }
    surfaces.push(current)
  }
  const canvas = new OffscreenCanvas(width, height)
  context2d(canvas, readBack).drawImage(current.image, 0, 0, width, height)
  surfaces.push({ image: canvas, width, height, canvas })
  return canvas
}

/**
 * Optional replacements for the browser's own resizer and encoders (see
 * src/lib/encoders). `writeJpeg` takes interleaved 8-bit samples (1 = gray,
 * 3 = RGB) and a quality on the canvas scale (0–1), and must look at least as
 * good as canvas at it. When `resize` made the samples, it also gets `today`:
 * the JPEG the browser alone (its own resize and encoder) would have written
 * for this output, so it can promise never to cost more. `resize` scales RGBA
 * pixels to exactly the size asked.
 */
export type EncoderOverrides = {
  writeJpeg?: (samples: Uint8Array, width: number, height: number, components: 1 | 3, quality: number, today?: Uint8Array) => Promise<Uint8Array>
  deflate?: (data: Uint8Array) => Promise<Uint8Array>
  resize?: (pixels: ImageData, width: number, height: number) => Promise<ImageData>
}

/**
 * The JPEG the browser's own encoder writes for these samples (gray through
 * the engine's one-channel encoder): what an image cost before the
 * WebAssembly encoders, so they can promise never to cost more.
 */
export async function browserJpeg(samples: Uint8Array, width: number, height: number, components: 1 | 3, quality: number): Promise<Uint8Array> {
  if (components === 1) return encodeGrayJpeg(samples, width, height, quality)
  const canvas = new OffscreenCanvas(width, height)
  context2d(canvas, false).putImageData(rawToImageData({ kind: 'raw', bytes: samples, width, height, components }), 0, 0)
  return (await canvasJpeg(canvas, { width, height, format: 'jpeg', quality })).bytes
}

async function canvasJpeg(canvas: OffscreenCanvas, output: CodecOutput): Promise<CodecResult> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: output.quality ?? 0.82 })
  if (blob.type !== 'image/jpeg') throw new Error('This browser cannot write JPEG images.')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: output.width, height: output.height, format: output.format }
}

/** What the browser codec writes for an output already drawn by canvas. */
async function browserOnly(canvas: OffscreenCanvas, output: CodecOutput, components: 1 | 3, quality: number): Promise<Uint8Array> {
  if (components === 3) return (await canvasJpeg(canvas, output)).bytes
  const rgba = context2d(canvas, true).getImageData(0, 0, output.width, output.height).data
  const gray = new Uint8Array(output.width * output.height)
  for (let pixel = 0, offset = 0; pixel < gray.length; pixel += 1, offset += 4) gray[pixel] = rgba[offset]
  return encodeGrayJpeg(gray, output.width, output.height, quality)
}

async function render(surfaces: Surface[], output: CodecOutput, overrides: EncoderOverrides, full: () => ImageData): Promise<CodecResult> {
  const viaCanvas = output.format === 'jpeg' && !overrides.writeJpeg
  let pixels: Uint8ClampedArray
  // The browser's own resize of this output, when another resizer made the pixels.
  let todayCanvas: OffscreenCanvas | null = null
  if (overrides.resize) {
    const source = full()
    const resized = source.width === output.width && source.height === output.height ? source : await overrides.resize(source, output.width, output.height)
    if (viaCanvas) {
      const canvas = new OffscreenCanvas(output.width, output.height)
      context2d(canvas, false).putImageData(resized, 0, 0)
      return canvasJpeg(canvas, output)
    }
    pixels = resized.data
    if (resized !== source && overrides.writeJpeg && (output.format === 'jpeg' || output.format === 'jpeg-gray')) todayCanvas = drawScaled(surfaces, output.width, output.height, output.format === 'jpeg-gray')
  } else {
    const canvas = drawScaled(surfaces, output.width, output.height, !viaCanvas)
    if (viaCanvas) return canvasJpeg(canvas, output)
    pixels = context2d(canvas, true).getImageData(0, 0, output.width, output.height).data
  }
  const count = output.width * output.height
  const components = output.format === 'flate-rgb' || output.format === 'jpeg' ? 3 : 1
  const samples = new Uint8Array(count * components)
  if (components === 3) {
    for (let pixel = 0, sample = 0, offset = 0; pixel < count; pixel += 1, sample += 3, offset += 4) {
      samples[sample] = pixels[offset]
      samples[sample + 1] = pixels[offset + 1]
      samples[sample + 2] = pixels[offset + 2]
    }
  } else {
    for (let pixel = 0, offset = 0; pixel < count; pixel += 1, offset += 4) samples[pixel] = pixels[offset]
  }
  const quality = output.quality ?? 0.82
  let bytes: Uint8Array
  if (output.format === 'jpeg' || output.format === 'jpeg-gray') {
    bytes = overrides.writeJpeg ? await overrides.writeJpeg(samples, output.width, output.height, components, quality, todayCanvas ? await browserOnly(todayCanvas, output, components, quality) : undefined) : encodeGrayJpeg(samples, output.width, output.height, quality)
  } else {
    bytes = await (overrides.deflate ?? deflate)(samples)
  }
  return { bytes, width: output.width, height: output.height, format: output.format }
}

/** The browser's decoder and resizer, with its own encoders unless `overrides` replaces them. */
export function createBrowserCodec(overrides: EncoderOverrides = {}): ImageCodec {
  return {
    async encode(source, outputs) {
      const bitmap = await decode(source)
      const surfaces: Surface[] = [{ image: bitmap, width: bitmap.width, height: bitmap.height, canvas: null }]
      // Pixels for an override resizer, read once per image: full size, or for a
      // huge photo twice the largest output, halved down by canvas first so the
      // readback and the resizer's copies stay a bounded size.
      let fullPixels: ImageData | null = null
      const full = () => {
        if (!fullPixels) {
          const largest = outputs.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
          const width = Math.min(bitmap.width, largest.width * 2)
          const height = Math.min(bitmap.height, largest.height * 2)
          if (width === bitmap.width && height === bitmap.height) {
            const canvas = new OffscreenCanvas(width, height)
            const context = context2d(canvas, true)
            context.drawImage(bitmap, 0, 0)
            fullPixels = context.getImageData(0, 0, width, height)
          } else {
            fullPixels = context2d(drawScaled(surfaces, width, height, true), true).getImageData(0, 0, width, height)
          }
        }
        return fullPixels
      }
      try {
        // Largest first, so each smaller output can start from a bigger one already drawn.
        const order = outputs.map((_, index) => index).sort((a, b) => outputs[b].width * outputs[b].height - outputs[a].width * outputs[a].height)
        const results: CodecResult[] = new Array(outputs.length)
        for (const index of order) results[index] = await render(surfaces, outputs[index], overrides, full)
        return results
      } finally {
        bitmap.close()
        surfaces.length = 0
        fullPixels = null
      }
    },
  }
}

export const browserCodec: ImageCodec = createBrowserCodec()

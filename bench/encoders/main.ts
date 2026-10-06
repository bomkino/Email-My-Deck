/**
 * Encoder bench: resize a photo the way the engine does, encode it with each
 * candidate, decode it back with the browser and score it against the resized
 * original with SSIMULACRA2. Driven by bench/run-encoders.mjs through
 * `window.bench`; results are plain rows the driver writes out.
 */
import mozEncode from '@jsquash/jpeg/encode'
import resize from '@jsquash/resize'
import { loadJpegli, type Jpegli } from '../../src/lib/encoders/jpegli'

type Rgba = { data: Uint8ClampedArray; width: number; height: number }
type Prepared = { rgba: Rgba; rgb: Uint8Array; canvas: OffscreenCanvas }

export type Variant = { label: string; encoder: string; params?: Record<string, unknown> }
export type Row = { image: string; longEdge: number; width: number; height: number; resizer: string; label: string; encoder: string; bytes: number; encodeMs: number; score: number | null; scoreMs: number }

type Encoder = (image: Prepared, params: Record<string, unknown>) => Promise<Uint8Array>
type Scorer = { score(reference: Uint8Array, distorted: Uint8Array, width: number, height: number, channels: number): number }

let scorer: Scorer | null = null
let jpegli: Jpegli | null = null

function context(canvas: OffscreenCanvas, readBack = false): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: readBack }) as OffscreenCanvasRenderingContext2D
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

/** The engine's canvas resize (src/lib/engine/codec.ts drawScaled): halve until within 2×, then draw. */
function canvasResize(bitmap: ImageBitmap, width: number, height: number): OffscreenCanvas {
  let current: CanvasImageSource = bitmap
  let cw = bitmap.width
  let ch = bitmap.height
  while (cw / 2 >= width && ch / 2 >= height) {
    const nw = Math.max(width, Math.floor(cw / 2))
    const nh = Math.max(height, Math.floor(ch / 2))
    const step = new OffscreenCanvas(nw, nh)
    context(step).drawImage(current, 0, 0, nw, nh)
    current = step
    cw = nw
    ch = nh
  }
  const canvas = new OffscreenCanvas(width, height)
  context(canvas, true).drawImage(current, 0, 0, width, height)
  return canvas
}

function rgbOf(rgba: Uint8ClampedArray): Uint8Array {
  const count = rgba.length / 4
  const rgb = new Uint8Array(count * 3)
  for (let i = 0, j = 0; i < count; i += 1, j += 3) {
    rgb[j] = rgba[i * 4]
    rgb[j + 1] = rgba[i * 4 + 1]
    rgb[j + 2] = rgba[i * 4 + 2]
  }
  return rgb
}

function prepared(canvas: OffscreenCanvas): Prepared {
  const data = context(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data
  return { rgba: { data, width: canvas.width, height: canvas.height }, rgb: rgbOf(data), canvas }
}

function canvasFromRgba(rgba: Rgba): OffscreenCanvas {
  const canvas = new OffscreenCanvas(rgba.width, rgba.height)
  context(canvas, true).putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0)
  return canvas
}

async function decodeRgb(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  context(canvas, true).drawImage(bitmap, 0, 0)
  bitmap.close()
  return rgbOf(context(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data)
}

const encoders: Record<string, Encoder> = {
  async canvas(image, params) {
    const blob = await image.canvas.convertToBlob({ type: 'image/jpeg', quality: Number(params.quality ?? 0.82) })
    return new Uint8Array(await blob.arrayBuffer())
  },
  async mozjpeg(image, params) {
    const data = new ImageData(new Uint8ClampedArray(image.rgba.data), image.rgba.width, image.rgba.height)
    return new Uint8Array(await mozEncode(data, params))
  },
  async jpegli(image, params) {
    if (!jpegli) throw new Error('jpegli not loaded')
    return jpegli.encode(image.rgb, image.rgba.width, image.rgba.height, 3, params)
  },
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now()
  const value = await fn()
  return [value, performance.now() - started]
}

const bench = {
  async setup(options: { scorerUrl?: string; jpegli?: boolean }) {
    if (options.scorerUrl) {
      const module = await import(/* @vite-ignore */ options.scorerUrl)
      await module.load()
      scorer = module as Scorer
    }
    if (options.jpegli) jpegli = await loadJpegli()
    return { scorer: Boolean(scorer), jpegli: Boolean(jpegli) }
  },

  /** Rows for one image: each long edge × resizer × variant. */
  async run(config: { url: string; name: string; longEdges: number[]; resizers: string[]; variants: Variant[]; repeat?: number }): Promise<Row[]> {
    const source = new Uint8Array(await (await fetch(config.url)).arrayBuffer())
    const bitmap = await createImageBitmap(new Blob([source as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const rows: Row[] = []
    try {
      for (const longEdge of config.longEdges) {
        const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
        const width = Math.max(16, Math.round(bitmap.width * scale))
        const height = Math.max(16, Math.round(bitmap.height * scale))
        for (const resizer of config.resizers) {
          let image: Prepared
          const [, resizeMs] = await timed(async () => {
            if (resizer === 'canvas') {
              image = prepared(canvasResize(bitmap, width, height))
            } else {
              const full = new OffscreenCanvas(bitmap.width, bitmap.height)
              context(full, true).drawImage(bitmap, 0, 0)
              const data = context(full, true).getImageData(0, 0, bitmap.width, bitmap.height)
              const [method, light] = resizer.split(':')
              const out = await resize(data, { width, height, method: method as 'lanczos3', premultiply: false, linearRGB: light === 'linear' })
              image = prepared(canvasFromRgba({ data: out.data, width: out.width, height: out.height }))
            }
          })
          rows.push({ image: config.name, longEdge, width, height, resizer, label: 'resize', encoder: resizer, bytes: 0, encodeMs: resizeMs, score: null, scoreMs: 0 })
          for (const variant of config.variants) {
            const encoder = encoders[variant.encoder]
            if (!encoder) continue
            let bytes = new Uint8Array()
            const times: number[] = []
            for (let i = 0; i < (config.repeat ?? 1); i += 1) {
              const [out, ms] = await timed(() => encoder(image!, variant.params ?? {}))
              bytes = out
              times.push(ms)
            }
            times.sort((a, b) => a - b)
            let score: number | null = null
            let scoreMs = 0
            if (scorer) {
              const decoded = await decodeRgb(bytes)
              const [value, ms] = await timed(async () => scorer!.score(image!.rgb, decoded, width, height, 3))
              score = value
              scoreMs = ms
            }
            rows.push({ image: config.name, longEdge, width, height, resizer, label: variant.label, encoder: variant.encoder, bytes: bytes.byteLength, encodeMs: times[Math.floor(times.length / 2)], score, scoreMs })
          }
        }
      }
    } finally {
      bitmap.close()
    }
    return rows
  },
}

;(globalThis as unknown as { bench: typeof bench }).bench = bench

/** For eyeballing resizers: the resized image as PNG bytes (base64), cropped to a region. */
;(globalThis as unknown as { resizeCrop: unknown }).resizeCrop = async (url: string, longEdge: number, resizer: string, crop: [number, number, number, number]) => {
  const source = new Uint8Array(await (await fetch(url)).arrayBuffer())
  const bitmap = await createImageBitmap(new Blob([source as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  let canvas: OffscreenCanvas
  if (resizer === 'canvas') canvas = canvasResize(bitmap, width, height)
  else {
    const full = new OffscreenCanvas(bitmap.width, bitmap.height)
    context(full, true).drawImage(bitmap, 0, 0)
    const [method, light] = resizer.split(':')
    const out = await resize(context(full, true).getImageData(0, 0, bitmap.width, bitmap.height), { width, height, method: method as 'lanczos3', premultiply: false, linearRGB: light === 'linear' })
    canvas = canvasFromRgba({ data: out.data, width: out.width, height: out.height })
  }
  const [x, y, w, h] = crop
  const out = new OffscreenCanvas(w, h)
  context(out).drawImage(canvas, x, y, w, h, 0, 0, w, h)
  const blob = await out.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Ladder calibration and search check. For each rung (long edge, canvas quality):
 * today's canvas JPEG and its worst-tile score; then, when `targets` gives the
 * rung's target, the Lanczos + jpegli search result. Whole-image scores are
 * added for rungs up to `wholeUpTo` px so the tile judgement can be checked.
 */
;(globalThis as unknown as { calibrate: unknown }).calibrate = async (options: { url: string; name: string; rungs: Array<[number, number]>; targets?: Record<string, number>; guesses?: Record<string, number>; wholeUpTo?: number }) => {
  const { pickTiles, cropTile, decodeTiles, judge, searchDistance } = await import('../../src/lib/encoders/looks')
  const { lanczos3 } = await import('../../src/lib/encoders/resize')
  const initResize = (await import('@jsquash/resize/lib/resize/pkg/squoosh_resize.js')).default
  await initResize()
  if (!scorer || !jpegli) throw new Error('setup() with scorer and jpegli first')
  const score = (a: Uint8Array, b: Uint8Array, w: number, h: number, c: 1 | 3) => scorer!.score(a, b, w, h, c)
  const source = new Uint8Array(await (await fetch(options.url)).arrayBuffer())
  const bitmap = await createImageBitmap(new Blob([source as BlobPart]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const fullCanvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  context(fullCanvas, true).drawImage(bitmap, 0, 0)
  const full = context(fullCanvas, true).getImageData(0, 0, bitmap.width, bitmap.height)
  const rows: Array<Record<string, unknown>> = []
  for (const [longEdge, quality] of options.rungs) {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(16, Math.round(bitmap.width * scale))
    const height = Math.max(16, Math.round(bitmap.height * scale))
    // Today: canvas resize + canvas JPEG.
    const today = prepared(scale < 1 ? canvasResize(bitmap, width, height) : (() => { const c = new OffscreenCanvas(width, height); context(c, true).drawImage(bitmap, 0, 0); return c })())
    const todayJpeg = await encoders.canvas(today, { quality })
    const todayTiles = pickTiles(today.rgb, width, height, 3)
    const todayRef = todayTiles.map((tile) => cropTile(today.rgb, width, 3, tile))
    const todayDecoded = await decodeRgb(todayJpeg)
    const row: Record<string, unknown> = { image: options.name, longEdge, quality, width, height, tiles: todayTiles.length, canvasBytes: todayJpeg.byteLength, canvasTile: judge(score, todayRef, todayTiles.map((tile) => cropTile(todayDecoded, width, 3, tile)), todayTiles, 3) }
    if (longEdge <= (options.wholeUpTo ?? 0)) row.canvasWhole = score(today.rgb, todayDecoded, width, height, 3)
    const target = options.targets?.[String(quality)]
    if (target !== undefined) {
      // New: Lanczos resize + jpegli, searched to the target.
      const resized = scale < 1 ? lanczos3(full, width, height) : full
      const rgb = rgbOf(resized.data)
      const tiles = pickTiles(rgb, width, height, 3)
      const reference = tiles.map((tile) => cropTile(rgb, width, 3, tile))
      const started = performance.now()
      const found = await searchDistance(
        (distance) => jpegli!.encode(rgb, width, height, 3, { distance, progressive: true }),
        async (bytes) => judge(score, reference, await decodeTiles(bytes, tiles, 3), tiles, 3),
        target,
        options.guesses?.[String(quality)] ?? 1.5,
        { tolerance: 0.5, maxSteps: 7 },
      )
      Object.assign(row, { target, newBytes: found.bytes.byteLength, newDistance: found.distance, newTile: found.score, steps: found.steps, searchMs: performance.now() - started })
      if (longEdge <= (options.wholeUpTo ?? 0)) row.newWhole = score(rgb, await decodeRgb(found.bytes), width, height, 3)
    }
    rows.push(row)
  }
  bitmap.close()
  return rows
}

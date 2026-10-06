/**
 * WebAssembly encoders that replace the browser's own: jpegli for JPEG, with
 * SSIMULACRA2 checking that each one still looks right, libdeflate for Flate
 * and Lanczos3 for resizing. Each is a separate, lazily fetched asset, loaded
 * only when a deck needs images rewritten.
 * Benchmarks and how each setting was chosen: bench/README.md.
 */
import { browserCodec, browserJpeg, createBrowserCodec, type EncoderOverrides, type ImageCodec } from '../engine/codec'
import { loadDeflate } from './deflate'
import { loadJpegli, type Jpegli, type JpegliSettings } from './jpegli'
import { cropTile, decodeTiles, fitUnder, judge, pickTiles, searchDistance, type Score, type Tile } from './looks'
import { loadResize } from './resize'
import { loadScorer } from './scorer'

/** Turn the WebAssembly encoders on. Off falls back to the browser's encoders everywhere. */
export const WASM_ENCODERS = true

/**
 * For each canvas JPEG quality the engine's ladder speaks: the SSIMULACRA2
 * score every JPEG at that rung must reach on its worst tile, and the jpegli
 * distance that usually gets there (the search's first guess, and the setting
 * used whenever the check can't run). Targets keep each rung's bytes at or
 * under what the browser's encoder spent on the bench photos while lifting the
 * worst images to the rung's typical look; see bench/README.md.
 */
export const JPEGLI_LOOKS: ReadonlyArray<readonly [canvasQuality: number, target: number, distance: number]> = [
  [0.66, 63.9, 3.0],
  [0.72, 68.6, 2.45],
  [0.76, 72.7, 1.9],
  [0.8, 75.9, 1.62],
  [0.82, 78.6, 1.4],
  [0.85, 85.0, 1.1],
]

/** Target and first-guess distance for a canvas quality, interpolated between the table's rows. */
export function looksFor(canvasQuality: number): { target: number; distance: number } {
  const table = JPEGLI_LOOKS
  const at = (row: (typeof table)[number]) => ({ target: row[1], distance: row[2] })
  if (canvasQuality <= table[0][0]) return at(table[0])
  for (let index = 1; index < table.length; index += 1) {
    const [q1, t1, d1] = table[index]
    const [q0, t0, d0] = table[index - 1]
    if (canvasQuality <= q1) {
      const t = (canvasQuality - q0) / (q1 - q0)
      return { target: t0 + t * (t1 - t0), distance: Math.exp(Math.log(d0) + t * (Math.log(d1) - Math.log(d0))) }
    }
  }
  return at(table[table.length - 1])
}

export function jpegliSettingsFor(canvasQuality: number, distance = looksFor(canvasQuality).distance): JpegliSettings {
  return { distance, subsample420: true, progressive: true }
}

/** Images smaller than this are written at the table's distance: too few bytes to be worth checking. */
const MIN_CHECKED_PIXELS = 96 * 96
/** A best score this far under the target means the check itself is off (an odd decoder, say), not the JPEG. */
const IMPLAUSIBLE = 15

export type JpegWriterOptions = {
  /** SSIMULACRA2; without it every JPEG gets the table's distance. */
  score?: Score
  /** The browser's own JPEG of the same pixels and quality, used when the codec passes no `today` (no resize of ours). No JPEG comes out bigger than it. */
  baseline?: (samples: Uint8Array, width: number, height: number, components: 1 | 3, quality: number) => Promise<Uint8Array>
  /** Decodes a candidate's tiles; the browser's decoder unless a test swaps it. */
  decode?: (bytes: Uint8Array, tiles: Tile[], channels: 1 | 3) => Promise<Uint8Array[]>
}

/**
 * JPEG writer. Each image gets the lightest jpegli distance that still looks
 * right at its rung (see looks.ts), and never more bytes than the browser
 * alone would have written for it (its resize and its encoder, at the same
 * quality). When the look costs more than that (a busy screenshot, say), it
 * gets the best look that fits in those bytes, or the browser's JPEG itself if
 * that looks better. Without a scorer, or if the check fails, the table's
 * distance, under the same cap.
 */
export function jpegWriter(jpegli: Jpegli, options: JpegWriterOptions = {}): NonNullable<EncoderOverrides['writeJpeg']> {
  const { score, baseline, decode = decodeTiles } = options
  return async (samples, width, height, components, quality, browser) => {
    const { target, distance } = looksFor(quality)
    const encodeAt = (at: number) => jpegli.encode(samples, width, height, components, jpegliSettingsFor(quality, at))
    // What this image cost before: the codec's own browser-only JPEG when it has one, else the browser's encoder on these samples.
    let today: Uint8Array | null = browser ?? null
    if (!today && baseline) {
      try {
        today = await baseline(samples, width, height, components, quality)
      } catch {
        today = null
      }
    }
    const cap = today?.byteLength ?? Infinity
    const unchecked = () => {
      const fixed = encodeAt(distance)
      return today && fixed.byteLength > cap ? today : fixed
    }
    if (!score || width < 16 || height < 16 || width * height < MIN_CHECKED_PIXELS) return unchecked()
    try {
      const tiles = pickTiles(samples, width, height, components)
      const reference = tiles.map((tile) => cropTile(samples, width, components, tile))
      const scoreOf = async (bytes: Uint8Array) => judge(score, reference, await decode(bytes, tiles, components), tiles, components)
      const found = await searchDistance(encodeAt, scoreOf, target, distance, { tolerance: 0.5, maxSteps: 7 })
      if (found.score >= target && found.bytes.byteLength <= cap) return found.bytes
      if (!today) return found.score >= target - IMPLAUSIBLE ? found.bytes : encodeAt(distance)
      // Looking right would cost more than the browser's JPEG: the best look within its bytes, or the browser's JPEG itself.
      const fitted = found.bytes.byteLength <= cap ? found : fitUnder(encodeAt, cap, found)
      if (!fitted) return today
      const fittedScore = fitted === found ? found.score : await scoreOf(fitted.bytes)
      return fittedScore >= (await scoreOf(today)) ? fitted.bytes : today
    } catch (error) {
      console.warn('Email My Deck wrote one JPEG without the look check', error)
      return unchecked()
    }
  }
}

/** Load every WebAssembly encoder, or throw if this browser can't run them (the caller keeps the browser's). */
export async function loadEncoders(): Promise<EncoderOverrides> {
  // The scorer is a nice-to-have: without it every JPEG gets the table's distance.
  const scorer = loadScorer().catch((error) => {
    console.warn('Email My Deck is writing JPEGs without the look check', error)
    return undefined
  })
  const [jpegli, deflate, resize, score] = await Promise.all([loadJpegli(), loadDeflate(), loadResize(), scorer])
  return { writeJpeg: jpegWriter(jpegli, { score, baseline: browserJpeg }), deflate, resize }
}

/**
 * The image codec a worker should use: the WebAssembly encoders when they
 * load, the browser's own when they don't. If they fail on one image (say,
 * out of memory), that image is redone with the browser's: it loses its
 * savings, never the image.
 */
export async function loadCodec(): Promise<ImageCodec> {
  if (!WASM_ENCODERS) return browserCodec
  let codec: ImageCodec
  try {
    codec = createBrowserCodec(await loadEncoders())
  } catch (error) {
    console.warn('Email My Deck is using the browser\'s image encoders', error)
    return browserCodec
  }
  return {
    async encode(source, outputs) {
      try {
        return await codec.encode(source, outputs)
      } catch (error) {
        console.warn('Email My Deck fell back to the browser\'s encoders for one image', error)
        return browserCodec.encode(source, outputs)
      }
    },
  }
}

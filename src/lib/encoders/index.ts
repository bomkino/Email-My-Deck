/**
 * WebAssembly encoders that replace the browser's own: jpegli for JPEG, with
 * SSIMULACRA2 checking that each one still looks right, libdeflate for Flate
 * and Lanczos3 for resizing. Each is a separate, lazily fetched asset, loaded
 * only when a deck needs images rewritten.
 * Benchmarks and how each setting was chosen: bench/README.md.
 */
import { browserCodec, createBrowserCodec, type EncoderOverrides, type ImageCodec } from '../engine/codec'
import { loadDeflate } from './deflate'
import { loadJpegli, type Jpegli, type JpegliSettings } from './jpegli'
import { cropTile, decodeTiles, judge, pickTiles, searchDistance, type Score } from './looks'
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

/**
 * JPEG writer: with a scorer, each image gets the lightest jpegli distance
 * that still looks right at its rung (see looks.ts); without one, or if the
 * check fails, the table's distance.
 */
export function jpegWriter(jpegli: Jpegli, score?: Score): NonNullable<EncoderOverrides['writeJpeg']> {
  return async (samples, width, height, components, quality) => {
    const { target, distance } = looksFor(quality)
    const encodeAt = (at: number) => jpegli.encode(samples, width, height, components, jpegliSettingsFor(quality, at))
    if (!score || width < 16 || height < 16 || width * height < MIN_CHECKED_PIXELS) return encodeAt(distance)
    try {
      const tiles = pickTiles(samples, width, height, components)
      const reference = tiles.map((tile) => cropTile(samples, width, components, tile))
      const found = await searchDistance(
        encodeAt,
        async (bytes) => judge(score, reference, await decodeTiles(bytes, tiles, components), tiles, components),
        target,
        distance,
        { tolerance: 0.5, maxSteps: 7 },
      )
      return found.score >= target - IMPLAUSIBLE ? found.bytes : encodeAt(distance)
    } catch (error) {
      console.warn('Email My Deck wrote one JPEG without the look check', error)
      return encodeAt(distance)
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
  return { writeJpeg: jpegWriter(jpegli, score), deflate, resize }
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

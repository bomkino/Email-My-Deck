// @vitest-environment node
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { createDeflate } from '../src/lib/encoders/deflate'
import { jpegliSettingsFor, jpegWriter, JPEGLI_LOOKS, looksFor } from '../src/lib/encoders/index'
import { wrapJpegli, wasmSimdSupported } from '../src/lib/encoders/jpegli'
import { cropTile, judge, pickTiles, searchDistance, TILE } from '../src/lib/encoders/looks'
import createJpegliModule from '../src/lib/encoders/wasm/jpegli.js'
import * as ssimulacra2 from '../src/lib/encoders/wasm/ssimulacra2.js'
import { readJpegInfo } from '../src/lib/engine/jpeg'

const wasm = (name: string) => readFileSync(new URL(`../src/lib/encoders/wasm/${name}`, import.meta.url))

/** A smooth photo-like gradient with some texture, interleaved RGB. */
function testImage(width: number, height: number, components: 1 | 3): Uint8Array {
  const samples = new Uint8Array(width * height * components)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < components; c += 1) {
        samples[(y * width + x) * components + c] = Math.round(128 + 100 * Math.sin((x + c * 17) / 23) * Math.cos(y / 31) + ((x * 7 + y * 13) % 11))
      }
    }
  }
  return samples
}

describe('jpegli', () => {
  for (const name of ['jpegli.wasm', 'jpegli-nosimd.wasm']) {
    it(`${name} writes JPEGs a PDF can hold: no APP markers, right size and channels`, async () => {
      const jpegli = wrapJpegli(await createJpegliModule({ wasmBinary: wasm(name) }))
      expect(jpegli.simdTarget).toBe(name === 'jpegli.wasm' ? 'WASM' : 'EMU128')
      for (const components of [3, 1] as const) {
        const bytes = jpegli.encode(testImage(320, 200, components), 320, 200, components, jpegliSettingsFor(0.8))
        expect(readJpegInfo(bytes)).toMatchObject({ width: 320, height: 200, components })
        // SOI then straight to tables: no JFIF, Exif, ICC or Adobe segment for a PDF viewer to second-guess.
        expect(bytes[2]).toBe(0xff)
        expect(bytes[3] >= 0xe0 && bytes[3] <= 0xef).toBe(false)
        const decoded = jpeg.decode(bytes, { useTArray: true })
        expect([decoded.width, decoded.height]).toEqual([320, 200])
      }
    })
  }

  it('looks close to the source and gets lighter as quality drops', async () => {
    const jpegli = wrapJpegli(await createJpegliModule({ wasmBinary: wasm('jpegli.wasm') }))
    const source = testImage(256, 256, 3)
    const sizes = [0.85, 0.76, 0.66].map((quality) => jpegli.encode(source, 256, 256, 3, jpegliSettingsFor(quality)).byteLength)
    expect(sizes[0]).toBeGreaterThan(sizes[1])
    expect(sizes[1]).toBeGreaterThan(sizes[2])
    const decoded = jpeg.decode(jpegli.encode(source, 256, 256, 3, jpegliSettingsFor(0.85)), { useTArray: true, formatAsRGBA: false })
    let error = 0
    for (let index = 0; index < source.length; index += 1) error += Math.abs(decoded.data[index] - source[index])
    expect(error / source.length).toBeLessThan(3)
  })

  it('refuses bad input instead of crashing, and keeps working afterwards', async () => {
    const jpegli = wrapJpegli(await createJpegliModule({ wasmBinary: wasm('jpegli.wasm') }))
    expect(() => jpegli.encode(new Uint8Array(10), 320, 200, 3, {})).toThrow(/shorter/)
    expect(() => jpegli.encode(new Uint8Array(70000 * 3), 70000, 1, 3, {})).toThrow(/jpegli/)
    expect(readJpegInfo(jpegli.encode(testImage(64, 64, 3), 64, 64, 3, {}))?.width).toBe(64)
  })

  it('asks more of sharper rungs, and guesses lower distances for them', () => {
    for (let index = 1; index < JPEGLI_LOOKS.length; index += 1) {
      const [quality, target, distance] = JPEGLI_LOOKS[index]
      const [lowerQuality, lowerTarget, lowerDistance] = JPEGLI_LOOKS[index - 1]
      expect(quality).toBeGreaterThan(lowerQuality)
      expect(target).toBeGreaterThan(lowerTarget)
      expect(distance).toBeLessThan(lowerDistance)
    }
    expect(looksFor(0.5)).toEqual({ target: JPEGLI_LOOKS[0][1], distance: JPEGLI_LOOKS[0][2] })
    expect(looksFor(0.99).target).toBe(JPEGLI_LOOKS[JPEGLI_LOOKS.length - 1][1])
    const between = looksFor(0.78)
    expect(between.target).toBeGreaterThan(looksFor(0.76).target)
    expect(between.target).toBeLessThan(looksFor(0.8).target)
    expect(jpegliSettingsFor(0.8)).toEqual({ distance: looksFor(0.8).distance, subsample420: true, progressive: true })
  })

  it('detects WebAssembly SIMD (Node has it)', () => {
    expect(wasmSimdSupported()).toBe(true)
  })
})

/** A photo-like scene: a smooth sky over a busy, noisy ground. */
function scene(width: number, height: number, components: 1 | 3): Uint8Array {
  const samples = new Uint8Array(width * height * components)
  let seed = 7
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24) - 128
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < components; c += 1) {
        const sky = 150 + (60 * y) / height + c * 15
        const ground = 90 + 40 * Math.sin(x / 5 + c) * Math.sin(y / 7) + noise() / 4
        samples[(y * width + x) * components + c] = Math.max(0, Math.min(255, Math.round(y < height / 2 ? sky : ground)))
      }
    }
  }
  return samples
}

function decodeSamples(bytes: Uint8Array, components: 1 | 3): Uint8Array {
  const { data, width, height } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false })
  if (components === 3) return data
  const gray = new Uint8Array(width * height)
  for (let pixel = 0; pixel < gray.length; pixel += 1) gray[pixel] = data[pixel * 3]
  return gray
}

describe('the look check', () => {
  it('picks detailed tiles and one smooth, non-flat tile; small images whole', () => {
    const width = TILE * 4
    const height = TILE * 2
    const samples = scene(width, height, 3)
    const tiles = pickTiles(samples, width, height, 3)
    expect(tiles).toHaveLength(3)
    // The two busiest tiles are on the ground, the smooth one in the sky.
    expect(tiles.filter((tile) => tile.y >= height / 2)).toHaveLength(2)
    expect(tiles.filter((tile) => tile.y < height / 2)).toHaveLength(1)
    expect(pickTiles(samples, 500, 300, 3)).toEqual([{ x: 0, y: 0, width: 500, height: 300 }])
    const tile = tiles[0]
    const cut = cropTile(samples, width, 3, tile)
    expect(cut.byteLength).toBe(TILE * TILE * 3)
    expect(cut.subarray(0, 3)).toEqual(samples.subarray((tile.y * width + tile.x) * 3, (tile.y * width + tile.x) * 3 + 3))
  })

  it('searches to the lightest distance that still reaches the target', async () => {
    const jpegli = wrapJpegli(await createJpegliModule({ wasmBinary: wasm('jpegli.wasm') }))
    await ssimulacra2.load(wasm('ssimulacra2.wasm'))
    for (const components of [3, 1] as const) {
      const width = 1000
      const height = 700
      const samples = scene(width, height, components)
      const tiles = pickTiles(samples, width, height, components)
      const reference = tiles.map((tile) => cropTile(samples, width, components, tile))
      const scoreOf = async (bytes: Uint8Array) => {
        const decoded = decodeSamples(bytes, components)
        return judge(ssimulacra2.score, reference, tiles.map((tile) => cropTile(decoded, width, components, tile)), tiles, components)
      }
      const encode = (distance: number) => jpegli.encode(samples, width, height, components, { distance, progressive: true })
      for (const target of [80, 70]) {
        const found = await searchDistance(encode, scoreOf, target, 1.5, { tolerance: 0.5, maxSteps: 7 })
        expect(found.score).toBeGreaterThanOrEqual(target)
        expect(found.steps).toBeLessThanOrEqual(7)
        // Lighter settings than the one chosen fall short of the target (or are no lighter).
        const lighter = encode(found.distance * 1.15)
        expect(lighter.byteLength >= found.bytes.byteLength || (await scoreOf(lighter)) < target + 0.5).toBe(true)
      }
    }
  })

  it('writes the table distance when there is no scorer, and for tiny images', async () => {
    const jpegli = wrapJpegli(await createJpegliModule({ wasmBinary: wasm('jpegli.wasm') }))
    const write = jpegWriter(jpegli)
    const samples = scene(320, 200, 3)
    expect(await write(samples, 320, 200, 3, 0.8)).toEqual(jpegli.encode(samples, 320, 200, 3, jpegliSettingsFor(0.8)))
    const checked = jpegWriter(jpegli, () => {
      throw new Error('should not be scored')
    })
    const tiny = scene(40, 30, 3)
    expect(await checked(tiny, 40, 30, 3, 0.8)).toEqual(jpegli.encode(tiny, 40, 30, 3, jpegliSettingsFor(0.8)))
  })
})

describe('libdeflate', () => {
  it('writes zlib streams that inflate back exactly, smaller than zlib level 6', async () => {
    const deflate = await createDeflate(wasm('libdeflate.wasm'))
    const content = new TextEncoder().encode(Array.from({ length: 4000 }, (_, i) => `${(i * 1.37).toFixed(4)} ${(i * 0.91).toFixed(4)} l\n`).join(''))
    const compressed = await deflate(content)
    expect(inflateSync(compressed)).toEqual(Buffer.from(content))
    const { deflateSync } = await import('node:zlib')
    expect(compressed.byteLength).toBeLessThan(deflateSync(content, { level: 6 }).byteLength)
    expect(inflateSync(await deflate(new Uint8Array()))).toHaveLength(0)
  })
})

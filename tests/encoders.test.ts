// @vitest-environment node
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { createDeflate } from '../src/lib/encoders/deflate'
import { jpegliSettingsFor, JPEGLI_DISTANCE } from '../src/lib/encoders/index'
import { wrapJpegli, wasmSimdSupported } from '../src/lib/encoders/jpegli'
import createJpegliModule from '../src/lib/encoders/wasm/jpegli.js'
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

  it('maps the ladder qualities to distances that fall as quality rises', () => {
    const distances = JPEGLI_DISTANCE.map(([quality]) => jpegliSettingsFor(quality).distance!)
    for (let index = 1; index < distances.length; index += 1) expect(distances[index]).toBeLessThan(distances[index - 1])
    expect(jpegliSettingsFor(0.5).distance).toBe(JPEGLI_DISTANCE[0][1])
    expect(jpegliSettingsFor(0.99).distance).toBe(JPEGLI_DISTANCE[JPEGLI_DISTANCE.length - 1][1])
  })

  it('detects WebAssembly SIMD (Node has it)', () => {
    expect(wasmSimdSupported()).toBe(true)
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

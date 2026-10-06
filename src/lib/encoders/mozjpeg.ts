/**
 * MozJPEG (via @jsquash/jpeg) as a JPEG writer for the browser codec. Bench
 * candidate; `qualityFor` maps the canvas quality scale to MozJPEG's.
 */
import encode, { init } from '@jsquash/jpeg/encode'
import type { EncoderOverrides } from '../engine/codec'

export async function loadMozjpeg(qualityFor: (canvasQuality: number) => number = (q) => Math.round(q * 100)): Promise<NonNullable<EncoderOverrides['writeJpeg']>> {
  await init()
  return async (samples, width, height, components, quality) => {
    const count = width * height
    const rgba = new Uint8ClampedArray(count * 4)
    for (let pixel = 0; pixel < count; pixel += 1) {
      const r = components === 3 ? samples[pixel * 3] : samples[pixel]
      rgba[pixel * 4] = r
      rgba[pixel * 4 + 1] = components === 3 ? samples[pixel * 3 + 1] : r
      rgba[pixel * 4 + 2] = components === 3 ? samples[pixel * 3 + 2] : r
      rgba[pixel * 4 + 3] = 255
    }
    const options = { quality: qualityFor(quality), progressive: false, baseline: true, color_space: components === 3 ? 3 : 1 }
    return new Uint8Array(await encode(new ImageData(rgba, width, height), options))
  }
}

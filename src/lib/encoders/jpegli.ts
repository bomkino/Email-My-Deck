/**
 * Google's jpegli (BSD-3-Clause) compiled to WebAssembly: a libjpeg-compatible
 * encoder with adaptive quantisation, so a JPEG looks as good as the browser's
 * at fewer bytes. Writes plain YCbCr or gray JPEGs (baseline or progressive,
 * which DCTDecode has read since PDF 1.3) with no APP markers to second-guess.
 * Build: scripts/codecs/jpegli/build.sh.
 */
import type { JpegliEmscriptenModule } from './wasm/jpegli.js'
import plainUrl from './wasm/jpegli-nosimd.wasm?url'
import simdUrl from './wasm/jpegli.wasm?url'

export type JpegliSettings = {
  /** libjpeg-style quality, 1–100. Ignored when `distance` is set. */
  quality?: number
  /** Butteraugli-style distance (1 ≈ visually lossless up close); wins over `quality`. */
  distance?: number
  /** 4:2:0 chroma (default) or 4:4:4. */
  subsample420?: boolean
  progressive?: boolean
}

export type Jpegli = {
  encode(samples: Uint8Array, width: number, height: number, components: 1 | 3, settings: JpegliSettings): Uint8Array
  simdTarget: string
}

export function wrapJpegli(module: JpegliEmscriptenModule): Jpegli {
  return {
    simdTarget: module.UTF8ToString(module._emd_jpegli_simd_target()),
    encode(samples, width, height, components, settings) {
      const size = width * height * components
      if (samples.byteLength < size) throw new Error('Image samples are shorter than the image size.')
      const input = module._malloc(size)
      const outSize = module._malloc(4)
      if (!input || !outSize) {
        module._free(input)
        module._free(outSize)
        throw new Error('jpegli is out of memory.')
      }
      try {
        module.HEAPU8.set(samples.subarray(0, size), input)
        const output = module._emd_jpegli_encode(input, width, height, components, settings.quality ?? 90, settings.distance ?? 0, settings.subsample420 === false ? 0 : 1, settings.progressive ? 1 : 0, outSize)
        if (!output) throw new Error(`jpegli: ${module.UTF8ToString(module._emd_jpegli_last_error()) || 'could not encode'}`)
        // Read through the current heap: encoding may have grown (and replaced) it.
        const heap = module.HEAPU8
        const length = new DataView(heap.buffer, heap.byteOffset).getUint32(outSize, true)
        const bytes = heap.slice(output, output + length)
        module._emd_free(output)
        return bytes
      } finally {
        module._free(input)
        module._free(outSize)
      }
    },
  }
}

/** True when this engine runs WebAssembly SIMD (Chrome 91+, Firefox 89+, Safari 16.4+). */
export function wasmSimdSupported(): boolean {
  try {
    // A module whose only function returns an i32x4 (v128.const): valid only with SIMD.
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1, 20, 0, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11]))
  } catch {
    return false
  }
}

/** Browser loader: the glue and the right wasm (SIMD or not) are separate assets, fetched when first needed. */
export async function loadJpegli(): Promise<Jpegli> {
  const { default: factory } = await import('./wasm/jpegli.js')
  const url = wasmSimdSupported() ? simdUrl : plainUrl
  return wrapJpegli(await factory({ locateFile: () => url }))
}

/**
 * SSIMULACRA2, Cloudinary's perceptual image metric (the Rust port, BSD-2-Clause),
 * compiled to WebAssembly: 100 is identical, 90 visually lossless, 70 high
 * quality. The fastest build this browser runs exactly is fetched; all three
 * give the same scores. Build: scripts/codecs/ssimulacra2/build.sh.
 */
import type { Score } from './looks'
import nosimd from './wasm/ssimulacra2-nosimd.wasm?url'
import relaxed from './wasm/ssimulacra2-relaxed.wasm?url'
import simd from './wasm/ssimulacra2.wasm?url'

export async function loadScorer(): Promise<Score> {
  const scorer = await import('./wasm/ssimulacra2.js')
  await scorer.load({ relaxed, simd, nosimd }[scorer.bestVariant()])
  return (reference, distorted, width, height, channels) => scorer.score(reference, distorted, width, height, channels)
}

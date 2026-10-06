/**
 * SSIMULACRA2, Cloudinary's perceptual image metric (the Rust port, BSD-2-Clause),
 * compiled to WebAssembly: 100 is identical, 90 visually lossless, 70 high
 * quality. The fastest build this browser runs exactly is fetched; all three
 * give the same scores. Build: scripts/codecs/build-ssimulacra2.sh.
 */
import type { Score } from './looks'

export async function loadScorer(): Promise<Score> {
  const [scorer, { default: relaxed }, { default: simd }, { default: nosimd }] = await Promise.all([
    import('./wasm/ssimulacra2.js'),
    import('./wasm/ssimulacra2-relaxed.wasm?url'),
    import('./wasm/ssimulacra2.wasm?url'),
    import('./wasm/ssimulacra2-nosimd.wasm?url'),
  ])
  await scorer.load({ relaxed, simd, nosimd }[scorer.bestVariant()])
  return (reference, distorted, width, height, channels) => scorer.score(reference, distorted, width, height, channels)
}

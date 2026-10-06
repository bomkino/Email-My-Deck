// Codec kinds the deck bench can run: "canvas" (the browser's own encoders),
// "wasm" (exactly what the app loads) or replacements from src/lib/encoders,
// alone or together ("jpegli+lanczos+deflate"; "looks" adds the look check to jpegli).
import { browserCodec, createBrowserCodec, type EncoderOverrides, type ImageCodec } from '../../src/lib/engine/codec'
import { loadDeflate } from '../../src/lib/encoders/deflate'
import { jpegWriter, loadEncoders } from '../../src/lib/encoders/index'
import { loadJpegli } from '../../src/lib/encoders/jpegli'
import { loadMozjpeg } from './mozjpeg'
import { loadResize } from '../../src/lib/encoders/resize'
import { loadScorer } from '../../src/lib/encoders/scorer'

export async function codecFor(kind: string): Promise<ImageCodec> {
  if (kind === 'canvas') return browserCodec
  if (kind === 'wasm') return createBrowserCodec(await loadEncoders())
  const overrides: EncoderOverrides = {}
  const parts = kind.split('+')
  for (const part of parts) {
    if (part === 'jpegli') overrides.writeJpeg = jpegWriter(await loadJpegli(), parts.includes('looks') ? await loadScorer() : undefined)
    else if (part === 'looks') continue
    else if (part === 'mozjpeg') overrides.writeJpeg = await loadMozjpeg()
    else if (part === 'lanczos') overrides.resize = await loadResize()
    else if (part === 'deflate') overrides.deflate = await loadDeflate()
    else throw new Error(`Unknown codec part ${part}`)
  }
  return createBrowserCodec(overrides)
}

// Runs the real engine on one deck with a chosen image codec, for bench/run-decks.mjs.
import { compressDocument } from '../../src/lib/engine/engine'
import { createCodecPool, poolSize } from '../../src/lib/engine/pool'
import { loadDeflate } from '../../src/lib/encoders/deflate'
import type { QpdfLoader, QpdfModuleFactory } from '../../src/lib/engine/qpdf'
import { codecFor } from './codecs'

const loadQpdf: QpdfLoader = async () => {
  const [{ default: factory }, { default: wasmUrl }] = await Promise.all([import('@neslinesli93/qpdf-wasm'), import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url')])
  return { factory: factory as unknown as QpdfModuleFactory, wasmUrl }
}

type Job = { bytes: Uint8Array; budget: number; codec: string; save?: boolean }

self.onmessage = async (event: MessageEvent<Job>) => {
  const { bytes, budget, codec: kind, save } = event.data
  const fallback = await codecFor(kind)
  const codec = createCodecPool(() => new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module', name: kind }), poolSize(), fallback)
  const started = performance.now()
  try {
    const deflate = kind === 'wasm' || kind.split('+').includes('deflate') ? await loadDeflate() : undefined
    const result = await compressDocument(bytes, budget, { qpdf: loadQpdf, codec, deflate })
    self.postMessage({ ok: true, kind: result.kind, bytes: result.bytes.byteLength, rung: result.rung?.id ?? null, attempts: result.attempts, images: result.images, splitReason: result.splitReason ?? null, ms: performance.now() - started, output: save ? result.bytes : undefined })
  } catch (error) {
    self.postMessage({ ok: false, error: String(error), ms: performance.now() - started })
  } finally {
    codec.dispose()
  }
}

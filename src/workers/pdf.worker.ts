import { toOutcome } from '../lib/compression'
import { browserCodecAvailable, type ImageCodec } from '../lib/engine/codec'
import { compressDocument, type EngineDeps } from '../lib/engine/engine'
import { toEngineError } from '../lib/engine/errors'
import { createCodecPool, poolSize } from '../lib/engine/pool'
import { loadDeflate, type Deflate } from '../lib/encoders/deflate'
import { loadCodec, WASM_ENCODERS } from '../lib/encoders'
import type { ProgressEvent } from '../lib/engine/progress'
import type { WorkerMessage, WorkerRequest } from '../lib/engine/protocol'
import type { QpdfLoader, QpdfModuleFactory } from '../lib/engine/qpdf'
import { measureSplitPlan, splitDocument } from '../lib/engine/split'
import { getTargetProfile, rawBudgetBytes } from '../lib/profiles'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void
}

const loadQpdf: QpdfLoader = async () => {
  const [{ default: factory }, { default: wasmUrl }] = await Promise.all([
    import('@neslinesli93/qpdf-wasm'),
    import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'),
  ])
  return { factory: factory as unknown as QpdfModuleFactory, wasmUrl }
}

/** Images run here when no image worker can: same encoders as the workers, loaded only then. */
let localCodec: Promise<ImageCodec> | null = null
const inThisWorker: ImageCodec = {
  async encode(source, outputs) {
    localCodec ??= loadCodec()
    return (await localCodec).encode(source, outputs)
  },
}

function createCodec(): ImageCodec | null {
  if (!browserCodecAvailable()) return null
  if (typeof Worker !== 'function') return inThisWorker
  return createCodecPool(() => new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' }), poolSize(), inThisWorker)
}

/** Last fraction sent per job, so a later split request continues the bar instead of restarting it. */
const lastFraction = new Map<number, number>()

/** libdeflate for the drawings the engine rewrites, loaded once; the browser's own Flate when it can't load. */
let strongDeflate: Promise<Deflate | undefined> | null = null
function drawingDeflate(): Promise<Deflate | undefined> {
  if (!WASM_ENCODERS) return Promise.resolve(undefined)
  strongDeflate ??= loadDeflate().catch((error) => {
    console.warn('Email My Deck is using the browser\'s Flate for drawings', error)
    return undefined
  })
  return strongDeflate
}

function depsFor(jobId: number, codec: ImageCodec | null, deflate: Deflate | undefined): EngineDeps {
  return {
    qpdf: loadQpdf,
    codec,
    deflate,
    onProgress: (event: ProgressEvent) => {
      lastFraction.set(jobId, event.fraction)
      scope.postMessage({ type: 'progress', jobId, ...event })
    },
  }
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  // Only the newest job matters; forget older ones.
  for (const jobId of lastFraction.keys()) if (jobId < request.jobId) lastFraction.delete(jobId)
  const codec = request.type === 'compress' && request.mode !== 'flatten' ? createCodec() : null
  try {
    const deps = depsFor(request.jobId, codec, request.type === 'compress' ? await drawingDeflate() : undefined)
    if (request.type === 'compress') {
      const profile = getTargetProfile(request.profileId, request.customMessageMB ?? request.customMessageMiB)
      const budget = rawBudgetBytes(profile)
      const originalBytes = request.bytes.byteLength
      if (request.mode === 'flatten') {
        // PDF.js and the flattener load only when someone asks for them.
        const [{ flattenDocument }, { pdfjsRasterizer }] = await Promise.all([import('../lib/engine/flatten'), import('../lib/engine/pdfjs')])
        const result = await flattenDocument(request.bytes, budget, { qpdf: loadQpdf, rasterizer: pdfjsRasterizer, onProgress: deps.onProgress })
        const outcome = toOutcome(result, originalBytes, profile, budget)
        scope.postMessage({ type: 'compress-result', jobId: request.jobId, outcome }, [outcome.candidate.bytes.buffer])
        return
      }
      const result = await compressDocument(request.bytes, budget, deps, { keepSession: true })
      const outcome = toOutcome(result, originalBytes, profile, budget)
      if (result.kind === 'split-needed' && request.autoSplit && result.session && result.path) {
        const parts = await splitDocument({ session: result.session, path: result.path }, budget, deps, { startFraction: lastFraction.get(request.jobId) })
        const message = parts.map((part) => ({ ...part, pages: part.endPage - part.startPage + 1 }))
        scope.postMessage({ type: 'split-result', jobId: request.jobId, parts: message, outcome }, [...message.map((part) => part.bytes.buffer), outcome.candidate.bytes.buffer])
        return
      }
      // The page lets the visitor choose where to split, so it needs to know where the weight is.
      // Without a plan it still offers a split, just not where.
      if (result.kind === 'split-needed' && result.session && result.path) {
        try {
          outcome.splitPlan = measureSplitPlan(result.session, result.path)
        } catch (error) {
          console.warn('Email My Deck could not plan a split', error)
        }
      }
      scope.postMessage({ type: 'compress-result', jobId: request.jobId, outcome }, [outcome.candidate.bytes.buffer])
      return
    }
    const parts = await splitDocument(request.bytes, request.maxPartBytes, deps, { startFraction: lastFraction.get(request.jobId), breakAfter: request.breakAfter })
    const message = parts.map((part) => ({ ...part, pages: part.endPage - part.startPage + 1 }))
    scope.postMessage({ type: 'split-result', jobId: request.jobId, parts: message }, message.map((part) => part.bytes.buffer))
  } catch (error) {
    const coded = toEngineError(error)
    if (coded.code === 'engine') console.error('Email My Deck engine error', error)
    scope.postMessage({ type: 'error', jobId: request.jobId, message: coded.message, code: coded.code, reason: coded.reason, page: coded.page })
  } finally {
    if (codec && 'dispose' in codec) (codec as { dispose(): void }).dispose()
  }
}

export {}

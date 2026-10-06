import { compressPdf } from '../lib/compression'
import { inspectPdf, splitPdf } from '../lib/pdf'
import { getTargetProfile, type TargetProfileId } from '../lib/profiles'

type WorkerRequest =
  | { type: 'compress'; bytes: Uint8Array; profileId: TargetProfileId; customMessageMiB?: number }
  | { type: 'split'; bytes: Uint8Array; maxPartBytes: number }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const request = event.data
    if (request.type === 'compress') {
      const inspection = await inspectPdf(request.bytes)
      const profile = getTargetProfile(request.profileId, request.customMessageMiB)
      const outcome = await compressPdf(request.bytes, profile, inspection, (progress) => {
        scope.postMessage({ type: 'progress', ...progress })
      })
      const outputInspection = await inspectPdf(outcome.candidate.bytes)
      if (outputInspection.pages !== inspection.pages) {
        throw new Error('The candidate changed the page count, so it was rejected.')
      }
      scope.postMessage({ type: 'compress-result', outcome }, [outcome.candidate.bytes.buffer])
      return
    }
    const parts = await splitPdf(request.bytes, request.maxPartBytes)
    const detailedParts = await Promise.all(parts.map(async (bytes) => ({ bytes, pages: (await inspectPdf(bytes)).pages })))
    // A split result is intentionally sent as separate transferable buffers.
    scope.postMessage({ type: 'split-result', parts: detailedParts }, detailedParts.map((part) => part.bytes.buffer))
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The local PDF worker failed.' })
  }
}

export {}

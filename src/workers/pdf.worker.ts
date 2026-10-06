import { compressPdf, runGhostscript } from '../lib/compression'
import { inspectPdf, splitPdf } from '../lib/pdf'
import { estimatedMessageBytes, getTargetProfile, type TargetProfileId } from '../lib/profiles'

type WorkerRequest =
  | { type: 'compress'; jobId: number; bytes: Uint8Array; profileId: TargetProfileId; customMessageMiB?: number }
  | { type: 'split'; jobId: number; bytes: Uint8Array; maxPartBytes: number }

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
      let outcome
      try {
        outcome = await compressPdf(request.bytes, profile, inspection, (progress) => {
          scope.postMessage({ type: 'progress', jobId: request.jobId, ...progress })
        })
      } catch (error) {
        const protectedPdf = inspection.encrypted || inspection.hasSignature || inspection.hasForms || inspection.hasAttachments || inspection.hasJavaScript
        if (!protectedPdf) throw error
        if (inspection.encrypted) throw new Error('This PDF is password-protected. Export an unlocked copy before using Email My Deck.')
        throw new Error('This PDF contains protected features. Export a flattened copy before compressing it so those features are not silently changed.')
      }
      if (outcome.candidate.bytes.byteLength > outcome.targetBytes) {
        const baseCandidate = outcome.candidate.bytes
        try {
          const strongBytes = await runGhostscript(baseCandidate, (progress) => {
            scope.postMessage({ type: 'progress', jobId: request.jobId, ...progress, fraction: 0.94 + progress.fraction * 0.05 })
          })
          const strongInspection = await inspectPdf(strongBytes)
          const strongIsSafe = strongBytes.byteLength < baseCandidate.byteLength && strongInspection.pages === inspection.pages
          if (strongIsSafe && strongBytes.byteLength <= outcome.targetBytes) {
            outcome = {
              ...outcome,
              candidate: { bytes: strongBytes, engine: 'ghostscript', quality: 'strong', notes: ['Images downsampled for email. Page count and geometry were checked before offering the result.'] },
              estimatedMessageBytes: estimatedMessageBytes(strongBytes.byteLength, profile),
            }
          }
        } catch (error) {
          console.warn('Ghostscript candidate unavailable', error)
        }
      }
      const outputInspection = await inspectPdf(outcome.candidate.bytes)
      const samePageGeometry = outputInspection.pageSizes.length === inspection.pageSizes.length && outputInspection.pageSizes.every((size, index) => size[0] === inspection.pageSizes[index][0] && size[1] === inspection.pageSizes[index][1])
      if (outputInspection.pages !== inspection.pages || !samePageGeometry) {
        throw new Error('The candidate changed the page count, so it was rejected.')
      }
      scope.postMessage({ type: 'compress-result', jobId: request.jobId, outcome }, [outcome.candidate.bytes.buffer])
      return
    }
    const parts = await splitPdf(request.bytes, request.maxPartBytes)
    const detailedParts = await Promise.all(parts.map(async (bytes) => ({ bytes, pages: (await inspectPdf(bytes)).pages })))
    // A split result is intentionally sent as separate transferable buffers.
    scope.postMessage({ type: 'split-result', jobId: request.jobId, parts: detailedParts }, detailedParts.map((part) => part.bytes.buffer))
  } catch (error) {
    scope.postMessage({ type: 'error', jobId: event.data.jobId, message: error instanceof Error ? error.message : 'The local PDF worker failed.' })
  }
}

export {}

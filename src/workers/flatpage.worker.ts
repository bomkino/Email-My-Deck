import { flatPageVersions, type FlatPageRequest, type PageVersion } from '../lib/engine/flatpage'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FlatPageRequest & { id: number }>) => void) | null
  postMessage(message: { id: number; versions?: PageVersion[]; error?: string }, transfer?: Transferable[]): void
}

// Re-saves and scores one flattened slide. Runs nested inside the PDF worker.
scope.onmessage = async (event) => {
  const { id, ...request } = event.data
  try {
    const versions = await flatPageVersions(request)
    scope.postMessage({ id, versions }, versions.map((version) => version.bytes.buffer as ArrayBuffer))
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

export {}

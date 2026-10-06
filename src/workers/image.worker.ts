import { browserCodec } from '../lib/engine/codec'
import type { PoolRequest, PoolResponse } from '../lib/engine/pool'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PoolRequest>) => void) | null
  postMessage(message: PoolResponse, transfer?: Transferable[]): void
}

// Decodes one image and encodes the requested sizes. Runs nested inside the PDF worker.
scope.onmessage = async (event: MessageEvent<PoolRequest>) => {
  const { id, source, outputs } = event.data
  try {
    const results = await browserCodec.encode(source, outputs)
    scope.postMessage({ id, results }, results.map((result) => result.bytes.buffer as ArrayBuffer))
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

export {}

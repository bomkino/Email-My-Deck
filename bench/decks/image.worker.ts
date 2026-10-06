// Nested image worker for the deck bench; the codec kind arrives as the worker's name.
import type { PoolRequest, PoolResponse } from '../../src/lib/engine/pool'
import { codecFor } from './codecs'

const ready = codecFor(self.name)

self.onmessage = async (event: MessageEvent<PoolRequest>) => {
  const { id, source, outputs } = event.data
  try {
    const results = await (await ready).encode(source, outputs)
    ;(self as unknown as Worker).postMessage({ id, results } satisfies PoolResponse, results.map((result) => result.bytes.buffer as ArrayBuffer))
  } catch (error) {
    ;(self as unknown as Worker).postMessage({ id, error: String(error) } satisfies PoolResponse)
  }
}

import type { CodecOutput, CodecResult, CodecSource, ImageCodec } from './codec'

type Pending = { resolve: (results: CodecResult[]) => void; reject: (error: Error) => void }
type Slot = { worker: Worker; busy: boolean; pending: Map<number, Pending> }

export type PoolRequest = { id: number; source: CodecSource; outputs: CodecOutput[] }
export type PoolResponse = { id: number; results?: CodecResult[]; error?: string }

/** Workers to use for images: leave a core for the page, and stay small on low-memory devices. */
export function poolSize(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2
  const memory = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined
  const limit = memory !== undefined && memory <= 4 ? 2 : 4
  return Math.max(1, Math.min(limit, cores - 1))
}

/**
 * Spreads image decode/encode over a few nested workers. If this browser
 * cannot start one, everything runs on `fallback` in the current worker.
 */
export function createCodecPool(spawn: () => Worker, size: number, fallback: ImageCodec): ImageCodec & { dispose(): void } {
  const slots: Slot[] = []
  const waiting: Array<() => void> = []
  let nextId = 1
  let broken = size < 2

  const release = (slot: Slot) => {
    slot.busy = false
    waiting.shift()?.()
  }

  const fail = (slot: Slot, error: Error) => {
    broken = true
    for (const pending of slot.pending.values()) pending.reject(error)
    slot.pending.clear()
    slot.worker.terminate()
    const index = slots.indexOf(slot)
    if (index >= 0) slots.splice(index, 1)
    // Anyone waiting for a slot now runs on the fallback.
    while (waiting.length) waiting.shift()?.()
  }

  if (!broken) {
    try {
      for (let index = 0; index < size; index += 1) {
        const slot: Slot = { worker: spawn(), busy: false, pending: new Map() }
        slot.worker.onmessage = (event: MessageEvent<PoolResponse>) => {
          const pending = slot.pending.get(event.data.id)
          if (!pending) return
          slot.pending.delete(event.data.id)
          if (event.data.results) pending.resolve(event.data.results)
          else pending.reject(new Error(event.data.error ?? 'Image worker failed.'))
        }
        slot.worker.onerror = (event) => {
          event.preventDefault?.()
          fail(slot, new Error('Image worker stopped.'))
        }
        slots.push(slot)
      }
    } catch {
      broken = true
      for (const slot of slots.splice(0)) slot.worker.terminate()
    }
  }

  const acquire = async (): Promise<Slot | null> => {
    for (;;) {
      if (broken || !slots.length) return null
      const free = slots.find((slot) => !slot.busy)
      if (free) {
        free.busy = true
        return free
      }
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
  }

  return {
    concurrency: broken ? 1 : slots.length,
    async encode(source, outputs) {
      const slot = await acquire()
      if (!slot) return fallback.encode(source, outputs)
      try {
        const id = nextId++
        const result = new Promise<CodecResult[]>((resolve, reject) => slot.pending.set(id, { resolve, reject }))
        const request: PoolRequest = { id, source, outputs }
        slot.worker.postMessage(request, [source.bytes.buffer])
        return await result
      } finally {
        release(slot)
      }
    },
    dispose() {
      for (const slot of slots.splice(0)) slot.worker.terminate()
    },
  }
}

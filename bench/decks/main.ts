// Deck bench page: compress one deck at one budget with one codec in a fresh worker.
const deckBench = {
  async run(options: { url: string; budget: number; codec: string }) {
    const bytes = new Uint8Array(await (await fetch(options.url)).arrayBuffer())
    const worker = new Worker(new URL('./deck.worker.ts', import.meta.url), { type: 'module' })
    try {
      return await new Promise((resolve) => {
        worker.onmessage = (event) => resolve(event.data)
        worker.onerror = (event) => resolve({ ok: false, error: event.message })
        worker.postMessage({ bytes, budget: options.budget, codec: options.codec }, [bytes.buffer])
      })
    } finally {
      worker.terminate()
    }
  },
}
;(globalThis as unknown as { deckBench: typeof deckBench }).deckBench = deckBench

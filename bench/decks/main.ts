// Deck bench page: compress one deck at one budget with one codec in a fresh worker.
const deckBench = {
  async run(options: { url: string; budget: number; codec: string; save?: boolean }) {
    const bytes = new Uint8Array(await (await fetch(options.url)).arrayBuffer())
    const worker = new Worker(new URL('./deck.worker.ts', import.meta.url), { type: 'module' })
    try {
      return await new Promise((resolve) => {
        worker.onmessage = (event) => {
          const { output, ...row } = event.data
          // The compressed deck comes back as base64 only when asked for (for looking at it).
          if (options.save && output) {
            let binary = ''
            for (let index = 0; index < output.length; index += 0x8000) binary += String.fromCharCode(...output.subarray(index, index + 0x8000))
            row.output = btoa(binary)
          }
          resolve(row)
        }
        worker.onerror = (event) => resolve({ ok: false, error: event.message })
        worker.postMessage({ bytes, budget: options.budget, codec: options.codec, save: options.save }, [bytes.buffer])
      })
    } finally {
      worker.terminate()
    }
  },
}
;(globalThis as unknown as { deckBench: typeof deckBench }).deckBench = deckBench

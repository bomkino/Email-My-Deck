/**
 * libdeflate (MIT) compiled to WebAssembly: zlib streams (PDF FlateDecode)
 * about 6–10% smaller than the browser's CompressionStream, at 6–16 MB/s.
 * Build: scripts/codecs/build-libdeflate.sh.
 */

type Exports = {
  memory: WebAssembly.Memory
  _initialize(): void
  malloc(size: number): number
  free(pointer: number): void
  emd_zlib_compress(input: number, inputLength: number, level: number, outputLength: number): number
}

/** Level 10 is where libdeflate's near-optimal parser starts: most of level 12's gain at twice its speed. */
export const DEFLATE_LEVEL = 10

export type Deflate = (data: Uint8Array) => Promise<Uint8Array>

/** Instantiate from compiled module bytes or a module (tests read the file; the browser fetches it). */
export async function createDeflate(wasm: BufferSource | WebAssembly.Module, level = DEFLATE_LEVEL): Promise<Deflate> {
  const imports = { env: { emscripten_notify_memory_growth() {} } }
  const instance = wasm instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasm, imports) : (await WebAssembly.instantiate(wasm, imports)).instance
  const exports = instance.exports as unknown as Exports
  exports._initialize()
  return async (data) => {
    const input = exports.malloc(Math.max(1, data.byteLength))
    const length = exports.malloc(4)
    if (!input || !length) throw new Error('libdeflate is out of memory.')
    try {
      new Uint8Array(exports.memory.buffer, input, data.byteLength).set(data)
      const output = exports.emd_zlib_compress(input, data.byteLength, level, length)
      if (!output) throw new Error('libdeflate could not compress.')
      const size = new Uint32Array(exports.memory.buffer, length, 1)[0]
      const bytes = new Uint8Array(exports.memory.buffer, output, size).slice()
      exports.free(output)
      return bytes
    } finally {
      exports.free(input)
      exports.free(length)
    }
  }
}

/** Browser loader: the wasm is a separate, cached asset fetched only when first needed. */
export async function loadDeflate(level = DEFLATE_LEVEL): Promise<Deflate> {
  const { default: url } = await import('./wasm/libdeflate.wasm?url')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`libdeflate.wasm: HTTP ${response.status}`)
  return createDeflate(await response.arrayBuffer(), level)
}

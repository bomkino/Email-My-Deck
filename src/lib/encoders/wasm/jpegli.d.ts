// Emscripten glue for jpegli.wasm (built by scripts/codecs/build-jpegli.sh).
export type JpegliEmscriptenModule = {
  HEAPU8: Uint8Array
  UTF8ToString(pointer: number): string
  _malloc(size: number): number
  _free(pointer: number): void
  _emd_free(pointer: number): void
  _emd_jpegli_encode(pixels: number, width: number, height: number, components: number, quality: number, distance: number, subsample420: number, progressive: number, outSize: number): number
  _emd_jpegli_last_error(): number
  _emd_jpegli_simd_target(): number
}
export default function createJpegliModule(options?: { locateFile?: (path: string, prefix: string) => string; wasmBinary?: ArrayBuffer | Uint8Array }): Promise<JpegliEmscriptenModule>

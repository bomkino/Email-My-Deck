/**
 * Lanczos3 downscaling (the `resize` crate, MIT, via @jsquash/resize's
 * WebAssembly build). Sharper than the browser's canvas scaling and the same
 * in every browser, so a deck comes out the same size in Safari as in Chrome.
 * Resampled in the image's own gamma, like canvas: in linear light, dark text
 * on light backgrounds comes out visibly thinner.
 */
import initResize, { resize as wasmResize } from '@jsquash/resize/lib/resize/pkg/squoosh_resize.js'

/** Index of lanczos3 in the crate's filter list (triangle, catrom, mitchell, lanczos3). */
const LANCZOS3 = 3

export type Resize = (pixels: ImageData, width: number, height: number) => Promise<ImageData>

export function lanczos3(pixels: ImageData, width: number, height: number): ImageData {
  const data = wasmResize(new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), pixels.width, pixels.height, width, height, LANCZOS3, false, false)
  return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), width, height)
}

/** Browser loader: the wasm is a separate asset fetched when first needed. */
export async function loadResize(): Promise<Resize> {
  const { default: url } = await import('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm?url')
  await initResize(url)
  return async (pixels, width, height) => lanczos3(pixels, width, height)
}

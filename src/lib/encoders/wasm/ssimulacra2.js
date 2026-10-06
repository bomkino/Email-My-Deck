// ssimulacra2.js: dependency-free ES module for the SSIMULACRA2 WebAssembly scorer.
// Works in a module Web Worker, on the browser main thread and in Node >= 18.
//
//   import { load, score } from './ssimulacra2.js';
//   await load();                         // best build next to this file (see bestVariant())
//   await load('/static/ssimulacra2.wasm');                  // or a URL / URL string
//   await load(await (await fetch(url)).arrayBuffer());      // or bytes / Response / Module
//   const s = score(refPixels, distPixels, width, height, 3);
//
// ref and dist are interleaved 8-bit sRGB (channels 3), 8-bit gray (channels 1, used
// as R = G = B) or RGBA (channels 4, alpha ignored, e.g. ImageData.data), each exactly
// width * height * channels bytes. score() returns the SSIMULACRA 2.1 score: 100 means
// identical, about 90 visually lossless, 70 high quality, 50 medium, 30 low. Very
// strong distortion can give negative scores. Bad input throws TypeError / RangeError.
//
// Builds: ssimulacra2-relaxed.wasm (fastest; picked only when the engine supports
// relaxed SIMD and its relaxed multiply-add is fused, so results stay exact),
// ssimulacra2.wasm (SIMD) and ssimulacra2-nosimd.wasm. All three give the same scores.
//
// Memory: about 82 bytes per pixel at peak (about 170 MB for 1920x1080).
// WebAssembly memory never shrinks; call reset() to release it after large images.

const FILES = {
  relaxed: 'ssimulacra2-relaxed.wasm',
  simd: 'ssimulacra2.wasm',
  nosimd: 'ssimulacra2-nosimd.wasm',
};

// Error sentinels returned by emd_ssimulacra2 (crate/src/lib.rs ERR_*). Real scores
// can be negative, so errors live far below any score.
const ERRORS = new Map([
  [-1000001, 'invalid arguments'],
  [-1000002, 'image must be at least 8x8 pixels'],
  [-1000003, 'image too large: not enough WebAssembly memory'],
  [-1000004, 'internal error'],
]);

// (module (func (result v128) (i8x16.splat (i32.const 0))))
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 8, 1, 6, 0, 65, 0, 253,
  15, 11,
]);
// (func (export "f") (param f32 f32 f32) (result f32)
//   (f32x4.extract_lane 0 (f32x4.relaxed_madd (splat p0) (splat p1) (splat p2))))
const RELAXED_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 8, 1, 96, 3, 125, 125, 125, 1, 125, 3, 2, 1, 0, 7, 5, 1, 1,
  102, 0, 0, 10, 22, 1, 20, 0, 32, 0, 253, 19, 32, 1, 253, 19, 32, 2, 253, 19, 253, 133, 2,
  253, 31, 0, 11,
]);

let wasmModule = null; // compiled WebAssembly.Module, kept to re-instantiate after reset/trap
let exports = null; // exports of the live instance
let variant = null; // which build is loaded, when known

/** True if the runtime supports WebAssembly fixed-width SIMD (simd128). */
export function simdSupported() {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

/**
 * True if the runtime supports relaxed SIMD and evaluates f32x4.relaxed_madd fused
 * (single rounding). (1 + 2^-12)^2 - (1 + 2^-11) is 2^-24 when fused and 0 when not.
 */
export function relaxedMaddIsFused() {
  try {
    if (!WebAssembly.validate(RELAXED_PROBE)) return false;
    const { f } = new WebAssembly.Instance(new WebAssembly.Module(RELAXED_PROBE)).exports;
    const a = 1 + 2 ** -12;
    return f(a, a, -(1 + 2 ** -11)) === 2 ** -24;
  } catch {
    return false;
  }
}

/** The fastest build this runtime can use with exact results: 'relaxed', 'simd' or 'nosimd'. */
export function bestVariant() {
  if (relaxedMaddIsFused()) return 'relaxed';
  return simdSupported() ? 'simd' : 'nosimd';
}

/** URL of a build's .wasm file, by default next to this module. */
export function variantUrl(name = bestVariant(), base = import.meta.url) {
  if (!(name in FILES)) throw new RangeError(`ssimulacra2: unknown build ${name}`);
  return new URL(FILES[name], base);
}

function isBytes(x) {
  return x instanceof ArrayBuffer || ArrayBuffer.isView(x) ||
    (typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer);
}

async function readFileUrl(url) {
  // Node only (its fetch() rejects file: URLs). The specifier is a variable so
  // browser bundlers leave it alone.
  const spec = 'node:fs/promises';
  const fs = await import(/* @vite-ignore */ /* webpackIgnore: true */ spec);
  return fs.readFile(url);
}

async function compileResponse(res) {
  if (typeof WebAssembly.compileStreaming === 'function' &&
      (res.headers.get('content-type') || '').startsWith('application/wasm')) {
    try {
      return await WebAssembly.compileStreaming(res.clone());
    } catch {
      // Fall back to the buffered path below.
    }
  }
  return WebAssembly.compile(await res.arrayBuffer());
}

async function compileFrom(source) {
  if (source instanceof WebAssembly.Module) return source;
  if (isBytes(source)) return WebAssembly.compile(source);
  if (typeof Response !== 'undefined' && source instanceof Response) return compileResponse(source);
  let url = source;
  if (typeof url === 'string') {
    url = new URL(url, typeof location !== 'undefined' ? location.href : import.meta.url);
  }
  if (!(url instanceof URL)) {
    throw new TypeError('ssimulacra2 load(): expected a URL, URL string, bytes, Response or WebAssembly.Module');
  }
  if (url.protocol === 'file:') return WebAssembly.compile(await readFileUrl(url));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ssimulacra2 load(): fetching ${url} failed with HTTP ${res.status}`);
  return compileResponse(res);
}

function instantiate() {
  const e = new WebAssembly.Instance(wasmModule, {}).exports;
  for (const name of ['memory', 'emd_alloc', 'emd_free', 'emd_ssimulacra2']) {
    if (!(name in e)) throw new Error(`ssimulacra2: the module does not export ${name}`);
  }
  exports = e;
}

/**
 * Compile and instantiate the scorer; call once (per worker) before score().
 * @param {string|URL|ArrayBuffer|ArrayBufferView|Response|WebAssembly.Module} [urlOrBytes]
 *   Defaults to the best build for this runtime (bestVariant()) next to this module.
 * @returns {Promise<{score: typeof score, reset: typeof reset, variant: string|null}>}
 */
export async function load(urlOrBytes) {
  let source = urlOrBytes;
  let name = null;
  if (source == null) {
    name = bestVariant();
    source = variantUrl(name);
  }
  wasmModule = await compileFrom(source);
  variant = name;
  instantiate();
  return { score, reset, variant };
}

/** Name of the build load() picked ('relaxed' | 'simd' | 'nosimd'), or null if given explicitly. */
export function loadedVariant() {
  return variant;
}

/** True once load() has completed. */
export function isLoaded() {
  return wasmModule !== null;
}

/** Current size of the instance's WebAssembly memory in bytes (0 when there is no instance). */
export function memoryBytes() {
  return exports ? exports.memory.buffer.byteLength : 0;
}

/** Drop the instance and its memory; the next score() starts a fresh instance. */
export function reset() {
  exports = null;
}

/**
 * SSIMULACRA2 score of `dist` against `ref`.
 * @param {Uint8Array|Uint8ClampedArray} ref
 * @param {Uint8Array|Uint8ClampedArray} dist
 * @param {number} width
 * @param {number} height
 * @param {1|3|4} [channels=3]
 * @returns {number}
 */
export function score(ref, dist, width, height, channels = 3) {
  if (wasmModule === null) throw new Error('ssimulacra2: call load() before score()');
  for (const [name, buf] of [['ref', ref], ['dist', dist]]) {
    if (!ArrayBuffer.isView(buf) || buf.BYTES_PER_ELEMENT !== 1) {
      throw new TypeError(`ssimulacra2: ${name} must be a Uint8Array or Uint8ClampedArray`);
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 ||
      width > 0xffff || height > 0xffff) {
    throw new RangeError(`ssimulacra2: width and height must be integers in 8..65535, got ${width}x${height}`);
  }
  if (channels !== 1 && channels !== 3 && channels !== 4) {
    throw new RangeError(`ssimulacra2: channels must be 1, 3 or 4, got ${channels}`);
  }
  const len = width * height * channels;
  if (ref.byteLength !== len || dist.byteLength !== len) {
    throw new RangeError(`ssimulacra2: expected ${len} bytes per image (${width}x${height}x${channels}), ` +
      `got ref=${ref.byteLength} dist=${dist.byteLength}`);
  }

  if (exports === null) instantiate();
  const e = exports;
  let result;
  try {
    const pRef = e.emd_alloc(len);
    const pDist = pRef ? e.emd_alloc(len) : 0;
    if (!pRef || !pDist) throw new RangeError(`ssimulacra2: ${ERRORS.get(-1000003)}`);
    // Take the view after allocating: growing memory detaches earlier views.
    const heap = new Uint8Array(e.memory.buffer);
    heap.set(ref, pRef);
    heap.set(dist, pDist);
    result = e.emd_ssimulacra2(pRef, pDist, width, height, channels);
    e.emd_free(pDist, len);
    e.emd_free(pRef, len);
  } catch (err) {
    // A trap leaves the instance in an unknown state (and an allocation failure leaks
    // the input copies): start from a fresh instance next time.
    exports = null;
    if (err instanceof WebAssembly.RuntimeError) {
      throw new RangeError(`ssimulacra2: scoring trapped (${err.message}); image probably too large`);
    }
    throw err;
  }
  if (result <= -1000000) {
    const msg = `ssimulacra2: ${ERRORS.get(result) ?? `error ${result}`}`;
    throw result === -1000004 ? new Error(msg) : new RangeError(msg);
  }
  return result;
}

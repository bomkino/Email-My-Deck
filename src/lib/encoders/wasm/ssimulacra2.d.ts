export type Ssimulacra2Variant = 'relaxed' | 'simd' | 'nosimd'
export function load(urlOrBytes?: string | URL | ArrayBuffer | ArrayBufferView | Response | WebAssembly.Module): Promise<unknown>
export function bestVariant(): Ssimulacra2Variant
export function score(reference: Uint8Array | Uint8ClampedArray, distorted: Uint8Array | Uint8ClampedArray, width: number, height: number, channels?: 1 | 3 | 4): number
export function reset(): void
export function memoryBytes(): number

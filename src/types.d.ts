declare module '@wasm-zoo/ghostscript' {
  export function load(): Promise<{
    exec(args: string[], options: { files: Array<{ name: string; data: Uint8Array }>; dirs: string[]; outputs: string[] }): Promise<{ files: Array<{ name: string; data: Uint8Array }> }>
    dispose(): void
  }>
}

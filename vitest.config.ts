import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // Engine tests run real QPDF WebAssembly and a pure-JS JPEG codec.
    testTimeout: 60_000,
  },
})

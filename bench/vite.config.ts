import { defineConfig } from 'vite'

declare const process: { env: Record<string, string | undefined>; cwd(): string }

// Serves the encoder bench. BENCH_ALLOW lists extra folders (images, codec builds) the page may read via /@fs/.
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  server: {
    // Benches run for many minutes; editing src/ must not reload the page under them.
    hmr: false,
    watch: null,
    fs: { allow: [new URL('..', import.meta.url).pathname, ...(process.env.BENCH_ALLOW ?? '').split(':').filter(Boolean)] },
  },
  optimizeDeps: { exclude: ['@jsquash/jpeg', '@jsquash/resize', '@jsquash/oxipng', '@jsquash/png'] },
  worker: { format: 'es' },
})

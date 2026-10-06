import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

// EMD_BASE=/email-my-deck/ builds the copy that lives on pitch.dog.
// EMD_SOURCE_COMMIT pins the page's "exact code" link to the built commit.
const base = process.env.EMD_BASE || '/'
const commit = process.env.EMD_SOURCE_COMMIT || ''

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __EMD_SOURCE_URL__: JSON.stringify(commit ? `https://github.com/bomkino/Email-My-Deck/tree/${commit}` : ''),
  },
  optimizeDeps: {
    // Pre-bundle the worker's dependency when the dev server starts. Found
    // later, it makes Vite reload the page in the middle of the first job.
    include: ['@neslinesli93/qpdf-wasm'],
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})

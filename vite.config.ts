import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { renderSendGuide } from './src/guide/render.ts'

declare const process: { env: Record<string, string | undefined> }

// EMD_BASE=/email-my-deck/ builds the copy that lives on pitch.dog.
// EMD_SOURCE_COMMIT pins the page's "exact code" link to the built commit.
const base = process.env.EMD_BASE || '/'
const commit = process.env.EMD_SOURCE_COMMIT || ''

// The "Send a link instead" guide is written into the HTML at build time, so
// it reads fine without JavaScript. Its facts live in src/guide/services.ts;
// restart the dev server after changing them.
const GUIDE_MARK = '<!-- send-a-link guide: rendered from src/guide/services.ts -->'
function sendGuide(): Plugin {
  return {
    name: 'emd-send-guide',
    transformIndexHtml(html) {
      if (!html.includes(GUIDE_MARK)) throw new Error('index.html lost the send-a-link guide marker.')
      return html.replace(GUIDE_MARK, renderSendGuide())
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), sendGuide()],
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

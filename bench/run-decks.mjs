// Run the engine on decks with each codec kind and budget in Chromium; one JSON row per run.
// Usage: node bench/run-decks.mjs <out.jsonl> <codecs,comma> <budgetsMB,comma> <deck.pdf>...
// BENCH_SAVE=<dir> also writes each compressed deck there, as <deck>-<budget>-<codec>.pdf.
// BENCH_PORT picks the Vite port (default 5198), so two benches can run at once.
// Decks are streamed to the page straight from where they are (any file name, any size).
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const [outPath, codecList, budgetList, ...decks] = process.argv.slice(2)
const port = Number(process.env.BENCH_PORT || 5198)
const serveDecks = {
  name: 'bench-decks',
  // Ahead of Vite's own middleware, which would treat /__deck/0 as a module.
  configureServer(server) {
    server.middlewares.use('/__deck', (request, response) => {
      const deck = decks[Number(request.url.slice(1))]
      if (!deck) return void response.writeHead(404).end()
      response.writeHead(200, { 'content-type': 'application/pdf' })
      createReadStream(deck).pipe(response)
    })
  },
}
const server = await createServer({ configFile: new URL('./vite.config.ts', import.meta.url).pathname, plugins: [serveDecks], server: { port, strictPort: true }, logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
page.on('console', (message) => { if (message.type() === 'error') console.error('page:', message.text()) })
page.on('pageerror', (error) => console.error('pageerror:', error))
await page.goto(`http://localhost:${port}/decks/index.html`)
await page.waitForFunction(() => 'deckBench' in globalThis)
await writeFile(outPath, '')
for (const [index, deck] of decks.entries()) {
  for (const budgetMB of budgetList.split(',').map(Number)) {
    for (const codec of codecList.split(',')) {
      const save = process.env.BENCH_SAVE
      const { output, ...row } = await page.evaluate((options) => globalThis.deckBench.run(options), { url: `/__deck/${index}`, budget: Math.round(budgetMB * 1e6), codec, save: Boolean(save) })
      if (save && output) {
        await mkdir(save, { recursive: true })
        await writeFile(join(save, `${basename(deck, '.pdf')}-${budgetMB}-${codec}.pdf`), Buffer.from(output, 'base64'))
      }
      const line = { deck: basename(deck), budgetMB, codec, ...row }
      await appendFile(outPath, JSON.stringify(line) + '\n')
      console.log(basename(deck), budgetMB, codec, row.ok ? `${row.kind} ${(row.bytes / 1e6).toFixed(2)} MB rung=${row.rung} ${(row.ms / 1000).toFixed(1)}s` : row.error)
    }
  }
}
await browser.close()
await server.close()

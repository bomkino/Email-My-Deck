// Drive bench/encoders in Chromium and write one JSON row per encode.
// Usage: node bench/run-encoders.mjs <out.jsonl> <config.json> <image>...
// config.json: { longEdges, resizers, variants, repeat, scorerPath?, jpegli? } (scorerPath is an absolute file the page imports via /@fs/).
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

const [outPath, configPath, ...images] = process.argv.slice(2)
const config = JSON.parse(await readFile(configPath, 'utf8'))
const extra = [...images.map((file) => dirname(file)), config.scorerPath && dirname(config.scorerPath)].filter(Boolean)
process.env.BENCH_ALLOW = [...new Set(extra)].join(':')
const server = await createServer({ configFile: new URL('./vite.config.ts', import.meta.url).pathname, server: { port: 5199, strictPort: true }, logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
page.on('console', (message) => { if (message.type() === 'error') console.error('page:', message.text()) })
page.on('pageerror', (error) => console.error('pageerror:', error))
await page.goto('http://localhost:5199/encoders/index.html')
await page.waitForFunction(() => 'bench' in globalThis)
const fsUrl = (file) => (file ? `/@fs${file}` : undefined)
console.log('setup', await page.evaluate((options) => globalThis.bench.setup(options), { scorerUrl: fsUrl(config.scorerPath), jpegli: Boolean(config.jpegli) }))
await writeFile(outPath, '')
for (const file of images) {
  const started = Date.now()
  const rows = await page.evaluate((options) => globalThis.bench.run(options), { url: fsUrl(file), name: basename(file), longEdges: config.longEdges, resizers: config.resizers, variants: config.variants, repeat: config.repeat })
  await appendFile(outPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
  console.log(basename(file), rows.length, 'rows', ((Date.now() - started) / 1000).toFixed(1), 's')
}
await browser.close()
await server.close()

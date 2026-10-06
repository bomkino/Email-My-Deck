// Calibrate ladder targets (canvas worst-tile scores) and check the jpegli search, in Chromium.
// Usage: node bench/calibrate.mjs <out.jsonl> <config.json> <image>...
// config.json: { rungs: [[longEdge, quality]...], targets?: {quality: score}, guesses?: {quality: distance}, wholeUpTo?, scorerPath }
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

const [outPath, configPath, ...images] = process.argv.slice(2)
const config = JSON.parse(await readFile(configPath, 'utf8'))
process.env.BENCH_ALLOW = [...new Set([...images.map((file) => dirname(file)), dirname(config.scorerPath)])].join(':')
const server = await createServer({ configFile: new URL('./vite.config.ts', import.meta.url).pathname, server: { port: 5196, strictPort: true }, logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
page.on('pageerror', (error) => console.error('pageerror:', error))
await page.goto('http://localhost:5196/encoders/index.html')
await page.waitForFunction(() => 'calibrate' in globalThis)
console.log('setup', await page.evaluate((options) => globalThis.bench.setup(options), { scorerUrl: `/@fs${config.scorerPath}`, jpegli: true }))
await writeFile(outPath, '')
for (const file of images) {
  const started = Date.now()
  const rows = await page.evaluate((options) => globalThis.calibrate(options), { url: `/@fs${file}`, name: basename(file), rungs: config.rungs, targets: config.targets, guesses: config.guesses, wholeUpTo: config.wholeUpTo })
  await appendFile(outPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
  console.log(basename(file), ((Date.now() - started) / 1000).toFixed(1), 's')
}
await browser.close()
await server.close()

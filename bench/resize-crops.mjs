// Save crops of one image resized by canvas and by WASM resizers, to compare by eye.
// Usage: node bench/resize-crops.mjs <outDir> "<image>|<longEdge>|x,y,w,h" ...
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'
const [outDir, ...jobs] = process.argv.slice(2) // job: file|edge|x,y,w,h
process.env.BENCH_ALLOW = [...new Set(jobs.map((job) => job.split('|')[0].replace(/\/[^/]*$/, '')))].join(':')
const server = await createServer({ configFile: new URL('./vite.config.ts', import.meta.url).pathname, server: { port: 5197, strictPort: true }, logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.goto('http://localhost:5197/encoders/index.html')
await page.waitForFunction(() => 'resizeCrop' in globalThis)
for (const job of jobs) {
  const [file, edge, crop] = job.split('|')
  for (const resizer of ['canvas', 'lanczos3', 'lanczos3:linear', 'mitchell:linear']) {
    const b64 = await page.evaluate(([u, e, r, c]) => globalThis.resizeCrop(u, e, r, c), [`/@fs${file}`, Number(edge), resizer, crop.split(',').map(Number)])
    writeFileSync(`${outDir}/${file.split('/').pop()}-${edge}-${resizer.replace(':', '-')}.png`, Buffer.from(b64, 'base64'))
  }
}
await browser.close(); await server.close()

import { chromium } from 'playwright-core'
import { resolve } from 'node:path'

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
const requests = []
page.on('request', (request) => requests.push(request.url()))
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 10000 })
await page.getByText('Strict 20 MB message limits').click()
await page.locator('input[type=file]').setInputFiles(resolve('corpus/photo-deck.pdf'))
await page.waitForSelector('text=Working locally', { timeout: 10000 })
await page.waitForFunction(() => {
  const text = document.body.innerText
  return text.includes('Your email version is ready.') || text.includes('This deck needs two emails.') || text.includes('We couldn’t make a safe result.')
}, null, { timeout: 120000 })
await page.screenshot({ path: 'result-desktop.png', fullPage: true })

const unexpected = requests.filter((url) => !url.startsWith('http://127.0.0.1:5173') && !url.startsWith('ws://127.0.0.1:5173'))
if (unexpected.length) throw new Error(`Unexpected network requests: ${unexpected.join(', ')}`)
const visible = (await page.locator('body').innerText()).toLowerCase()
if (!visible.includes('verified on this device') && !visible.includes('quality floor protected')) {
  throw new Error('The processing flow did not reach a verified result or measured split state.')
}
console.log('Browser smoke passed; all requests stayed on the local origin.')
await browser.close()

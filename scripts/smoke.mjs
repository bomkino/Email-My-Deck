import { chromium } from 'playwright-core'
import { resolve } from 'node:path'

// SMOKE_URL can point at the pitch.dog build (for example a local copy of
// apps/main-site serving /email-my-deck/). CHROMIUM_PATH overrides the browser.
const target = new URL(process.env.SMOKE_URL || 'http://127.0.0.1:5173/')
const deck = 'photo-deck'

// The pitch.dog page counts visits with Google Analytics, like the rest of
// pitch.dog, and on pitch.dog itself Cloudflare adds its cookieless Web
// Analytics beacon to every page. Those hosts are the only ones allowed besides
// the page's own, and the file name must reach none of them.
const analyticsHosts = [/^www\.googletagmanager\.com$/, /^([a-z0-9-]+\.)*google-analytics\.com$/, /^analytics\.google\.com$/, /^(static\.)?cloudflareinsights\.com$/]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
const requests = []
page.on('request', (request) => requests.push({ url: request.url(), body: request.postData() || '' }))
await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 10000 })
await page.locator('#emd-root').getByRole('button', { name: 'Change' }).click()
await page.locator('#emd-root').getByText('Strict or work mailboxes').click()
await page.locator('input[type=file]').setInputFiles(resolve(`corpus/${deck}.pdf`))
await page.waitForSelector('text=Making it fit', { timeout: 10000 })
await page.waitForFunction(() => {
  const text = document.body.innerText
  return text.includes('Ready to attach.') || text.includes('it already fits.') || text.includes('This one goes in') || text.includes('We couldn’t make a version we’d send.')
}, null, { timeout: 120000 })
await page.screenshot({ path: 'result-desktop.png', fullPage: true })

const unexpected = requests.filter(({ url }) => {
  const { origin, hostname, protocol } = new URL(url)
  if (protocol === 'data:' || protocol === 'blob:') return false
  if (origin === target.origin || origin === target.origin.replace(/^http/, 'ws')) return false
  return !analyticsHosts.some((host) => host.test(hostname))
})
if (unexpected.length) throw new Error(`Unexpected network requests: ${unexpected.map(({ url }) => url).join(', ')}`)
const leaked = requests.filter(({ url, body }) => decodeURIComponent(url + body).toLowerCase().includes(deck))
if (leaked.length) throw new Error(`A request mentioned the file name: ${leaked.map(({ url }) => url).join(', ')}`)
const visible = (await page.locator('#emd-root').innerText()).toLowerCase()
if (!visible.includes('checked on this device') && !visible.includes('split, not smudged')) {
  throw new Error('The processing flow did not reach a checked result or a measured split.')
}
console.log('Browser smoke passed; only the page and analytics hosts were contacted, and none of them saw the file name.')
await browser.close()

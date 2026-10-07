import { chromium } from 'playwright-core'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
// The mailbox choice sits out in the open: four cards, Most mailboxes already picked.
const tool = page.locator('#emd-root')
const mailbox = (name) => tool.getByRole('radio', { name })
await mailbox(/Most mailboxes/).waitFor({ state: 'attached', timeout: 10000 })
if (!(await mailbox(/Most mailboxes/).isChecked())) throw new Error('Most mailboxes should be picked to start with.')
await tool.getByText('Strict or work mailboxes').click()
if (!(await mailbox(/Strict or work mailboxes/).isChecked())) throw new Error('Clicking a mailbox card did not pick it.')
await page.locator('input[type=file]').setInputFiles(resolve(`corpus/${deck}.pdf`))
await page.waitForSelector('text=Making it fit', { timeout: 10000 })
await page.waitForFunction(() => {
  const text = document.body.innerText
  return text.includes('Ready to attach.') || text.includes('it already fits.') || text.includes('We can’t get this one into a single email.') || text.includes('We couldn’t make a version we’d send.')
}, null, { timeout: 120000 })
await page.screenshot({ path: 'result-desktop.png', fullPage: true })

const visible = (await page.locator('#emd-root').innerText()).toLowerCase()
if (!visible.includes('checked on this device') && !visible.includes('too big for one email')) {
  throw new Error('The processing flow did not reach a checked result or a measured split.')
}

// On a phone, nothing in the tool may be wider than the screen, whatever the
// deck is called. A long file name once pushed the ready card off the right
// edge of a 412 px phone. This pass uses a 320 px screen and a long name.
const fitsScreen = async (phone, moment) => {
  const wide = await phone.evaluate(() => {
    const width = document.documentElement.clientWidth
    const found = document.documentElement.scrollWidth > width ? [`the page itself (${document.documentElement.scrollWidth} px)`] : []
    for (const element of document.querySelectorAll('#emd-root *')) {
      const box = element.getBoundingClientRect()
      if (box.width && box.height && (box.right > width + 1 || box.left < -1)) found.push(`${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''} (${Math.round(box.left)} to ${Math.round(box.right)} px)`)
    }
    return found
  })
  if (wide.length) throw new Error(`On a 320 px phone, ${moment}, these are wider than the screen: ${wide.slice(0, 6).join(', ')}`)
}
const longName = join(await mkdtemp(join(tmpdir(), 'emd-smoke-')), `[Client Name] [Pitch Deck] [Studio] Exploration v1 FINAL final ${deck}.pdf`)
await copyFile(resolve(`corpus/${deck}.pdf`), longName)
const phone = await browser.newPage({ viewport: { width: 320, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
phone.on('request', (request) => requests.push({ url: request.url(), body: request.postData() || '' }))
await phone.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 10000 })
await phone.locator('#emd-root input[type=file]').waitFor({ state: 'attached', timeout: 10000 })
await fitsScreen(phone, 'before a deck is added')
await phone.locator('input[type=file]').setInputFiles(longName)
await phone.waitForSelector('text=Making it fit', { timeout: 10000 })
await fitsScreen(phone, 'while it works')
await phone.waitForFunction(() => /Ready to attach\.|it already fits\.|single email\.|we’d send\./.test(document.querySelector('#emd-root').innerText), null, { timeout: 120000 })
await phone.waitForTimeout(1200)
await fitsScreen(phone, 'on the result')
await phone.screenshot({ path: 'result-phone.png', fullPage: true })

// Both passes: only the page and analytics hosts, and the file name reaches none of them.
const unexpected = requests.filter(({ url }) => {
  const { origin, hostname, protocol } = new URL(url)
  if (protocol === 'data:' || protocol === 'blob:') return false
  if (origin === target.origin || origin === target.origin.replace(/^http/, 'ws')) return false
  return !analyticsHosts.some((host) => host.test(hostname))
})
if (unexpected.length) throw new Error(`Unexpected network requests: ${unexpected.map(({ url }) => url).join(', ')}`)
const leaked = requests.filter(({ url, body }) => decodeURIComponent(url + body).toLowerCase().includes(deck))
if (leaked.length) throw new Error(`A request mentioned the file name: ${leaked.map(({ url }) => url).join(', ')}`)

console.log('Browser smoke passed; only the page and analytics hosts were contacted, and none of them saw the file name. On a 320 px phone the tool stayed inside the screen.')
await browser.close()

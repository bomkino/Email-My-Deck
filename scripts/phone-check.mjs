import { chromium } from 'playwright-core'
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Phones: nothing on the page may be wider than the screen, in any state of
// the tool, whatever the deck is called. A long file name once pushed the
// ready card off the right edge of a 412 px phone, and only a person with a
// real deck saw it. This walks every state the tool can show, and at each one
// looks at the page at 320, 360, 390 and 430 px. It fails if the page scrolls
// sideways or anything visible reaches past either edge of the screen.
//
// PHONE_URL (or SMOKE_URL) points it at another build, for example a local
// copy of apps/main-site, a pull request preview or https://pitch.dog/email-my-deck/.
// CHROMIUM_PATH overrides the browser. Screenshots of anything that fails go
// to phone-check/.
const target = new URL(process.env.PHONE_URL || process.env.SMOKE_URL || 'http://127.0.0.1:5173/')
const widths = [320, 360, 390, 430]
const wait = 300_000

// Two kinds of long name: one with spaces and brackets, like a design tool's
// export, and one with no break anywhere.
const folder = await mkdtemp(join(tmpdir(), 'emd-phones-'))
const named = async (deck, name) => {
  const path = join(folder, name)
  await copyFile(resolve(`corpus/${deck}.pdf`), path)
  return path
}
const fits = await named('photo-deck', '[Client Name] [Pitch Deck] [Studio] Exploration v1 FINAL final (for the board).pdf')
const tooBig = await named('email-pressure-test', 'ClientName_PitchDeck_Studio_Exploration_v1_FINAL_final_for_the_board_2026-10-07_email-pressure-test.pdf')
const refused = await named('restricted-deck', 'ClientName_PitchDeck_Studio_Exploration_v1_FINAL_final_for_the_board_locked_by_legal.pdf')
const notPdf = join(folder, 'ClientName_PitchDeck_Studio_Exploration_v1_FINAL_final_for_the_board_actually_a_text_file.pdf')
await writeFile(notPdf, 'This is not a PDF.\n'.repeat(200))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const failures = []
let looks = 0

async function look(page, moment) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 })
    await page.waitForTimeout(250)
    const wide = await page.evaluate(() => {
      const screen = document.documentElement.clientWidth
      const found = document.documentElement.scrollWidth > screen ? [`the page scrolls sideways to ${document.documentElement.scrollWidth} px`] : []
      for (const element of document.body.querySelectorAll('*')) {
        const box = element.getBoundingClientRect()
        if (!box.width || !box.height || (box.right <= screen + 1 && box.left >= -1)) continue
        // Not on screen: the closed menu, screen-reader text, hidden decoration.
        if (element.closest('[aria-hidden="true"], [inert], .sr-only') || getComputedStyle(element).visibility === 'hidden') continue
        // Cards in a row that scrolls sideways on purpose (the link guide's picks) may run past the edge; the row itself may not.
        let scroller = false
        for (let parent = element.parentElement; parent && !scroller; parent = parent.parentElement) scroller = /^(auto|scroll)$/.test(getComputedStyle(parent).overflowX)
        if (scroller) continue
        found.push(`${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.${(element.getAttribute('class') ?? '').split(' ').filter(Boolean).join('.')} (${Math.round(box.left)} to ${Math.round(box.right)} px)`)
      }
      return found
    })
    looks += 1
    if (wide.length) {
      failures.push(`${moment}, ${width} px: ${wide.slice(0, 6).join('; ')}${wide.length > 6 ? `; and ${wide.length - 6} more` : ''}`)
      await mkdir('phone-check', { recursive: true })
      await page.screenshot({ path: `phone-check/${moment.replace(/\W+/g, '-')}-${width}.png`, fullPage: true })
    }
  }
}

async function open() {
  const page = await browser.newPage({ viewport: { width: widths[0], height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.locator('#emd-root input[type=file]').waitFor({ state: 'attached', timeout: 15000 })
  return page
}
const stage = (page, ...names) => page.waitForSelector(names.map((name) => `.emd[data-stage="${name}"]`).join(', '), { timeout: wait })
const limit = async (page, megabytes) => {
  await page.locator('#emd-root').getByText('I know my limit').click()
  const input = page.locator('#emd-custom-mb')
  await input.fill(String(megabytes))
  await input.blur()
}

// Before a deck: the whole page, then the limit field open.
let page = await open()
await look(page, 'the page before a deck')
await limit(page, 15)
await look(page, 'the limit field open')
await page.close()

// A deck that fits: working, then ready.
page = await open()
await page.locator('input[type=file]').setInputFiles(fits)
await stage(page, 'reading', 'compressing')
await look(page, 'working')
await stage(page, 'ready')
await page.waitForTimeout(1200)
await look(page, 'ready')
await page.close()

// A deck that can't fit one email: the three ways, a split, the parts, back
// to the ways, then a flatten and what comes of it.
page = await open()
await limit(page, 15)
await page.locator('input[type=file]').setInputFiles(tooBig)
await stage(page, 'cant-fit')
await look(page, 'can’t fit')
await page.getByRole('button', { name: /Split it (here|for me)/ }).first().click()
await stage(page, 'splitting', 'split')
await look(page, 'splitting')
await stage(page, 'split')
await page.waitForTimeout(1200)
await look(page, 'the parts')
await page.getByRole('button', { name: 'Change where it splits' }).click()
await stage(page, 'cant-fit')
await page.getByRole('button', { name: 'Flatten it and try' }).click()
await stage(page, 'flattening')
await look(page, 'flattening')
await stage(page, 'ready', 'cant-fit')
await page.waitForTimeout(1200)
await look(page, 'after flattening')
await page.close()

// Decks the tool turns away.
for (const [file, moment] of [[refused, 'a locked deck refused'], [notPdf, 'not a PDF']]) {
  page = await open()
  await page.locator('input[type=file]').setInputFiles(file)
  await stage(page, 'error')
  await page.waitForTimeout(800)
  await look(page, moment)
  await page.close()
}

await browser.close()
if (failures.length) {
  console.error(`On a phone, these reach past the edge of the screen:\n- ${failures.join('\n- ')}\nScreenshots are in phone-check/.`)
  process.exit(1)
}
console.log(`Phone check passed: ${looks} looks, every state at ${widths.join(', ')} px with long file names, and nothing past the edge of the screen.`)

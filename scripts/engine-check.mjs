// Runs the built engine (dist/) in Chromium against the synthetic corpus,
// served with the site's own _headers, and checks what each deck should get.
// Usage: npm run build && npm run corpus && node scripts/engine-check.mjs
// CHROMIUM_PATH picks the browser.
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { serveDist } from './serve-dist.mjs'

const MB = 1_000_000
const MIB = 1024 * 1024
const BUDGET = { 'common-25': 17 * MIB, 'strict-20': 13.5 * MIB }
// Same formula as getTargetProfile('custom'): the message limit less the body reserve, over base64's growth.
const customBudget = (messageMB) => Math.floor((messageMB * MB - 512 * 1024) / 1.3684)

const cases = [
  { deck: 'vector-deck.pdf', profile: 'common-25', expect: 'original' },
  { deck: 'photo-deck.pdf', profile: 'strict-20', expect: 'fits' },
  { deck: 'shared-resources-deck.pdf', profile: 'strict-20', expect: 'fits' },
  { deck: 'design-tool-deck.pdf', profile: 'common-25', expect: 'fits' },
  // The best encoders fit this deck under strict-20 at the smallest size, so a tighter limit forces the split.
  { deck: 'email-pressure-test.pdf', profile: 'custom', customMB: 15, autoSplit: true, expect: 'split' },
  { deck: 'email-pressure-test.pdf', profile: 'custom', customMB: 15, autoSplit: false, expect: 'needs-split' },
  // The nuke: every page becomes one picture.
  { deck: 'email-pressure-test.pdf', profile: 'strict-20', mode: 'flatten', expect: 'flattened' },
  { deck: 'design-tool-deck.pdf', profile: 'strict-20', mode: 'flatten', expect: 'flattened' },
  { deck: 'forms-deck.pdf', profile: 'common-25', expect: 'error:protected:forms' },
  { deck: 'restricted-deck.pdf', profile: 'common-25', expect: 'error:restricted' },
]

const browserPath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync) || chromium.executablePath()
const workerName = (await readdir('dist/assets')).find((name) => /^pdf\.worker-.*\.js$/.test(name))
if (!workerName) throw new Error('No built PDF worker in dist/assets. Run npm run build first.')
const appCode = (await Promise.all((await readdir('dist/assets')).filter((name) => name.endsWith('.js')).map((name) => readFile(join('dist/assets', name), 'utf8')))).join('\n')
if (!appCode.includes(workerName)) throw new Error(`The built page does not load ${workerName}.`)

const extra = new Map(cases.map(({ deck }) => [`/__corpus/${deck}`, join('corpus', deck)]))
// A blank page on the same origin, under the site's own headers and CSP, so only the engine is tested.
extra.set('/__engine-check.html', { body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Engine check</title>' })
const server = await serveDist('dist', 0, '127.0.0.1', extra)
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const failures = []

for (const testCase of cases) {
  const page = await browser.newPage()
  const requests = []
  const problems = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`) })
  await page.goto(`${origin}/__engine-check.html`, { waitUntil: 'load' })
  const run = await page.evaluate(async ({ workerUrl, deck, profile, customMB, autoSplit, mode }) => {
    const bytes = new Uint8Array(await (await fetch(`/__corpus/${deck}`)).arrayBuffer())
    const size = bytes.byteLength
    const worker = new Worker(workerUrl, { type: 'module' })
    const started = performance.now()
    const progress = []
    return new Promise((done) => {
      const timer = setTimeout(() => done({ size, timeout: true, progress }), 120_000)
      worker.onerror = (event) => { clearTimeout(timer); done({ size, workerError: event.message, progress }) }
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          progress.push({ stage: data.stage, fraction: data.fraction, label: data.label })
          return
        }
        clearTimeout(timer)
        worker.terminate()
        const ms = Math.round(performance.now() - started)
        if (data.type === 'error') return done({ size, ms, progress, error: { code: data.code, reason: data.reason, message: data.message } })
        const outcome = data.outcome
        done({
          size,
          ms,
          progress,
          type: data.type,
          outcome: outcome && { engine: outcome.candidate.engine, notes: outcome.candidate.notes, bytes: outcome.candidate.bytes.byteLength, fits: outcome.fits, targetBytes: outcome.targetBytes, pages: outcome.inspection.pages, verified: outcome.verified, receipt: outcome.receipt, planPages: outcome.splitPlan?.pageBytes?.length },
          parts: data.parts?.map((part) => ({ bytes: part.bytes.byteLength, startPage: part.startPage, endPage: part.endPage, pages: part.pages })),
        })
      }
      worker.postMessage({ type: 'compress', jobId: 1, bytes, profileId: profile, customMessageMB: customMB, autoSplit, mode }, [bytes.buffer])
    })
  }, { workerUrl: `/assets/${workerName}`, ...testCase })

  const label = `${testCase.deck} (${testCase.profile}${testCase.customMB ? ` ${testCase.customMB} MB` : ''}${testCase.autoSplit ? ', auto split' : ''}${testCase.mode ? `, ${testCase.mode}` : ''})`
  const fail = (reason) => failures.push(`${label}: ${reason}`)
  const budget = testCase.profile === 'custom' ? customBudget(testCase.customMB) : BUDGET[testCase.profile]
  const offOrigin = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:'))
  if (offOrigin.length) fail(`requests left the origin: ${offOrigin.join(', ')}`)
  if (run.timeout) fail('no answer within 120 s')
  if (run.workerError) fail(`worker crashed: ${run.workerError}`)
  const fractions = run.progress.map((event) => event.fraction)
  if (fractions.some((value, index) => index > 0 && value < fractions[index - 1])) fail('progress went backwards')
  if (fractions.some((value) => !(value >= 0 && value <= 1))) fail('progress outside 0..1')
  if (run.progress.some((event) => !['inspect', 'tidy', 'photos', 'resize', 'verify', 'split', 'flatten'].includes(event.stage))) fail('unknown progress stage')

  const [kind, ...detail] = testCase.expect.split(':')
  if (kind === 'error') {
    const got = [run.error?.code, run.error?.reason].filter(Boolean).join(':')
    if (got !== detail.join(':')) fail(`expected error ${detail.join(':')}, got ${got || run.type}`)
  } else {
    if (run.error) fail(`unexpected error ${run.error.code}: ${run.error.message}`)
    if (problems.length) fail(problems.join('; '))
    const outcome = run.outcome
    if (kind === 'original' && !(run.type === 'compress-result' && outcome?.engine === 'original' && outcome.bytes === run.size)) fail('the original was not returned untouched')
    if (kind === 'fits') {
      if (run.type !== 'compress-result' || !outcome?.fits || outcome.bytes > budget) fail(`expected one file within ${budget} bytes, got ${run.type} ${outcome?.bytes}`)
      if (!outcome?.verified || outcome.receipt.checks.join() !== 'page-count,page-size,structure') fail('result was not verified')
      if (!requests.some((url) => /image\.worker-.*\.js$/.test(url))) fail('the image worker pool was not used')
    }
    if (kind === 'flattened') {
      if (run.type !== 'compress-result' || outcome?.engine !== 'flattened') fail(`expected a flattened result, got ${run.type} ${outcome?.engine}`)
      if (!outcome?.fits || outcome.bytes > budget) fail(`expected the flattened deck within ${budget} bytes, got ${outcome?.bytes}`)
      if (!outcome?.verified || outcome.receipt.checks.join() !== 'page-count,page-size,structure') fail('result was not verified')
      if (outcome?.receipt?.flatten?.pages !== outcome?.pages) fail('not every page was flattened')
      if (!run.progress.some((event) => event.stage === 'flatten')) fail('no flatten progress')
      if (!requests.some((url) => /pdf\.worker\.min-.*\.mjs$/.test(url))) fail('PDF.js did not run on its own worker')
      if (!requests.some((url) => /flatpage\.worker-.*\.js$/.test(url))) fail('slides were not re-saved on the flatten workers')
    }
    if (kind === 'needs-split' && (run.type !== 'compress-result' || outcome?.fits !== false)) fail('expected a compress result that still needs a split')
    if (kind === 'needs-split' && outcome?.planPages !== outcome?.pages) fail('expected a split plan with a weight for every page')
    if (kind === 'split') {
      const parts = run.parts ?? []
      if (run.type !== 'split-result' || parts.length < 2) fail(`expected several parts, got ${run.type} with ${parts.length}`)
      if (parts.some((part) => part.bytes > budget)) fail('a part is over budget')
      let next = 1
      for (const part of parts) {
        if (part.startPage !== next || part.pages !== part.endPage - part.startPage + 1) fail('parts are not consecutive')
        next = part.endPage + 1
      }
      if (next - 1 !== outcome?.pages) fail('parts do not cover every page')
    }
  }
  const result = run.error ? `${run.error.code}${run.error.reason ? `:${run.error.reason}` : ''}` : run.parts ? `${run.parts.length} parts` : `${((run.outcome?.bytes ?? 0) / MB).toFixed(2)} MB${run.outcome?.receipt?.longEdgePx ? ` at ${run.outcome.receipt.flatten ? 'least ' : ''}${run.outcome.receipt.longEdgePx} px` : ''}`
  console.log(`${label}: ${(run.size / MB).toFixed(1)} MB → ${result} in ${((run.ms ?? 0) / 1000).toFixed(1)} s, ${run.progress.length} progress events`)
  await page.close()
}

await browser.close()
server.close()
if (failures.length) {
  console.error(`\nEngine check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\nEngine check passed: every deck got the expected result, progress only moved forward, and nothing left the origin.')

import type { ImageCodec, CodecOutput, CodecSource } from './codec'
import { collectFormRefs, placementsForPage, type Placement } from './content'
import { EngineError, MESSAGES, protectedError } from './errors'
import { inspectionFromJson, inspectWithQpdf, INSPECT_ARGS, looksLikePdf, type ImageRecord, type Inspection } from './inspect'
import { readJpegInfo } from './jpeg'
import { acceptOutput, calibrate, chooseRungs, emptyCalibration, planImage, predictImageBytes, RUNGS, sameTarget, type ImagePlan, type ImageTarget, type Rung } from './ladder'
import { refNumber, type JsonDict, type QpdfJsonDocument } from './pdfjson'
import { ProgressReporter, STAGE_LABELS, type ProgressEvent } from './progress'
import { QpdfSession, type QpdfLoader } from './qpdf'

export type EngineDeps = {
  qpdf: QpdfLoader
  /** Null when this browser cannot decode and re-encode images. */
  codec: ImageCodec | null
  onProgress?: (event: ProgressEvent) => void
  now?: () => number
}

export type ImageStats = { total: number; resaved: number; resized: number; untouched: number }

export type Attempt = { step: 'original' | 'lossless' | Rung['id']; bytes: number; fits: boolean; ms: number; predicted?: boolean }

export type EngineResult = {
  /** original: untouched; lossless: structure only; images: images rewritten; split-needed: nothing fits, `bytes` is the version to split. */
  kind: 'original' | 'lossless' | 'images' | 'split-needed'
  bytes: Uint8Array
  rung: Rung | null
  pageCount: number
  pageSizes: Array<[number, number]>
  images: ImageStats
  attempts: Attempt[]
  /** What was verified on the returned bytes. */
  checks: string[]
  splitReason?: 'quality-floor' | 'browser-cannot-resize'
  elapsedMs: number
  /** Session holding `bytes` at `path`, so an automatic split can reuse it. */
  session?: QpdfSession
  path?: string
}

/** Lossless rewrite: object streams, compressed streams, recompressed Flate. Nothing visible changes. */
export const LOSSLESS_ARGS = ['--object-streams=generate', '--compress-streams=y', '--recompress-flate']
/** The same without recompressing Flate, which costs seconds per 10 MB and usually saves little. */
const REWRITE_ARGS = LOSSLESS_ARGS.filter((arg) => arg !== '--recompress-flate')

/**
 * Same input, same output bytes. QPDF cannot derive a deterministic ID for an
 * encrypted file, which keeps its own encryption (and gets a fresh ID) instead.
 */
export function idArgs(encrypted: boolean): string[] {
  return encrypted ? [] : ['--deterministic-id']
}

const INPUT = '/work/in.pdf'
const EXTRACT_BATCH_BYTES = 24 * 1024 * 1024
const CALIBRATION_IMAGES = 3
const CALIBRATION_SHARE = 0.15
const CALIBRATION_MAX_IMAGES = 8
const PAGE_TOLERANCE = 0.5
const HEARTBEAT_MS = 400
/** Rough codec speed, used only to keep the bar moving while a big image is in flight. */
const PIXELS_PER_MS = 25_000
/** Decoded pixels allowed in flight at once (about 4 bytes each, often twice), so phones are not run out of memory. */
const MAX_PIXELS_IN_FLIGHT = 64_000_000

function emptyStats(total = 0): ImageStats {
  return { total, resaved: 0, resized: 0, untouched: total }
}

type StoredOutput = { path: string; bytes: number; target: ImageTarget }

/**
 * Make the highest-fidelity version of `input` that fits `budget` bytes.
 *
 * Order: untouched original, then a lossless rewrite, then the image ladder
 * (each rung starts from the untouched original). When even the floor rung
 * does not fit, the result is `split-needed` and carries the version to split.
 */
export async function compressDocument(input: Uint8Array, budget: number, deps: EngineDeps, options: { startFraction?: number; keepSession?: boolean } = {}): Promise<EngineResult> {
  const now = deps.now ?? (() => performance.now())
  const started = now()
  const progress = new ProgressReporter(deps.onProgress ?? (() => {}), options.startFraction ?? 0, now)
  const attempts: Attempt[] = []
  progress.enter('inspect')
  if (!looksLikePdf(input)) throw new EngineError('not-pdf', MESSAGES.notPdf)

  const original = (inspection: Inspection | null): EngineResult => ({
    kind: 'original',
    bytes: input,
    rung: null,
    pageCount: inspection?.pageCount ?? 0,
    pageSizes: inspection?.pages.map((page) => [page.width, page.height]) ?? [],
    images: emptyStats(inspection?.images.length ?? 0),
    attempts: [{ step: 'original', bytes: input.byteLength, fits: true, ms: 0 }],
    checks: ['unchanged'],
    elapsedMs: now() - started,
  })

  // A file that already fits is returned byte for byte; QPDF only reads a copy to count its pages.
  if (input.byteLength <= budget) {
    try {
      const probe = await QpdfSession.create(deps.qpdf)
      probe.writeFile(INPUT, input.slice(), true)
      return original(inspectWithQpdf(probe, INPUT))
    } catch {
      return original(null)
    }
  }
  attempts.push({ step: 'original', bytes: input.byteLength, fits: false, ms: 0 })

  const session = await QpdfSession.create(deps.qpdf)
  // The engine's in-memory filesystem takes ownership of the bytes; `input` is not used after this.
  const originalBytes = input.byteLength
  session.writeFile(INPUT, input, true)
  const inspection = inspectWithQpdf(session, INPUT)
  progress.update(1)

  if (inspection.encrypted && inspection.restricted) throw new EngineError('restricted', MESSAGES.restricted)
  if (inspection.protectedReason) throw protectedError(inspection.protectedReason)

  const keep = (result: Omit<EngineResult, 'session' | 'path'>, path: string): EngineResult => {
    if (options.keepSession) return { ...result, session, path }
    return result
  }

  const eligible = inspection.images.filter((image) => image.kind)
  const allImages = inspection.images.length

  // 1. Lossless. Worth running only when non-JPEG data could shrink enough to fit.
  progress.enter('tidy')
  let tidyBytes: number | null = null
  // Recompressing Flate costs seconds per 10 MB, so it is skipped when it cannot plausibly reach the budget.
  if (!deps.codec || eligible.length === 0 || originalBytes - losslessSavingGuess(inspection, originalBytes) <= budget) {
    const tidyStarted = now()
    session.runOk([...idArgs(inspection.encrypted), ...LOSSLESS_ARGS, '--progress', INPUT, '/work/tidy.pdf'], (line) => {
      const match = /write progress: (\d+)%/.exec(line)
      if (match) progress.update(Number(match[1]) / 100)
    }, 'engine')
    tidyBytes = session.size('/work/tidy.pdf')
    attempts.push({ step: 'lossless', bytes: tidyBytes, fits: tidyBytes <= budget, ms: now() - tidyStarted })
    if (tidyBytes <= budget) {
      progress.enter('verify')
      const checks = verifyCandidate(session, '/work/tidy.pdf', inspection)
      progress.update(1)
      return keep({
        kind: 'lossless',
        bytes: session.readFile('/work/tidy.pdf'),
        rung: null,
        pageCount: inspection.pageCount,
        pageSizes: inspection.pages.map((page) => [page.width, page.height]),
        images: emptyStats(allImages),
        attempts,
        checks,
        elapsedMs: now() - started,
      }, '/work/tidy.pdf')
    }
  }
  progress.update(1)

  // Without a codec or rewritable images, the lightest lossless version is what gets split.
  if (!deps.codec || eligible.length === 0) {
    const path = tidyBytes !== null && tidyBytes < originalBytes ? '/work/tidy.pdf' : INPUT
    return keep({
      kind: 'split-needed',
      bytes: session.readFile(path),
      rung: null,
      pageCount: inspection.pageCount,
      pageSizes: inspection.pages.map((page) => [page.width, page.height]),
      images: emptyStats(allImages),
      attempts,
      checks: path === INPUT ? ['unchanged'] : verifyCandidate(session, path, inspection),
      splitReason: deps.codec ? 'quality-floor' : 'browser-cannot-resize',
      elapsedMs: now() - started,
    }, path)
  }

  // 2. The image ladder. Recompressing Flate again is only worth its time if the lossless pass showed it pays.
  const rewriteArgs = [...idArgs(inspection.encrypted), ...(tidyBytes !== null && tidyBytes < originalBytes * 0.98 ? LOSSLESS_ARGS : REWRITE_ARGS)]
  progress.enter('photos')
  const placements = findPlacements(session, inspection)
  const plans = eligible
    .map((image) => planImage(image, placements.get(image.ref), inspection.pages))
    .sort((a, b) => a.firstPage - b.firstPage || refNumber(a.image.ref) - refNumber(b.image.ref))
  const baseBytes = (tidyBytes ?? originalBytes) - plans.reduce((sum, plan) => sum + plan.image.bytes, 0)
  const outputs = new Map<string, Map<number, StoredOutput>>()
  const calibration = emptyCalibration()
  const totalPixels = plans.reduce((sum, plan) => sum + plan.pixels, 0) || 1

  const predictTotals = () => RUNGS.map((_, rung) => baseBytes + plans.reduce((sum, plan) => {
    const stored = outputs.get(plan.image.ref)
    if (stored?.has(rung)) return sum + (stored.get(rung)?.bytes ?? plan.image.bytes)
    if (stored && !plan.targets[rung]) return sum + plan.image.bytes
    return sum + predictImageBytes(plan, rung, calibration)
  }, 0))

  const encoded = new Set<number>()
  const eligibleBytes = plans.reduce((sum, plan) => sum + plan.image.bytes, 0)
  const allRungs = RUNGS.map((_, rung) => rung)
  const codec = deps.codec
  const concurrency = Math.max(1, codec.concurrency ?? 1)
  let donePixels = 0

  /** Decode each image once (several at a time) and encode it at the given rungs. */
  const encodeImages = async (subset: ImagePlan[], rungs: number[], label?: string) => {
    if (!subset.length) return
    const stage = subset.some((plan) => rungs.some((rung) => plan.targets[rung]?.resized)) ? 'resize' : 'photos'
    progress.relabel(stage, label ?? STAGE_LABELS[stage])
    // Between finished images, creep forward on time so one huge image does not look stuck.
    const inFlight = new Map<ImagePlan, number>()
    const heartbeat = setInterval(() => {
      const time = now()
      let partial = 0
      for (const [plan, startedAt] of inFlight) {
        const expectedMs = Math.max(300, (plan.pixels * (1 + rungs.length)) / PIXELS_PER_MS)
        partial += plan.pixels * 0.9 * (1 - Math.exp(-(time - startedAt) / expectedMs))
      }
      progress.update((donePixels + partial) / totalPixels)
    }, HEARTBEAT_MS)
    try {
      for (const batch of batches(subset, EXTRACT_BATCH_BYTES)) {
        const sources = extractImages(session, batch.map((plan) => plan.image))
        await mapLimit(batch, concurrency, async (plan) => {
          const source = sources.get(plan.image.ref)
          sources.delete(plan.image.ref)
          inFlight.set(plan, now())
          try {
            if (source) await encodeImage(codec, session, plan, source, rungs, outputs, calibration)
          } finally {
            inFlight.delete(plan)
          }
          donePixels += plan.pixels
          progress.update(donePixels / totalPixels, { page: plan.firstPage, pages: inspection.pageCount })
        }, (plan) => plan.pixels, MAX_PIXELS_IN_FLIGHT)
      }
    } finally {
      clearInterval(heartbeat)
    }
  }

  // Learn how this deck compresses: the first wave (as many images as run at once) at every
  // rung, a few more at the rungs those measurements make plausible, the rest only where needed.
  // Guessing before measuring would drop rungs that fit: re-saving a high-quality JPEG can halve it.
  const learnCount = Math.min(plans.length, Math.max(CALIBRATION_IMAGES, concurrency, countForShare(plans, eligibleBytes * CALIBRATION_SHARE)), CALIBRATION_MAX_IMAGES)
  const firstWave = Math.min(learnCount, concurrency)
  await encodeImages(plans.slice(0, firstWave), allRungs)
  const plausible = plausibleRungs(predictTotals(), budget)
  await encodeImages(plans.slice(firstWave, learnCount), plausible)
  const chosen = learnCount < plans.length ? chooseRungs(predictTotals(), budget).encode.filter((rung) => plausible.includes(rung) || rung === allRungs.length - 1) : plausible
  await encodeImages(plans.slice(learnCount), chosen)
  for (const rung of chosen) encoded.add(rung)

  // 3. Assemble the best encoded rung that is expected to fit, and measure it.
  progress.enter('verify')
  const tryRungs = async (candidates: number[]): Promise<EngineResult | null> => {
    const totals = predictTotals()
    for (const rung of [...candidates].sort((a, b) => a - b)) {
      if (totals[rung] > budget * 1.04) {
        attempts.push({ step: RUNGS[rung].id, bytes: Math.round(totals[rung]), fits: false, ms: 0, predicted: true })
        continue
      }
      const assembled = assemble(session, inspection, plans, outputs, rung, rewriteArgs, now)
      attempts.push({ step: RUNGS[rung].id, bytes: assembled.bytes, fits: assembled.bytes <= budget, ms: assembled.ms })
      progress.update(0.5)
      if (assembled.bytes <= budget) {
        const checks = verifyCandidate(session, assembled.path, inspection)
        progress.update(1)
        return keep({
          kind: 'images',
          bytes: session.readFile(assembled.path),
          rung: RUNGS[rung],
          pageCount: inspection.pageCount,
          pageSizes: inspection.pages.map((page) => [page.width, page.height]),
          images: imageStats(plans, outputs, rung, allImages),
          attempts,
          checks,
          elapsedMs: now() - started,
        }, assembled.path)
      }
      session.remove(assembled.path)
    }
    return null
  }

  const fitted = await tryRungs([...encoded])
  if (fitted) return fitted

  // Mis-predicted: encode the lower rungs we skipped, then try again.
  const lowest = Math.max(...encoded)
  if (lowest < RUNGS.length - 1) {
    progress.enter('resize', 'Trying a lighter version')
    const remaining = allRungs.filter((rung) => rung > lowest)
    donePixels = 0
    await encodeImages(plans, remaining, 'Trying a lighter version')
    for (const rung of remaining) encoded.add(rung)
    progress.enter('verify')
    const second = await tryRungs(remaining)
    if (second) return second
  }

  // 4. Nothing fits as one file. Split the best version that needs no more parts than the floor.
  const totals = predictTotals()
  const floor = Math.max(...encoded)
  const partsFor = (bytes: number) => Math.ceil(bytes / (budget * 0.92))
  const fewest = partsFor(totals[floor])
  const splitRung = [...encoded].sort((a, b) => a - b).find((rung) => partsFor(totals[rung]) <= fewest) ?? floor
  const assembled = assemble(session, inspection, plans, outputs, splitRung, rewriteArgs, now)
  attempts.push({ step: RUNGS[splitRung].id, bytes: assembled.bytes, fits: false, ms: assembled.ms })
  const checks = verifyCandidate(session, assembled.path, inspection)
  progress.update(1)
  return keep({
    kind: 'split-needed',
    bytes: session.readFile(assembled.path),
    rung: RUNGS[splitRung],
    pageCount: inspection.pageCount,
    pageSizes: inspection.pages.map((page) => [page.width, page.height]),
    images: imageStats(plans, outputs, splitRung, allImages),
    attempts,
    checks,
    splitReason: 'quality-floor',
    elapsedMs: now() - started,
  }, assembled.path)
}

/** Rungs that could plausibly matter: skip sharper rungs predicted to be far over budget. Always keeps the floor. */
function plausibleRungs(predicted: number[], budget: number): number[] {
  const floor = predicted.length - 1
  const rungs = predicted.map((_, rung) => rung).filter((rung) => rung === floor || predicted[rung] <= budget * 1.5)
  return rungs
}

function countForShare(plans: ImagePlan[], bytes: number): number {
  let total = 0
  for (let index = 0; index < plans.length; index += 1) {
    total += plans[index].image.bytes
    if (total >= bytes) return index + 1
  }
  return plans.length
}

/**
 * Run `fn` over `items`, at most `limit` at a time and, when `weight` is
 * given, with at most `maxWeight` in flight (one item over it runs alone).
 */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, weight: (item: T) => number = () => 0, maxWeight = Infinity): Promise<void> {
  let next = 0
  let inFlight = 0
  const waiting: Array<() => void> = []
  const run = async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      const cost = weight(item)
      while (inFlight > 0 && inFlight + cost > maxWeight) await new Promise<void>((resolve) => waiting.push(resolve))
      inFlight += cost
      try {
        await fn(item)
      } finally {
        inFlight -= cost
        waiting.splice(0).forEach((wake) => wake())
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
}

/**
 * Generous guess at what a lossless rewrite could save, used only to decide
 * whether it is worth running: uncompressed and text-encoded streams shrink a
 * lot, Flate a little, image codecs not at all, and object syntax moves into
 * compressed object streams.
 */
export function losslessSavingGuess(inspection: Inspection, fileBytes: number): number {
  let saving = 0
  let streamBytes = 0
  for (const [key, entry] of Object.entries(inspection.graph.objects)) {
    if (!entry.stream) continue
    const length = inspection.graph.streamLength(key.slice(4))
    streamBytes += length
    const filters = inspection.graph.resolve(entry.stream.dict['/Filter'])
    const names = (Array.isArray(filters) ? filters : filters === undefined ? [] : [filters]).map((name) => String(name))
    if (names.some((name) => LOSSY_OR_BINARY_FILTERS.has(name))) continue
    if (!names.length) saving += length * 0.7
    else if (names.includes('/ASCIIHexDecode') || names.includes('/AHx')) saving += length * 0.6
    else if (names.includes('/ASCII85Decode') || names.includes('/A85')) saving += length * 0.3
    else if (names.includes('/LZWDecode') || names.includes('/LZW')) saving += length * 0.2
    else saving += length * 0.05
  }
  return saving + Math.max(0, fileBytes - streamBytes) * 0.5
}

const LOSSY_OR_BINARY_FILTERS = new Set(['/DCTDecode', '/DCT', '/JPXDecode', '/JBIG2Decode', '/CCITTFaxDecode', '/CCF', '/RunLengthDecode', '/RL'])

/** Groups of images whose extracted data (decoded samples for non-JPEG images) stays under `limit` bytes. */
function* batches(plans: ImagePlan[], limit: number): Generator<ImagePlan[]> {
  let current: ImagePlan[] = []
  let size = 0
  for (const plan of plans) {
    const extracted = plan.image.kind === 'raw' ? plan.pixels * (plan.image.colorModel === 'gray' ? 1 : 3) : plan.image.bytes
    if (current.length && size + extracted > limit) {
      yield current
      current = []
      size = 0
    }
    current.push(plan)
    size += extracted
  }
  if (current.length) yield current
}

/** Write the listed streams' data (decoded where lossless filters allow) and read them back. */
function extractStreams(session: QpdfSession, refs: string[], decodeLevel: 'generalized' | 'specialized', prefix: string): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>()
  if (!refs.length) return result
  const args = ['--json=2', '--json-key=qpdf', ...refs.map((ref) => `--json-object=${refNumber(ref)}`), '--json-stream-data=file', `--json-stream-prefix=${prefix}`, `--decode-level=${decodeLevel}`, INPUT]
  const { data } = session.json<QpdfJsonDocument>(args)
  const objects = data?.qpdf?.[1] ?? {}
  for (const ref of refs) {
    const entry = objects[`obj:${ref}`]
    const file = entry?.stream?.datafile
    if (!file) continue
    try {
      const bytes = session.readFile(file)
      const dict = entry.stream?.dict ?? {}
      // If QPDF could not decode the filters it leaves them in the dictionary; such data is unusable here.
      const filters = dict['/Filter']
      result.set(ref, filters === undefined || filters === '/DCTDecode' || filters === '/DCT' ? bytes : new Uint8Array(0))
    } finally {
      session.remove(file)
    }
  }
  return result
}

function findPlacements(session: QpdfSession, inspection: Inspection): Map<string, Placement[]> {
  const { graph, pages } = inspection
  const forms = collectFormRefs(graph, pages.map((page) => page.resources))
  const contentRefs = [...new Set(pages.flatMap((page) => page.contents))]
  const streams = extractStreams(session, [...contentRefs, ...forms], 'generalized', '/work/content')
  const source = (ref: string) => {
    const data = streams.get(ref)
    return data && data.byteLength ? data : null
  }
  const placements = new Map<string, Placement[]>()
  const unknown = new Set<string>()
  for (const page of pages) {
    const found = placementsForPage(graph, page, source)
    if (!found) {
      for (const image of inspection.images) if (image.pages.includes(page.number)) unknown.add(image.ref)
      continue
    }
    for (const [ref, list] of found) placements.set(ref, [...(placements.get(ref) ?? []), ...list])
  }
  // Images drawn somewhere we could not follow keep their full size (a re-save is still allowed).
  for (const ref of unknown) placements.delete(ref)
  for (const image of inspection.images) {
    if (!placements.has(image.ref)) continue
    // An image QPDF lists on a page where we saw no drawing may be used in a way we do not track.
    const seen = new Set(placements.get(image.ref)?.map((placement) => placement.page))
    if (image.pages.some((page) => !seen.has(page))) placements.delete(image.ref)
  }
  return placements
}

function extractImages(session: QpdfSession, images: ImageRecord[]): Map<string, CodecSource> {
  const raw = extractStreams(session, images.map((image) => image.ref), 'specialized', '/img/src')
  const sources = new Map<string, CodecSource>()
  for (const image of images) {
    const bytes = raw.get(image.ref)
    if (!bytes || !bytes.byteLength) continue
    const components = image.colorModel === 'gray' ? 1 : 3
    if (image.kind === 'jpeg') {
      const info = readJpegInfo(bytes)
      // The JPEG itself must agree with the PDF's description, or the browser would decode something else.
      if (!info || info.components !== components || info.width !== image.width || info.height !== image.height) continue
      sources.set(image.ref, { kind: 'jpeg', bytes })
    } else {
      if (bytes.byteLength < image.width * image.height * components) continue
      sources.set(image.ref, { kind: 'raw', bytes, width: image.width, height: image.height, components })
    }
  }
  return sources
}

async function encodeImage(
  codec: ImageCodec,
  session: QpdfSession,
  plan: ImagePlan,
  source: CodecSource,
  rungs: number[],
  outputs: Map<string, Map<number, StoredOutput>>,
  calibration: ReturnType<typeof emptyCalibration>,
): Promise<void> {
  const stored = outputs.get(plan.image.ref) ?? new Map<number, StoredOutput>()
  outputs.set(plan.image.ref, stored)
  // Identical targets on neighbouring rungs are encoded once.
  const requests: Array<{ rungs: number[]; target: ImageTarget }> = []
  for (const rung of rungs) {
    const target = plan.targets[rung]
    if (!target || stored.has(rung)) continue
    const existing = requests.find((request) => sameTarget(request.target, target))
    if (existing) existing.rungs.push(rung)
    else requests.push({ rungs: [rung], target })
  }
  if (!requests.length) return
  let results
  try {
    results = await codec.encode(source, requests.map(({ target }): CodecOutput => ({ width: target.width, height: target.height, format: target.format, quality: target.quality })))
  } catch {
    // An image the browser cannot decode stays exactly as it was.
    return
  }
  const number = refNumber(plan.image.ref)
  results.forEach((result, index) => {
    const { rungs: forRungs, target } = requests[index]
    for (const rung of forRungs) calibrate(calibration, plan, rung, result.bytes.byteLength)
    if (!acceptOutput(target, plan.image.bytes, result.bytes.byteLength)) return
    const path = `/img/out-${number}-${forRungs[0]}`
    session.writeFile(path, result.bytes, true)
    for (const rung of forRungs) stored.set(rung, { path, bytes: result.bytes.byteLength, target })
  })
}

function rewrittenDict(original: JsonDict, target: ImageTarget): JsonDict {
  const dict: JsonDict = {}
  for (const [key, value] of Object.entries(original)) {
    if (key === '/Filter' || key === '/DecodeParms' || key === '/Length' || key === '/DL' || key === '/ColorTransform') continue
    dict[key] = value
  }
  dict['/Width'] = target.width
  dict['/Height'] = target.height
  dict['/BitsPerComponent'] = 8
  dict['/Filter'] = target.format === 'jpeg' ? '/DCTDecode' : '/FlateDecode'
  return dict
}

function assemble(session: QpdfSession, inspection: Inspection, plans: ImagePlan[], outputs: Map<string, Map<number, StoredOutput>>, rung: number, args: string[], now: () => number): { path: string; bytes: number; ms: number } {
  const started = now()
  const objects: Record<string, { stream: { dict: JsonDict; datafile: string } }> = {}
  for (const plan of plans) {
    const output = outputs.get(plan.image.ref)?.get(rung)
    const dict = output ? inspection.graph.streamDict(plan.image.ref) : null
    if (!output || !dict) continue
    objects[`obj:${plan.image.ref}`] = { stream: { dict: rewrittenDict(dict, output.target), datafile: output.path } }
  }
  const update = { qpdf: [{ jsonversion: 2, pushedinheritedpageresources: false, calledgetallpages: false, maxobjectid: 0 }, objects] }
  session.writeFile('/work/update.json', new TextEncoder().encode(JSON.stringify(update)))
  const path = `/work/rung-${rung}.pdf`
  session.runOk([...args, '--update-from-json=/work/update.json', INPUT, path], undefined, 'engine')
  session.remove('/work/update.json')
  return { path, bytes: session.size(path), ms: now() - started }
}

function imageStats(plans: ImagePlan[], outputs: Map<string, Map<number, StoredOutput>>, rung: number, total: number): ImageStats {
  const stats = emptyStats(total)
  for (const plan of plans) {
    const output = outputs.get(plan.image.ref)?.get(rung)
    if (!output) continue
    stats.untouched -= 1
    if (output.target.resized) stats.resized += 1
    else stats.resaved += 1
  }
  return stats
}

/** Check the candidate kept every page at the same size, and that QPDF finds its structure sound. */
export function verifyCandidate(session: QpdfSession, path: string, reference: Pick<Inspection, 'pageCount' | 'pages'>): string[] {
  const { data } = session.json<QpdfJsonDocument>([...INSPECT_ARGS, path])
  if (!data) throw new EngineError('engine', MESSAGES.engine)
  const output = inspectionFromJson(data)
  if (output.pageCount !== reference.pageCount) throw new EngineError('engine', 'The rewritten PDF lost or gained pages, so it was not offered. Please try again or use a different browser.')
  reference.pages.forEach((page, index) => {
    const other = output.pages[index]
    if (Math.abs(other.width - page.width) > PAGE_TOLERANCE || Math.abs(other.height - page.height) > PAGE_TOLERANCE) {
      throw new EngineError('engine', `The rewritten PDF changed the size of page ${index + 1}, so it was not offered. Please try again or use a different browser.`)
    }
  })
  // Reading every object back (above) is the structure check; QPDF's --check also re-tokenises
  // every stream and takes seconds without telling us more about content we never touched.
  return ['page-count', 'page-size', 'structure']
}


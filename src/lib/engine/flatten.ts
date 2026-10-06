import { type Attempt, type EngineResult, verifyCandidate } from './engine'
import type { FlattenRung, PageVersion } from './flatpage'
import { EngineError, MESSAGES, protectedError } from './errors'
import { inspectWithQpdf, looksLikePdf } from './inspect'
import { ProgressReporter, STAGE_BANDS, type ProgressEvent } from './progress'
import { QpdfSession, type QpdfLoader } from './qpdf'

/**
 * The "nuke": turn every slide into one picture, then squeeze the pictures.
 *
 * Opt-in and last resort. Text stops being text, links stop working and
 * drawings stop being sharp at any zoom, but the deck stays one file. Each
 * slide is drawn once, re-saved at every rung below, and scored for how
 * clearly it still reads against the sharp drawing (`perceptual.ts`). Then
 * slides give up clarity where it buys the most bytes back: a photo usually
 * gives up little clarity for a lot of bytes, a slide of small print a lot
 * for little, so photos go first. No slide goes below CLARITY_FLOOR; when
 * that still doesn't fit, the result is a miss, not mush.
 */

export type { FlattenRung, PageVersion } from './flatpage'

/**
 * Pixels across the slide's long edge, and JPEG quality, sharpest first. The
 * first is also the drawing every version is scored against. Resolution goes
 * last: on a screen, a full-size slide at low JPEG quality reads sharper than
 * a smaller one at high quality, for the same bytes.
 */
export const FLATTEN_RUNGS: FlattenRung[] = [
  { longEdgePx: 2400, jpegQuality: 0.82 },
  { longEdgePx: 2400, jpegQuality: 0.66 },
  { longEdgePx: 2400, jpegQuality: 0.52 },
  { longEdgePx: 2048, jpegQuality: 0.52 },
  { longEdgePx: 1728, jpegQuality: 0.52 },
  { longEdgePx: 1440, jpegQuality: 0.52 },
  { longEdgePx: 1216, jpegQuality: 0.5 },
  { longEdgePx: 1024, jpegQuality: 0.5 },
]

/** Slides are scored as a large screen shows them: this many pixels across. */
export const COMPARE_PX = 1920

/**
 * Clarity (see `perceptual.ts`) below which a slide no longer reads clearly.
 * Set by eye at screen size: 8 pt text on a 16:9 slide still reads cleanly
 * above it, and a detailed photo goes visibly soft below it.
 */
export const CLARITY_FLOOR = 0.7

/** Share of the budget the pictures may fill, leaving room for the file around them. */
const FILL_TARGET = 0.985
/** Bytes each page adds besides its picture: page, content stream and their entries. */
const PAGE_OVERHEAD = 400

/** One drawn slide: its visible box in PDF units, its rotation, and a version per rung (empty bytes when it can never be chosen). */
export type FlatPage = { box: [number, number, number, number]; rotate: number; versions: PageVersion[] }

/** Draws slides. The browser's is PDF.js (`pdfjs.ts`); tests use a stand-in. */
export interface PageRasterizer {
  readonly pageCount: number
  /** How many pages may be in flight at once. */
  readonly concurrency?: number
  /** Draw page `index` (0-based) and return it at every rung, scored. */
  page(index: number, rungs: FlattenRung[]): Promise<FlatPage>
  close(): void
}

export type FlattenDeps = {
  qpdf: QpdfLoader
  rasterizer: (bytes: Uint8Array) => Promise<PageRasterizer>
  onProgress?: (event: ProgressEvent) => void
  now?: () => number
}

export type FlattenChoice = { rungs: number[]; bytes: number; fits: boolean; clarity: number }

type Option = { sizes: number[]; clarity: number[] }

/**
 * The rungs worth choosing for one slide, heaviest first: never below `floor`
 * (except the sharpest), each lighter one cheaper and less clear, and
 * on the upper hull of bytes against clarity, so every step down gives up
 * more clarity per byte than the one before.
 */
export function usableRungs({ sizes, clarity }: Option, floor = CLARITY_FLOOR): number[] {
  const points = sizes.map((_, rung) => rung).filter((rung) => rung === 0 || clarity[rung] >= floor)
  points.sort((a, b) => sizes[a] - sizes[b] || clarity[b] - clarity[a])
  const hull: number[] = []
  for (const rung of points) {
    // A heavier version has to read more clearly than every lighter one.
    if (hull.length && clarity[rung] <= clarity[hull[hull.length - 1]]) continue
    while (hull.length >= 2) {
      const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]]
      const cross = (sizes[b] - sizes[a]) * (clarity[rung] - clarity[a]) - (clarity[b] - clarity[a]) * (sizes[rung] - sizes[a])
      if (cross < 0) break
      hull.pop()
    }
    hull.push(rung)
  }
  return hull.reverse()
}

/**
 * Pick a rung per slide. Every slide starts at its sharpest; while the total
 * is over `budget`, the slide whose next step down costs the least clarity
 * per byte saved steps down. Room left after the last step goes back to the
 * slides where it buys the most clarity. When every slide is at its lightest
 * usable rung and it still doesn't fit, that choice comes back with
 * `fits: false`.
 */
export function chooseFlatRungs(pages: Option[], budget: number, floor = CLARITY_FLOOR): FlattenChoice {
  const ladders = pages.map((page) => usableRungs(page, floor))
  const at = pages.map(() => 0)
  const rungOf = (index: number, step = at[index]) => ladders[index][step]
  let total = pages.reduce((sum, page, index) => sum + page.sizes[rungOf(index)], 0)
  const slope = (index: number, from: number, to: number) => {
    const page = pages[index]
    const saved = page.sizes[rungOf(index, from)] - page.sizes[rungOf(index, to)]
    return (page.clarity[rungOf(index, from)] - page.clarity[rungOf(index, to)]) / Math.max(1, saved)
  }
  while (total > budget) {
    let best = -1
    let bestSlope = Infinity
    for (let index = 0; index < pages.length; index += 1) {
      if (at[index] + 1 >= ladders[index].length) continue
      const cost = slope(index, at[index], at[index] + 1)
      if (cost < bestSlope) {
        best = index
        bestSlope = cost
      }
    }
    if (best < 0) break
    total -= pages[best].sizes[rungOf(best)] - pages[best].sizes[rungOf(best, at[best] + 1)]
    at[best] += 1
  }
  const fits = total <= budget
  if (fits) {
    for (;;) {
      let best = -1
      let bestSlope = -Infinity
      for (let index = 0; index < pages.length; index += 1) {
        if (at[index] === 0) continue
        const extra = pages[index].sizes[rungOf(index, at[index] - 1)] - pages[index].sizes[rungOf(index)]
        if (extra > budget - total) continue
        const gain = slope(index, at[index] - 1, at[index])
        if (gain > bestSlope) {
          best = index
          bestSlope = gain
        }
      }
      if (best < 0) break
      total += pages[best].sizes[rungOf(best, at[best] - 1)] - pages[best].sizes[rungOf(best)]
      at[best] -= 1
    }
  }
  const rungs = at.map((_, index) => rungOf(index))
  return { rungs, bytes: total, fits, clarity: Math.min(...rungs.map((rung, index) => pages[index].clarity[rung])) }
}

const encoder = new TextEncoder()
const number = (value: number) => String(Math.round(value * 1000) / 1000)

/** A minimal PDF: one page per slide, each drawing one JPEG over its whole box. */
export function writeImagePdf(pages: Array<{ box: [number, number, number, number]; rotate: number; image: { bytes: Uint8Array; width: number; height: number } }>): Uint8Array {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.byteLength
  }
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length
    push(`${id} 0 obj\n${body}\n`)
    if (stream) {
      push('stream\n')
      push(stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  }
  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
  const pageId = (index: number) => 3 + index * 3
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(' ')}] >>`)
  pages.forEach((page, index) => {
    const id = pageId(index)
    const [x0, y0, x1, y1] = page.box
    const draw = encoder.encode(`q ${number(x1 - x0)} 0 0 ${number(y1 - y0)} ${number(x0)} ${number(y0)} cm /Im0 Do Q`)
    const rotate = ((page.rotate % 360) + 360) % 360
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [${page.box.map(number).join(' ')}]${rotate ? ` /Rotate ${rotate}` : ''} /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`)
    object(id + 1, `<< /Length ${draw.byteLength} >>`, draw)
    const { bytes, width, height } = page.image
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.byteLength} >>`, bytes)
  })
  const xref = length
  const count = 3 + pages.length * 3
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Drop the bytes of versions that can never be chosen; a deck's worth of every version is a lot to hold. */
function keepUsable(page: FlatPage, option: Option): FlatPage {
  const usable = new Set(usableRungs(option))
  return { ...page, versions: page.versions.map((version, rung) => (usable.has(rung) ? version : { ...version, bytes: new Uint8Array(0) })) }
}

const INPUT = '/work/in.pdf'
const FLAT = '/work/flat.pdf'
const OUTPUT = '/work/flat-out.pdf'

/**
 * Flatten `input` into pictures and squeeze it into `budget` bytes if a
 * clearly readable version can. The result's `flatten` says how many slides
 * and the fewest pixels any slide kept; when nothing readable fits, the
 * lightest readable version comes back with `bytes` over budget.
 */
export async function flattenDocument(input: Uint8Array, budget: number, deps: FlattenDeps): Promise<EngineResult> {
  const now = deps.now ?? (() => performance.now())
  const started = now()
  const progress = new ProgressReporter(deps.onProgress ?? (() => {}), 0, now)
  progress.enter('inspect')
  if (!looksLikePdf(input)) throw new EngineError('not-pdf', MESSAGES.notPdf)
  const session = await QpdfSession.create(deps.qpdf)
  session.writeFile(INPUT, input.slice(), true)
  const inspection = inspectWithQpdf(session, INPUT)
  session.remove(INPUT)
  if (inspection.encrypted && inspection.restricted) throw new EngineError('restricted', MESSAGES.restricted)
  if (inspection.protectedReason) throw protectedError(inspection.protectedReason)
  const attempts: Attempt[] = [{ step: 'original', bytes: input.byteLength, fits: input.byteLength <= budget, ms: 0 }]
  progress.update(1)

  progress.enter('flatten')
  const rasterizer = await deps.rasterizer(input)
  const pages: FlatPage[] = []
  const options: Option[] = []
  try {
    const count = rasterizer.pageCount
    if (count !== inspection.pageCount) throw new EngineError('engine', MESSAGES.engine)
    // A few slides in flight: one being drawn while others are re-saved.
    const parallel = Math.max(1, (rasterizer.concurrency ?? 1) + 1)
    const inFlight = new Set<Promise<void>>()
    let done = 0
    for (let index = 0; index < count; index += 1) {
      const job: Promise<void> = rasterizer.page(index, FLATTEN_RUNGS).then((page) => {
        options[index] = { sizes: page.versions.map((version) => version.bytes.byteLength + PAGE_OVERHEAD), clarity: page.versions.map((version) => version.clarity) }
        pages[index] = keepUsable(page, options[index])
        done += 1
        progress.update(done / count, { page: done, pages: count })
      })
      inFlight.add(job)
      void job.then(() => inFlight.delete(job), () => {})
      if (inFlight.size >= parallel) await Promise.race(inFlight)
    }
    await Promise.all(inFlight)
  } finally {
    rasterizer.close()
  }

  // The flatten band runs to where verify usually starts, so verify takes the room after it.
  progress.enter('verify', undefined, [STAGE_BANDS.flatten[1], 0.98])
  let target = budget * FILL_TARGET
  let result: { bytes: number; choice: FlattenChoice } | null = null
  for (let round = 0; round < 3; round += 1) {
    const choice = chooseFlatRungs(options, target)
    const startedAt = now()
    session.writeFile(FLAT, writeImagePdf(pages.map((page, index) => ({ box: page.box, rotate: page.rotate, image: page.versions[choice.rungs[index]] }))))
    session.runOk(['--object-streams=generate', '--compress-streams=y', FLAT, OUTPUT], undefined, 'engine')
    session.remove(FLAT)
    const bytes = session.size(OUTPUT)
    attempts.push({ step: 'flatten', bytes, fits: bytes <= budget, ms: now() - startedAt })
    result = { bytes, choice }
    // Over only because the file around the pictures weighed more than guessed: aim lower by that much.
    if (bytes <= budget || !choice.fits) break
    target -= bytes - budget + budget * 0.005
  }
  const checks = verifyCandidate(session, OUTPUT, inspection)
  progress.update(1)
  // Rungs run sharpest to lightest, so the highest chosen is the lightest any slide got.
  const lightest = FLATTEN_RUNGS[Math.max(...result!.choice.rungs)]
  const bytes = session.readFile(OUTPUT)
  session.remove(OUTPUT)
  return {
    kind: 'flattened',
    bytes,
    rung: null,
    pageCount: inspection.pageCount,
    pageSizes: inspection.pages.map((page) => [page.width, page.height]),
    images: { total: inspection.images.length, resaved: 0, resized: 0, untouched: 0 },
    attempts,
    checks,
    flatten: { pages: pages.length, longEdgePx: lightest.longEdgePx, jpegQuality: Math.round(lightest.jpegQuality * 100), clarity: Math.round(result!.choice.clarity * 1000) / 1000 },
    elapsedMs: now() - started,
  }
}

import { idArgs } from './engine'
import { EngineError, MESSAGES } from './errors'
import { inspectWithQpdf, looksLikePdf, type Inspection } from './inspect'
import { isDict, isRef, type JsonValue, type PdfGraph } from './pdfjson'
import { ProgressReporter, type ProgressEvent } from './progress'
import { QpdfSession, type QpdfLoader } from './qpdf'

/** `fits` is false only for a part the visitor placed by hand that measured over budget. */
export type SplitPart = { bytes: Uint8Array; startPage: number; endPage: number; fits: boolean }

/**
 * Estimated weights for choosing where to split, before anything is split.
 * A part holding pages a..b comes to about `sharedBytes + pageBytes[a-1] + … + pageBytes[b-1]`.
 */
export type SplitPlan = { sharedBytes: number; pageBytes: number[] }

const SPLIT_ARGS = ['--object-streams=generate', '--compress-streams=y']
const MAX_MEASUREMENTS_PER_PAGE = 4

/**
 * Pack consecutive pages into as few parts as possible, each measured to be
 * within `budget` bytes. QPDF copies only the resources each part uses, so
 * decks whose pages share one resource dictionary split correctly.
 */
export async function splitDocument(
  source: { session: QpdfSession; path: string } | Uint8Array,
  budget: number,
  deps: { qpdf: QpdfLoader; onProgress?: (event: ProgressEvent) => void; now?: () => number },
  options: { startFraction?: number; breakAfter?: number[] } = {},
): Promise<SplitPart[]> {
  const progress = new ProgressReporter(deps.onProgress ?? (() => {}), options.startFraction ?? 0, deps.now)
  // A split on its own, chosen by the visitor, gets the whole bar.
  progress.enter('split', undefined, options.startFraction === undefined ? [0.02, 0.99] : undefined)
  let session: QpdfSession
  let path: string
  if (source instanceof Uint8Array) {
    if (!looksLikePdf(source)) throw new EngineError('not-pdf', MESSAGES.notPdf)
    session = await QpdfSession.create(deps.qpdf)
    path = '/work/split-source.pdf'
    session.writeFile(path, source.slice(), true)
  } else {
    session = source.session
    path = source.path
  }
  const inspection = inspectWithQpdf(session, path)
  const pageCount = inspection.pageCount
  const fileBytes = session.size(path)
  const estimate = partEstimator(inspection, fileBytes)

  let measurements = 0
  const measure = (start: number, end: number): { file: string; bytes: number } => {
    measurements += 1
    if (measurements > pageCount * MAX_MEASUREMENTS_PER_PAGE + 8) throw new EngineError('engine', MESSAGES.engine)
    const file = `/parts/try-${start}-${end}.pdf`
    session.runOk([...idArgs(inspection.encrypted), ...SPLIT_ARGS, path, '--pages', '.', `${start}-${end}`, '--', file], undefined, 'engine')
    return { file, bytes: session.size(file) }
  }

  const parts: SplitPart[] = []
  if (options.breakAfter) {
    // Exactly where the visitor asked. Each part is measured; one that's over says so.
    const breaks = options.breakAfter
    const valid = breaks.length > 0 && breaks.every((page, index) => Number.isInteger(page) && page >= 1 && page < pageCount && (index === 0 || page > breaks[index - 1]))
    if (!valid) throw new EngineError('engine', MESSAGES.engine)
    const edges = [0, ...breaks, pageCount]
    for (let index = 1; index < edges.length; index += 1) {
      const startPage = edges[index - 1] + 1
      const endPage = edges[index]
      const part = measure(startPage, endPage)
      parts.push({ bytes: session.readFile(part.file), startPage, endPage, fits: part.bytes <= budget })
      session.remove(part.file)
      progress.update(endPage / pageCount, { page: endPage, pages: pageCount })
    }
    return parts
  }
  let start = 1
  while (start <= pageCount) {
    let end = start
    while (end < pageCount && estimate(start, end + 1) <= budget * 0.98) end += 1
    let best = measure(start, end)
    if (best.bytes > budget) {
      // Shrink: largest end that measures within budget.
      session.remove(best.file)
      let low = start
      let high = end - 1
      let found: { file: string; bytes: number; end: number } | null = null
      if (end === start) high = start - 1
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const attempt = measure(start, middle)
        if (attempt.bytes <= budget) {
          if (found) session.remove(found.file)
          found = { ...attempt, end: middle }
          low = middle + 1
        } else {
          session.remove(attempt.file)
          high = middle - 1
        }
      }
      if (!found) {
        throw new EngineError('page-too-large', `Page ${start} is too large to fit this email size on its own, even after resizing its images. Try a larger mailbox limit, or export that slide with smaller images.`, { page: start })
      }
      best = found
      end = found.end
    } else {
      // Estimates can be cautious: keep adding pages while the measured part still fits.
      while (end < pageCount) {
        const attempt = measure(start, end + 1)
        if (attempt.bytes > budget) {
          session.remove(attempt.file)
          break
        }
        session.remove(best.file)
        best = attempt
        end += 1
      }
    }
    const pages = Number(session.run(['--show-npages', best.file]).stdout.join('').trim())
    if (pages !== end - start + 1) throw new EngineError('engine', MESSAGES.engine)
    parts.push({ bytes: session.readFile(best.file), startPage: start, endPage: end, fits: true })
    session.remove(best.file)
    progress.update(end / pageCount, { page: end, pages: pageCount })
    start = end + 1
  }
  return parts
}

/**
 * Rough size of a page range: its content streams, every image it draws
 * (counted once per part), plus the shared remainder such as fonts.
 */
function partEstimator(inspection: Inspection, fileBytes: number): (start: number, end: number) => number {
  const { graph, pages, images } = inspection
  const contentBytes = pages.map((page) => page.contents.reduce((sum, ref) => sum + graph.streamLength(ref), 0))
  const imagesByPage = pages.map(() => [] as Array<{ ref: string; bytes: number }>)
  for (const image of images) for (const page of image.reach) imagesByPage[page - 1]?.push({ ref: image.ref, bytes: image.bytes })
  const allImages = images.reduce((sum, image) => sum + image.bytes, 0)
  const allContent = contentBytes.reduce((sum, bytes) => sum + bytes, 0)
  const shared = Math.max(0, fileBytes - allImages - allContent)
  return (start, end) => {
    let total = shared
    const seen = new Set<string>()
    for (let page = start; page <= end; page += 1) {
      total += contentBytes[page - 1] ?? 0
      for (const image of imagesByPage[page - 1] ?? []) {
        if (seen.has(image.ref)) continue
        seen.add(image.ref)
        total += image.bytes
      }
    }
    return total
  }
}

// Keys that lead away from a page's own content: the page tree, link targets, actions, outlines.
const AWAY_FROM_PAGE = new Set(['/Parent', '/P', '/Dest', '/D', '/A', '/AA', '/Next', '/Prev', '/First', '/Last', '/Popup', '/IRT', '/StructParent', '/StructParents', '/Thumb'])
// A non-stream object costs a little once it's packed into an object stream.
const OBJECT_BYTES = 24
// Measured against real splits (a 66-slide design-tool deck, a deck whose pages
// share one resource dictionary): parts carry about 16 KB of header, catalog,
// page tree and cross-references, and run about 1.5% over the sum of their objects.
const PART_OVERHEAD = 16_384
const PART_SLACK = 1.015

/** Every object a page draws or carries: contents, resources (fonts, images, forms), annotations. */
function objectsOfPage(graph: PdfGraph, pageRef: string): Set<string> {
  const found = new Set<string>()
  const page = graph.dict(pageRef)
  if (!page) return found
  const stack: Array<JsonValue | undefined> = [page['/Contents'], page['/Resources'], page['/Annots'], page['/Group']]
  while (stack.length) {
    const value = stack.pop()
    if (isRef(value)) {
      if (found.has(value)) continue
      const entry = graph.entry(value)
      if (!entry) continue
      found.add(value)
      stack.push(entry.stream ? entry.stream.dict : entry.value)
    } else if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
    } else if (isDict(value)) {
      for (const [key, item] of Object.entries(value)) if (!AWAY_FROM_PAGE.has(key)) stack.push(item)
    }
  }
  return found
}

/**
 * What every part carries, and what each page adds. Objects every page uses
 * (a font, a logo) go in `sharedBytes`; an object some pages share is split
 * evenly between them, so a part that holds only some of them comes out a
 * little light. Parts are measured when they're made, so this only steers.
 */
export function splitPlanFor(inspection: Inspection): SplitPlan {
  // Expects a file whose pages name only the resources they use (see `measureSplitPlan`).
  const { graph, pages } = inspection
  const reached = pages.map((page) => objectsOfPage(graph, page.ref))
  const reach = new Map<string, number>()
  for (const objects of reached) for (const ref of objects) reach.set(ref, (reach.get(ref) ?? 0) + 1)
  const weight = (ref: string) => (graph.isStream(ref) ? graph.streamLength(ref) : 0) + OBJECT_BYTES
  let sharedBytes = PART_OVERHEAD
  for (const [ref, count] of reach) if (count === pages.length) sharedBytes += weight(ref)
  const pageBytes = reached.map((objects) => {
    let total = OBJECT_BYTES
    for (const ref of objects) {
      const count = reach.get(ref) ?? 1
      if (count < pages.length) total += weight(ref) / count
    }
    return Math.round(total * PART_SLACK)
  })
  return { sharedBytes: Math.round(sharedBytes * PART_SLACK), pageBytes }
}

/**
 * The split plan of the PDF at `path`. Pages that share one resource dictionary
 * seem to use everything in it, so this first lets QPDF give each page only the
 * resources its content names, exactly as it does when it makes a part.
 */
export function measureSplitPlan(session: QpdfSession, path: string): SplitPlan {
  const encrypted = inspectWithQpdf(session, path).encrypted
  const normalised = '/parts/plan.pdf'
  session.runOk([...idArgs(encrypted), ...SPLIT_ARGS, path, '--pages', '.', '1-z', '--', normalised], undefined, 'engine')
  try {
    return splitPlanFor(inspectWithQpdf(session, normalised))
  } finally {
    session.remove(normalised)
  }
}

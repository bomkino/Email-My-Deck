import { idArgs } from './engine'
import { EngineError, MESSAGES } from './errors'
import { inspectWithQpdf, looksLikePdf, type Inspection } from './inspect'
import { ProgressReporter, type ProgressEvent } from './progress'
import { QpdfSession, type QpdfLoader } from './qpdf'

export type SplitPart = { bytes: Uint8Array; startPage: number; endPage: number }

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
  options: { startFraction?: number } = {},
): Promise<SplitPart[]> {
  const progress = new ProgressReporter(deps.onProgress ?? (() => {}), options.startFraction ?? 0, deps.now)
  progress.enter('split')
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
    parts.push({ bytes: session.readFile(best.file), startPage: start, endPage: end })
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

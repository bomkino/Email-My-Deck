import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { EngineError, MESSAGES } from './errors'
import { flatPageVersions, type FlatPageRequest, type FlattenRung, type PageVersion } from './flatpage'
import { COMPARE_PX, type FlatPage, type PageRasterizer } from './flatten'
import { poolSize } from './pool'

/**
 * The flatten renderer: PDF.js, inside the PDF worker, drawing on
 * OffscreenCanvas. Loaded only when someone asks to flatten.
 *
 * Fonts are drawn as outlines (no FontFace in a worker), the standard 14
 * fonts, CMaps and image decoders come from files bundled with the page, and
 * nothing is fetched from anywhere else. ICC colour profiles fall back to
 * PDF.js's own conversion, which needs no files.
 */

// Bundled with the page, fetched only when a deck needs them. Keyed by file name, which is what PDF.js asks for.
const ASSETS: Record<string, Record<string, string>> = {
  standardFontDataUrl: byName(import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url&no-inline', import: 'default', eager: true })),
  cMapUrl: byName(import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url&no-inline', import: 'default', eager: true })),
  wasmUrl: byName(import.meta.glob('/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm', { query: '?url&no-inline', import: 'default', eager: true })),
}

function byName(urls: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), String(url)]))
}

class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = ASSETS[kind]?.[filename]
    if (!url) throw new Error(`No bundled ${kind} file ${filename}.`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load ${filename}.`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

type CanvasAndContext = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null }

/** PDF.js's scratch canvases (soft masks, groups, patterns), made off-screen. */
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
    const canvas = new OffscreenCanvas(width, height)
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) }
  }

  reset(pair: CanvasAndContext, width: number, height: number): void {
    if (!pair.canvas) throw new Error('Canvas is not specified')
    pair.canvas.width = width
    pair.canvas.height = height
  }

  destroy(pair: CanvasAndContext): void {
    if (pair.canvas) pair.canvas.width = pair.canvas.height = 0
    pair.canvas = null
    pair.context = null
  }
}

/** SVG filters need a document. Without them PDF.js composes soft masks itself, and skips transfer functions. */
class NoFilterFactory {
  addFilter() { return 'none' }
  addHCMFilter() { return 'none' }
  addAlphaFilter() { return 'none' }
  addLuminosityFilter() { return 'none' }
  addKnockoutFilter() { return 'none' }
  addHighlightHCMFilter() { return 'none' }
  addSelectionHCMFilter() { return 'none' }
  addSelectionFilter() { return 'none' }
  createSelectionStyle() { return null }
  destroy() {}
}

type Scorer = { score(request: FlatPageRequest): Promise<PageVersion[]>; concurrency: number; dispose(): void }

/**
 * Re-saving and scoring a slide takes longer than drawing it, so it runs on a
 * few nested workers while the next slide is drawn. If none can start, it
 * runs here.
 */
function createScorer(size: number): Scorer {
  type Slot = { worker: Worker; busy: boolean; pending: Map<number, { resolve: (versions: PageVersion[]) => void; reject: (error: Error) => void }> }
  const slots: Slot[] = []
  const waiting: Array<() => void> = []
  let nextId = 1
  if (size > 0 && typeof Worker === 'function') {
    try {
      for (let index = 0; index < size; index += 1) {
        const slot: Slot = { worker: new Worker(new URL('../../workers/flatpage.worker.ts', import.meta.url), { type: 'module' }), busy: false, pending: new Map() }
        slot.worker.onmessage = (event: MessageEvent<{ id: number; versions?: PageVersion[]; error?: string }>) => {
          const pending = slot.pending.get(event.data.id)
          if (!pending) return
          slot.pending.delete(event.data.id)
          if (event.data.versions) pending.resolve(event.data.versions)
          else pending.reject(new Error(event.data.error ?? 'Flatten worker failed.'))
        }
        slot.worker.onerror = (event) => {
          event.preventDefault?.()
          for (const pending of slot.pending.values()) pending.reject(new Error('Flatten worker stopped.'))
          slot.pending.clear()
          slot.worker.terminate()
          const index = slots.indexOf(slot)
          if (index >= 0) slots.splice(index, 1)
          while (waiting.length) waiting.shift()?.()
        }
        slots.push(slot)
      }
    } catch {
      for (const slot of slots.splice(0)) slot.worker.terminate()
    }
  }
  return {
    concurrency: Math.max(1, slots.length),
    async score(request) {
      for (;;) {
        if (!slots.length) return flatPageVersions(request)
        const slot = slots.find((candidate) => !candidate.busy)
        if (slot) {
          slot.busy = true
          try {
            const id = nextId++
            const result = new Promise<PageVersion[]>((resolve, reject) => slot.pending.set(id, { resolve, reject }))
            slot.worker.postMessage({ id, ...request }, [request.reference])
            return await result
          } finally {
            slot.busy = false
            waiting.shift()?.()
          }
        }
        await new Promise<void>((resolve) => waiting.push(resolve))
      }
    },
    dispose() {
      for (const slot of slots.splice(0)) slot.worker.terminate()
    },
  }
}

/** Open `bytes` with PDF.js. close() frees everything, including the workers. */
export async function pdfjsRasterizer(bytes: Uint8Array): Promise<PageRasterizer> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // PDF.js parses on its own worker. It can't start one from inside ours (it looks for `window`), and its
  // same-thread fallback would take over this worker's messages, so we start it and hand PDF.js the port.
  if (typeof Worker !== 'function') throw new EngineError('engine', MESSAGES.engine)
  const port = new Worker(workerUrl, { type: 'module' })
  // The typings say `port` must be null; any MessagePort-like object works.
  const worker = new pdfjs.PDFWorker({ port: port as unknown as null })
  const task = pdfjs.getDocument({
    worker,
    data: bytes.slice(),
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: true,
    enableXfa: false,
    verbosity: 0,
  })
  const scorer = createScorer(poolSize())
  const stop = () => {
    scorer.dispose()
    void task.destroy().finally(() => {
      worker.destroy()
      port.terminate()
    })
  }
  let document: Awaited<typeof task.promise>
  try {
    document = await task.promise
  } catch (error) {
    stop()
    throw error
  }

  /** Draw page `index` (0-based) with its long edge `longEdgePx` across, unrotated, on white. */
  const draw = async (index: number, longEdgePx: number) => {
    const page = await document.getPage(index + 1)
    try {
      const [x0, y0, x1, y1] = page.view
      const viewport = page.getViewport({ scale: longEdgePx / Math.max(x1 - x0, y1 - y0), rotation: 0 })
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)))
      const context = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | null
      if (!context) throw new EngineError('engine', MESSAGES.engine)
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
      const reference = typeof canvas.transferToImageBitmap === 'function' ? canvas.transferToImageBitmap() : await createImageBitmap(canvas)
      canvas.width = canvas.height = 0
      return { reference, box: [x0, y0, x1, y1] as FlatPage['box'], rotate: page.rotate }
    } finally {
      page.cleanup()
    }
  }
  let drawing: Promise<void> = Promise.resolve()

  return {
    pageCount: document.numPages,
    concurrency: scorer.concurrency,
    async page(index: number, rungs: FlattenRung[]): Promise<FlatPage> {
      // One slide is drawn at a time; re-saving runs alongside the next one being drawn.
      const drawn = drawing.then(() => draw(index, rungs[0].longEdgePx))
      drawing = drawn.then(() => undefined, () => undefined)
      const { reference, box, rotate } = await drawn
      return { box, rotate, versions: await scorer.score({ reference, rungs, comparePx: COMPARE_PX }) }
    },
    close: stop,
  }
}

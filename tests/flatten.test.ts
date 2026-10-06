// @vitest-environment node
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { toOutcome } from '../src/lib/compression'
import { EngineError } from '../src/lib/engine/errors'
import { chooseFlatRungs, flattenDocument, FLATTEN_RUNGS, usableRungs, writeImagePdf, type FlatPage, type PageRasterizer } from '../src/lib/engine/flatten'
import { clarity, resample } from '../src/lib/engine/perceptual'
import type { ProgressEvent } from '../src/lib/engine/progress'
import { QpdfSession } from '../src/lib/engine/qpdf'
import { getTargetProfile } from '../src/lib/profiles'
import { nodeQpdf, photoJpeg, qpdfTransform, textDeck } from './helpers/engine'

describe('choosing a rung per flattened slide', () => {
  // A photo gives up little clarity per byte; small print gives up a lot.
  const photo = { sizes: [1000, 600, 300], clarity: [1, 0.97, 0.93] }
  const print = { sizes: [1000, 600, 300], clarity: [1, 0.85, 0.72] }

  it('keeps every slide at its sharpest when that fits', () => {
    expect(chooseFlatRungs([photo, print], 2000)).toEqual({ rungs: [0, 0], bytes: 2000, fits: true, clarity: 1 })
  })

  it('steps the photo down before the small print', () => {
    expect(chooseFlatRungs([photo, print], 1700).rungs).toEqual([1, 0])
    expect(chooseFlatRungs([photo, print], 1300).rungs).toEqual([2, 0])
    expect(chooseFlatRungs([photo, print], 900)).toMatchObject({ rungs: [2, 1], fits: true, clarity: 0.85 })
  })

  it('never goes below the floor, and says when that is not enough', () => {
    expect(chooseFlatRungs([photo, print], 850, 0.75)).toEqual({ rungs: [2, 1], bytes: 900, fits: false, clarity: 0.85 })
    // Below the floor nothing is usable but the sharpest.
    expect(chooseFlatRungs([{ sizes: [500, 200], clarity: [0.6, 0.5] }], 100)).toMatchObject({ rungs: [0], fits: false })
  })

  it('spends room the last step left on the slides it helps most', () => {
    const light = { sizes: [1000, 800], clarity: [1, 0.99] }
    const heavy = { sizes: [2000, 1000], clarity: [1, 0.9] }
    // The light slide steps down first, then the heavy one has to anyway; that leaves room to undo the first step.
    expect(chooseFlatRungs([light, heavy], 2500)).toMatchObject({ rungs: [0, 1], bytes: 2000, fits: true })
  })

  it('only offers versions that are lighter and less clear, on the hull', () => {
    // Rung 1 is heavier than rung 2 but no clearer; rung 3 sits under the line from 2 to 4.
    const page = { sizes: [1000, 700, 650, 400, 100], clarity: [1, 0.9, 0.92, 0.8, 0.75] }
    expect(usableRungs(page, 0.7)).toEqual([0, 2, 4])
    expect(usableRungs(page, 0.78)).toEqual([0, 2, 3])
  })
})

describe('clarity score', () => {
  const size = 64
  const text = new Uint8Array(size * size).map((_, index) => (Math.floor(index / size) % 8 < 2 && (index % size) % 6 < 3 ? 20 : 235))
  const blur = (source: Uint8Array, radius: number) => {
    const out = new Uint8Array(source.length)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let sum = 0
        let count = 0
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const sx = Math.min(size - 1, Math.max(0, x + dx))
            const sy = Math.min(size - 1, Math.max(0, y + dy))
            sum += source[sy * size + sx]
            count += 1
          }
        }
        out[y * size + x] = Math.round(sum / count)
      }
    }
    return out
  }

  it('is 1 for an untouched or empty slide, and falls as text goes soft', () => {
    expect(clarity(text, text, size, size)).toBe(1)
    const flat = new Uint8Array(size * size).fill(200)
    expect(clarity(flat, flat.map(() => 190), size, size)).toBe(1)
    const soft = clarity(text, blur(text, 1), size, size)
    const softer = clarity(text, blur(text, 2), size, size)
    expect(soft).toBeLessThan(0.9)
    expect(softer).toBeLessThan(soft)
  })

  it('resizes luminance without shifting it', () => {
    const flat = new Uint8Array(30 * 20).fill(77)
    expect(resample(flat, 30, 20, 30, 20)).toBe(flat)
    expect([...new Set(resample(flat, 30, 20, 47, 13))]).toEqual([77])
    expect([...new Set(resample(flat, 30, 20, 11, 9))]).toEqual([77])
    // Shrinking a two-tone stripe averages it; growing it back keeps both tones at the edges.
    const stripes = new Uint8Array(4 * 1).map((_, index) => (index < 2 ? 0 : 200))
    expect([...resample(stripes, 4, 1, 2, 1)]).toEqual([29, 171])
    const grown = resample(stripes, 4, 1, 8, 1)
    expect(grown[0]).toBe(0)
    expect(grown[7]).toBe(200)
  })
})

/** A rasterizer that "draws" each page as photo JPEGs of decreasing size and fixed clarity steps. */
function stubRasterizer(pageCount: number, boxes: Array<[number, number, number, number]>, rotate: number[] = []): (bytes: Uint8Array) => Promise<PageRasterizer> {
  return async () => ({
    pageCount,
    concurrency: 2,
    async page(index): Promise<FlatPage> {
      const versions = FLATTEN_RUNGS.map((rung, step) => {
        const width = Math.round(rung.longEdgePx / 10)
        const height = Math.round(width * 0.5625)
        return { bytes: photoJpeg(width, height, index + 1, Math.round(rung.jpegQuality * 100)), width, height, clarity: 1 - step * 0.04 }
      })
      return { box: boxes[index], rotate: rotate[index] ?? 0, versions }
    },
    close() {},
  })
}

async function imagesPerPage(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes)
  const filters: string[] = []
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') filters.push(String(object.dict.get(PDFName.of('Filter'))))
  }
  return filters
}

describe('flattening a deck', () => {
  const boxes: Array<[number, number, number, number]> = [[0, 0, 600, 400], [0, 0, 600, 400], [0, 0, 600, 400]]

  it('turns every page into one picture and keeps page sizes', async () => {
    const input = await textDeck(3)
    const events: ProgressEvent[] = []
    const result = await flattenDocument(input, 10_000_000, { qpdf: nodeQpdf, rasterizer: stubRasterizer(3, boxes), onProgress: (event) => events.push(event) })
    expect(result.kind).toBe('flattened')
    expect(result.flatten).toEqual({ pages: 3, longEdgePx: 2400, jpegQuality: 82, clarity: 1 })
    expect(result.checks).toEqual(['page-count', 'page-size', 'structure'])
    expect(result.attempts.at(-1)).toMatchObject({ step: 'flatten', fits: true })
    expect(await imagesPerPage(result.bytes)).toEqual(['/DCTDecode', '/DCTDecode', '/DCTDecode'])
    const document = await PDFDocument.load(result.bytes)
    expect(document.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([[600, 400], [600, 400], [600, 400]])
    // QPDF finds nothing wrong with the file, not even a warning.
    const session = await QpdfSession.create(nodeQpdf)
    session.writeFile('/work/flat.pdf', result.bytes.slice())
    expect(session.run(['--check', '/work/flat.pdf']).code).toBe(0)
    const stages = events.map((event) => event.stage)
    expect(stages).toContain('flatten')
    expect(events.filter((event) => event.stage === 'flatten' && event.pages === 3).length).toBeGreaterThan(0)
    expect(events.every((event, index) => index === 0 || event.fraction >= events[index - 1].fraction)).toBe(true)

    const outcome = toOutcome(result, input.byteLength, getTargetProfile('strict-20'), 10_000_000)
    expect(outcome).toMatchObject({ fits: true, candidate: { engine: 'flattened', quality: 'strong' }, receipt: { lossless: false, longEdgePx: 2400, flatten: { pages: 3 } } })
    expect(outcome.candidate.notes[0]).toBe('Turned 3 slides into pictures, at least 2400 pixels across.')
  })

  it('squeezes the pictures to fit, and reports the lightest slide', async () => {
    const input = await textDeck(3)
    const roomy = await flattenDocument(input, 10_000_000, { qpdf: nodeQpdf, rasterizer: stubRasterizer(3, boxes) })
    const budget = Math.round(roomy.bytes.byteLength * 0.6)
    const result = await flattenDocument(input, budget, { qpdf: nodeQpdf, rasterizer: stubRasterizer(3, boxes) })
    expect(result.bytes.byteLength).toBeLessThanOrEqual(budget)
    expect(result.flatten!.clarity).toBeLessThan(1)
    expect(result.flatten!.clarity).toBeGreaterThanOrEqual(0.7)
  })

  it('comes back over budget, not as mush, when nothing readable fits', async () => {
    const input = await textDeck(3)
    const result = await flattenDocument(input, 2_000, { qpdf: nodeQpdf, rasterizer: stubRasterizer(3, boxes) })
    expect(result.bytes.byteLength).toBeGreaterThan(2_000)
    expect(result.attempts.at(-1)).toMatchObject({ step: 'flatten', fits: false })
    // 1 - 7 × 0.04 is below the floor, so the lightest usable rung is the one above it.
    expect(result.flatten!.clarity).toBeGreaterThanOrEqual(0.7)
    expect(toOutcome(result, input.byteLength, getTargetProfile('strict-20'), 2_000).fits).toBe(false)
  })

  it('keeps rotated pages rotated', async () => {
    const input = await textDeck(2, (document) => document.getPage(1).node.set(PDFName.of('Rotate'), document.context.obj(90)))
    const result = await flattenDocument(input, 10_000_000, { qpdf: nodeQpdf, rasterizer: stubRasterizer(2, boxes, [0, 90]) })
    const document = await PDFDocument.load(result.bytes)
    expect(document.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90])
  })

  it('refuses when the renderer sees a different number of pages', async () => {
    const input = await textDeck(3)
    await expect(flattenDocument(input, 10_000_000, { qpdf: nodeQpdf, rasterizer: stubRasterizer(2, boxes) })).rejects.toBeInstanceOf(EngineError)
  })

  it('writes a PDF QPDF reads back, page for page', async () => {
    const image = { bytes: photoJpeg(64, 36, 1, 80), width: 64, height: 36 }
    const written = writeImagePdf([
      { box: [0, 0, 960, 540], rotate: 0, image },
      { box: [10, 20, 310, 420], rotate: 270, image },
    ])
    const checked = await qpdfTransform(written, ['{in}', '{out}'])
    const document = await PDFDocument.load(checked)
    expect(document.getPages().map((page) => [page.getMediaBox(), page.getRotation().angle])).toEqual([
      [{ x: 0, y: 0, width: 960, height: 540 }, 0],
      [{ x: 10, y: 20, width: 300, height: 400 }, 270],
    ])
  })
})

// @vitest-environment node
import { deflateSync } from 'node:zlib'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { toOutcome } from '../src/lib/compression'
import type { CodecOutput } from '../src/lib/engine/codec'
import { compressDocument, type EngineDeps } from '../src/lib/engine/engine'
import { EngineError } from '../src/lib/engine/errors'
import { encodeGrayJpeg } from '../src/lib/engine/grayjpeg'
import { readJpegInfo } from '../src/lib/engine/jpeg'
import type { ProgressEvent } from '../src/lib/engine/progress'
import { measureSplitPlan, splitDocument } from '../src/lib/engine/split'
import { QpdfSession } from '../src/lib/engine/qpdf'
import { getTargetProfile, rawBudgetBytes } from '../src/lib/profiles'
import { addJavaScript, addSignatureField, nodeCodec, nodeQpdf, pageCount, photoDeck, photoJpeg, qpdfTransform, textDeck } from './helpers/engine'

function deps(events: ProgressEvent[] = [], log: CodecOutput[][] = []): EngineDeps {
  return { qpdf: nodeQpdf, codec: nodeCodec(log), onProgress: (event) => events.push(event) }
}

async function imageSizes(bytes: Uint8Array): Promise<Array<[number, number, string]>> {
  const document = await PDFDocument.load(bytes)
  const sizes: Array<[number, number, string]> = []
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    if (object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
    sizes.push([Number(object.dict.get(PDFName.of('Width'))?.toString()), Number(object.dict.get(PDFName.of('Height'))?.toString()), String(object.dict.get(PDFName.of('Filter')))])
  }
  return sizes
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    if (error instanceof EngineError) return error.reason ? `${error.code}:${error.reason}` : error.code
    throw error
  }
  return undefined
}

describe('compressDocument', () => {
  it('returns a file that already fits byte for byte', async () => {
    const input = await textDeck(3)
    const copy = input.slice()
    const result = await compressDocument(input, input.byteLength + 1, deps())
    expect(result.kind).toBe('original')
    expect(result.bytes).toEqual(copy)
    expect(result.pageCount).toBe(3)
    expect(result.checks).toEqual(['unchanged'])
  })

  it('re-saves oversized photos to fit, keeping every page and its size', async () => {
    const input = await photoDeck({ pages: 6, image: [1200, 675], drawn: [240, 135], titlePage: true })
    const events: ProgressEvent[] = []
    const budget = Math.floor(input.byteLength * 0.6)
    const result = await compressDocument(input.slice(), budget, deps(events))
    expect(result.kind).toBe('images')
    expect(result.bytes.byteLength).toBeLessThanOrEqual(budget)
    expect(result.pageCount).toBe(7)
    expect(result.checks).toEqual(['page-count', 'page-size', 'structure'])
    expect(await pageCount(result.bytes)).toBe(7)
    const output = await PDFDocument.load(result.bytes)
    expect(output.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual(Array.from({ length: 7 }, () => [960, 540]))
    // Drawn at 240 pt on a 960 pt slide: the sharpest rung keeps 3840/960 × 240 = 960 px.
    const sizes = await imageSizes(result.bytes)
    expect(sizes.length).toBe(6)
    for (const [width] of sizes) expect(width).toBeLessThanOrEqual(960)
    expect(result.images.resized).toBe(6)
    // Progress only moves forward and names real stages.
    const fractions = events.map((event) => event.fraction)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    for (const event of events) expect(['inspect', 'tidy', 'photos', 'resize', 'verify']).toContain(event.stage)
    expect(events.some((event) => event.stage === 'resize' && event.page !== undefined)).toBe(true)
    expect(events.at(-1)?.fraction).toBeLessThanOrEqual(0.9)
  })

  it('handles decks whose pages share one resource dictionary', async () => {
    const input = await photoDeck({ pages: 5, image: [1000, 560], sharedResources: true })
    const budget = Math.floor(input.byteLength * 0.75)
    const result = await compressDocument(input.slice(), budget, deps())
    expect(result.kind).toBe('images')
    expect(result.bytes.byteLength).toBeLessThanOrEqual(budget)
    expect(await pageCount(result.bytes)).toBe(5)
  })

  it('asks for a split when even the floor does not fit, and the split prunes shared resources', async () => {
    const input = await photoDeck({ pages: 6, image: [1600, 900], sharedResources: true })
    const budget = Math.floor(input.byteLength / 3.5)
    const log: CodecOutput[][] = []
    const result = await compressDocument(input.slice(), budget, { ...deps([], log) }, { keepSession: true })
    expect(result.kind).toBe('split-needed')
    expect(result.splitReason).toBe('quality-floor')
    expect(result.session && result.path).toBeTruthy()
    const parts = await splitDocument({ session: result.session!, path: result.path! }, budget, { qpdf: nodeQpdf })
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.length).toBeLessThan(6)
    let pages = 0
    for (const part of parts) {
      expect(part.bytes.byteLength).toBeLessThanOrEqual(budget)
      const count = await pageCount(part.bytes)
      expect(count).toBe(part.endPage - part.startPage + 1)
      // Only the images this part draws travel with it.
      expect((await imageSizes(part.bytes)).length).toBe(count)
      pages += count
    }
    expect(pages).toBe(6)
    expect(parts[0].startPage).toBe(1)
    expect(parts.at(-1)?.endPage).toBe(6)
  })

  it('falls back to a lossless split when the browser cannot resize images', async () => {
    const input = await photoDeck({ pages: 3 })
    const result = await compressDocument(input.slice(), 1000, { qpdf: nodeQpdf, codec: null })
    expect(result.kind).toBe('split-needed')
    expect(result.splitReason).toBe('browser-cannot-resize')
  })

  it('reports a page that cannot fit on its own', async () => {
    const input = await photoDeck({ pages: 2 })
    expect(await codeOf(splitDocument(input, 5_000, { qpdf: nodeQpdf }))).toBe('page-too-large')
  })

  it('splits exactly where the visitor asked, and says which part is over', async () => {
    const input = await photoDeck({ pages: 5, image: [800, 450] })
    const budget = Math.ceil(input.byteLength / 3)
    const parts = await splitDocument(input, budget, { qpdf: nodeQpdf }, { breakAfter: [1, 4] })
    expect(parts.map((part) => [part.startPage, part.endPage])).toEqual([[1, 1], [2, 4], [5, 5]])
    expect(parts.map((part) => part.fits)).toEqual([true, false, true])
    expect(parts[1].bytes.byteLength).toBeGreaterThan(budget)
    for (const part of parts) expect(await pageCount(part.bytes)).toBe(part.endPage - part.startPage + 1)
  })

  it('refuses split points that are out of order or off the end', async () => {
    const input = await photoDeck({ pages: 3, image: [400, 225] })
    for (const breakAfter of [[2, 1], [3], [0], [1.5], []]) {
      expect(await codeOf(splitDocument(input, input.byteLength, { qpdf: nodeQpdf }, { breakAfter }))).toBe('engine')
    }
  })

  it('estimates parts closely before splitting, even when pages share one resource dictionary', async () => {
    const input = await photoDeck({ pages: 6, image: [1200, 675], sharedResources: true })
    const session = await QpdfSession.create(nodeQpdf)
    session.writeFile('/work/plan-source.pdf', input.slice(), true)
    const plan = measureSplitPlan(session, '/work/plan-source.pdf')
    expect(plan.pageBytes).toHaveLength(6)
    const estimate = (start: number, end: number) => plan.sharedBytes + plan.pageBytes.slice(start - 1, end).reduce((sum, bytes) => sum + bytes, 0)
    const parts = await splitDocument(input, input.byteLength, { qpdf: nodeQpdf }, { breakAfter: [2] })
    for (const part of parts) {
      const ratio = estimate(part.startPage, part.endPage) / part.bytes.byteLength
      expect(ratio).toBeGreaterThan(0.9)
      expect(ratio).toBeLessThan(1.15)
    }
  })

  it('splits bytes sent by an older page without an automatic split', async () => {
    const input = await photoDeck({ pages: 4, image: [800, 450] })
    const onePage = Math.ceil(input.byteLength / 3)
    const parts = await splitDocument(input, onePage, { qpdf: nodeQpdf })
    expect(parts.length).toBeGreaterThanOrEqual(2)
    expect(parts.every((part) => part.bytes.byteLength <= onePage)).toBe(true)
  })
})

/**
 * The shapes a Figma export run through iLovePDF produces, one per page, each
 * photo drawn at 120 × 67.5 pt on a 960 × 540 pt slide:
 * 1. a JPEG deflated a second time ([/FlateDecode /DCTDecode]);
 * 2. a JPEG inside a group inside a group, with a soft mask that is itself a deflated gray JPEG;
 * 3. 16-bit RGB samples.
 */
async function designToolDeck(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const context = document.context
  const [width, height] = [800, 450]
  const draw = 'q 120 0 0 67.5 40 40 cm /Im0 Do Q'
  const image = (dict: Record<string, unknown>, data: Uint8Array) =>
    context.register(context.stream(data, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ...dict } as never))
  const page = (resources: Record<string, unknown>, content: string) => {
    const added = document.addPage([960, 540])
    added.node.set(PDFName.of('Resources'), context.obj(resources as never))
    added.node.set(PDFName.of('Contents'), context.register(context.stream(content)))
  }

  page({ XObject: { Im0: image({ ColorSpace: 'DeviceRGB', Filter: ['FlateDecode', 'DCTDecode'] }, deflateSync(photoJpeg(width, height, 1))) } }, draw)

  const alpha = new Uint8Array(width * height).map((_, index) => 128 + 120 * Math.sin((index % width) / 23) * Math.cos(Math.floor(index / width) / 19))
  const mask = image({ ColorSpace: 'DeviceGray', Filter: ['FlateDecode', 'DCTDecode'] }, deflateSync(encodeGrayJpeg(alpha, width, height, 0.95)))
  const masked = image({ ColorSpace: 'DeviceRGB', Filter: 'DCTDecode', SMask: mask }, photoJpeg(width, height, 2))
  const group = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 960, 540], Group: { S: 'Transparency' } }
  const inner = context.register(context.stream(draw, { ...group, Resources: { XObject: { Im0: masked } } } as never))
  const outer = context.register(context.stream('q /Fm0 Do Q', { ...group, Resources: { XObject: { Fm0: inner } } } as never))
  page({ XObject: { Fm1: outer } }, 'q /Fm1 Do Q')

  // Photo-like 16-bit samples: a gradient plus noise in the high byte, noise in the low byte.
  const samples = new Uint8Array(width * height * 6)
  let state = 7
  const noise = () => (state = (state * 1664525 + 1013904223) >>> 0) >>> 24
  for (let index = 0; index < width * height * 3; index += 1) {
    samples[index * 2] = (((index / 3) % width) / 4 + (noise() >> 4)) & 0xff
    samples[index * 2 + 1] = noise()
  }
  page({ XObject: { Im0: image({ ColorSpace: 'DeviceRGB', BitsPerComponent: 16, Filter: 'FlateDecode' }, deflateSync(samples)) } }, draw)
  return document.save({ useObjectStreams: false })
}

describe('decks from design tools', () => {
  it('resizes deflated JPEGs, photos inside groups, their soft masks and 16-bit images', async () => {
    const input = await designToolDeck()
    const budget = Math.floor(input.byteLength * 0.5)
    const result = await compressDocument(input.slice(), budget, deps())
    expect(result.kind).toBe('images')
    expect(result.bytes.byteLength).toBeLessThanOrEqual(budget)
    expect(result.images).toEqual({ total: 4, resaved: 0, resized: 4, untouched: 0 })
    // The sharpest rung keeps 3840 / 960 × 120 = 480 px across each 800 px image, masks included.
    const output = await PDFDocument.load(result.bytes)
    let gray = 0
    for (const [, object] of output.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
      expect(object.dict.get(PDFName.of('Width'))?.toString()).toBe('480')
      expect(object.dict.get(PDFName.of('BitsPerComponent'))?.toString()).toBe('8')
      expect(object.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode')
      if (object.dict.get(PDFName.of('ColorSpace'))?.toString() !== '/DeviceGray') continue
      // A soft mask must stay one gray channel; canvas cannot write that, so the engine does.
      gray += 1
      expect(readJpegInfo(object.contents)).toMatchObject({ width: 480, height: 270, components: 1 })
    }
    expect(gray).toBe(1)
    expect(await pageCount(result.bytes)).toBe(3)
  })
})

describe('what the engine refuses, and what it no longer refuses', () => {
  const tooSmall = 100

  it('refuses a file that is not a PDF', async () => {
    expect(await codeOf(compressDocument(new TextEncoder().encode('hello, this is a text file'), tooSmall, deps()))).toBe('not-pdf')
  })

  it('calls a broken PDF damaged', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(4000))
    expect(await codeOf(compressDocument(bytes, tooSmall, deps()))).toBe('damaged')
  })

  it('tells a password-protected file apart from a permissions-restricted one', async () => {
    const plain = await textDeck(2)
    const locked = await qpdfTransform(plain, ['--encrypt', 'open-sesame', 'owner', '256', '--', '{in}', '{out}'])
    const restricted = await qpdfTransform(plain, ['--encrypt', '', 'owner', '256', '--modify=none', '--extract=n', '--', '{in}', '{out}'])
    expect(await codeOf(compressDocument(locked, tooSmall, deps()))).toBe('password')
    expect(await codeOf(compressDocument(restricted, tooSmall, deps()))).toBe('restricted')
  })

  it('works on a file encrypted without restrictions', async () => {
    const plain = await photoDeck({ pages: 3, image: [1200, 675], drawn: [240, 135] })
    const open = await qpdfTransform(plain, ['--encrypt', '', 'owner', '256', '--', '{in}', '{out}'])
    const result = await compressDocument(open, Math.floor(open.byteLength * 0.7), deps())
    expect(result.kind).toBe('images')
    expect(result.pageCount).toBe(3)
  })

  it('refuses forms, signatures, attachments and scripts with the reason', async () => {
    const forms = await textDeck(1, (document) => {
      document.getForm().createTextField('name').addToPage(document.getPage(0))
    })
    const signed = await textDeck(1, (document) => {
      addSignatureField(document)
    })
    const attached = await textDeck(1, async (document) => {
      await document.attach(new TextEncoder().encode('notes'), 'notes.txt', { mimeType: 'text/plain' })
    })
    const scripted = await textDeck(1, addJavaScript)
    expect(await codeOf(compressDocument(forms, tooSmall, deps()))).toBe('protected:forms')
    expect(await codeOf(compressDocument(signed, tooSmall, deps()))).toBe('protected:signature')
    expect(await codeOf(compressDocument(attached, tooSmall, deps()))).toBe('protected:attachments')
    expect(await codeOf(compressDocument(scripted, tooSmall, deps()))).toBe('protected:javascript')
  })

  it('does not mistake words inside page content for features', async () => {
    // The old byte scan refused files whose streams merely contained these names.
    const document = await PDFDocument.create()
    const page = document.addPage([600, 400])
    const content = document.context.register(document.context.stream('BT /F1 12 Tf 40 200 Td (/AcroForm /JavaScript /JS /EmbeddedFile /Encrypt) Tj ET % /Sig'))
    page.node.set(PDFName.of('Contents'), content)
    const bytes = await document.save({ useObjectStreams: true })
    const result = await compressDocument(bytes, bytes.byteLength + 1, deps())
    expect(result.kind).toBe('original')
  })
})

describe('outcome for the page', () => {
  it('describes a resized result in plain words and keeps older fields', async () => {
    const input = await photoDeck({ pages: 3, image: [1200, 675], drawn: [240, 135] })
    const profile = getTargetProfile('custom', 5)
    const result = await compressDocument(input.slice(), Math.floor(input.byteLength * 0.6), deps())
    const outcome = toOutcome(result, input.byteLength, profile, rawBudgetBytes(profile))
    expect(outcome.candidate.engine).toBe('images')
    expect(outcome.candidate.quality).toBe('strong')
    expect(outcome.inspection.pages).toBe(3)
    expect(outcome.verified).toBe(true)
    expect(outcome.receipt.images.resized).toBe(3)
    expect(outcome.candidate.notes.join(' ')).toMatch(/Resized 3 images/)
  })
})

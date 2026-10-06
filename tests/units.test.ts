import jpeg from 'jpeg-js'
import { describe, expect, it, vi } from 'vitest'
import type { CodecSource, ImageCodec } from '../src/lib/engine/codec'
import { entryScales, formatNumber, placementsForPage, roundPaths, scanContent, untrackedDrawing } from '../src/lib/engine/content'
import { mapLimit, splitReasonFor } from '../src/lib/engine/engine'
import { MESSAGES, toEngineError } from '../src/lib/engine/errors'
import type { ImageRecord, PageInfo } from '../src/lib/engine/inspect'
import { inspectionFromJson, looksLikePdf } from '../src/lib/engine/inspect'
import { encodeGrayJpeg } from '../src/lib/engine/grayjpeg'
import { readJpegInfo, stripJpegMetadata } from '../src/lib/engine/jpeg'
import { acceptOutput, calibrate, chooseRungs, emptyCalibration, planImage, predictImageBytes } from '../src/lib/engine/ladder'
import { PdfGraph } from '../src/lib/engine/pdfjson'
import { createCodecPool, type PoolRequest } from '../src/lib/engine/pool'
import { ProgressReporter, type ProgressEvent } from '../src/lib/engine/progress'
import { formatBytes } from '../src/lib/format'
import { photoJpeg } from './helpers/engine'

const text = (value: string) => new TextEncoder().encode(value)

describe('content stream scanner', () => {
  it('reports only matrix and drawing operators, skipping strings, arrays, comments and inline images', () => {
    const content = text('q 1 0 0 1 5 5 cm (a ) cm Q (nested (parens) /Fake Do) Tj [(x) 2 (cm)] TJ % 9 9 9 9 9 9 cm\n/Artifact << /Type /Pagination /Im9 >> BDC EMC BI /W 2 /H 1 /BPC 8 /CS /G ID \x00cm /X Do\nEI Q /Im0 Do')
    expect([...scanContent(content)]).toEqual([
      { op: 'q' },
      { op: 'cm', matrix: [1, 0, 0, 1, 5, 5] },
      { op: 'Q' },
      { op: 'Q' },
      { op: 'Do', name: 'Im0' },
    ])
  })

  it('follows the matrix through forms to find how big each image is drawn', () => {
    const graph = new PdfGraph({
      'obj:5 0 R': { stream: { dict: { '/Subtype': '/Image', '/Width': 1000, '/Height': 500 } } },
      'obj:6 0 R': { stream: { dict: { '/Subtype': '/Form', '/Matrix': [0.5, 0, 0, 0.5, 0, 0], '/Resources': { '/XObject': { '/Im0': '5 0 R' } } } } },
    })
    const streams: Record<string, string> = {
      '10 0 R': 'q 200 0 0 100 30 30 cm /Im0 Do Q',
      '11 0 R': 'q 2 0 0 2 0 0 cm /Fm0 Do Q',
      '6 0 R': '100 0 0 50 0 0 cm /Im0 Do',
    }
    const page = { number: 3, contents: ['10 0 R', '11 0 R'], resources: { '/XObject': { '/Im0': '5 0 R', '/Fm0': '6 0 R' } } }
    const placements = placementsForPage(graph, page, (ref) => (streams[ref] ? text(streams[ref]) : null))
    expect(placements?.get('5 0 R')).toEqual([
      { page: 3, width: 200, height: 100 },
      { page: 3, width: 100, height: 50 },
    ])
    // A content stream that cannot be read makes the whole page unknown.
    expect(placementsForPage(graph, page, () => null)).toBeNull()
  })
})

describe('why a deck cannot fit one email', () => {
  it('names what fills the email at the lightest version', () => {
    expect(splitReasonFor({ photosBytes: 60, keptImagesBytes: 10, otherBytes: 30 }, 100)).toBe('quality-floor')
    expect(splitReasonFor({ photosBytes: 5, keptImagesBytes: 20, otherBytes: 80 }, 100)).toBe('not-photos')
    expect(splitReasonFor({ photosBytes: 5, keptImagesBytes: 70, otherBytes: 30 }, 100)).toBe('kept-images')
  })
})

describe('path rounding', () => {
  const decode = (bytes: Uint8Array | null) => (bytes ? new TextDecoder('latin1').decode(bytes) : null)

  it('writes numbers in their shortest form', () => {
    expect(formatNumber(12.3456, 2)).toBe('12.35')
    expect(formatNumber(0.5, 1)).toBe('.5')
    expect(formatNumber(-0.25, 1)).toBe('-.3')
    expect(formatNumber(-0.04, 1)).toBe('0')
    expect(formatNumber(3.1, 2)).toBe('3.1')
    expect(formatNumber(100, 2)).toBe('100')
    expect(formatNumber(-1234.5678, 0)).toBe('-1235')
  })

  it('rounds path coordinates as finely as the drawing scale needs and leaves every other byte alone', () => {
    // 20 pixels per unit: two decimals keep 0.1 px. Under the 0.01 matrix, whole units do.
    const content = text(
      'q 1 0 0 1 10.123456 20.987654 cm 1.23456 2.34567 m 3.45678 4.56789 l (12.3456 7.8 m) Tj 5.555555 6.666666 7.777777 8.888888 re f Q\n' +
        'BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 1.23456 2.34567 m\nEI % 1.23456 2.34567 m\n0.01 0 0 0.01 0 0 cm 9.87654 1.11111 m 0.123 l 3 4 l S',
    )
    const rounded = roundPaths(content, 20)
    expect(decode(rounded)).toBe(
      'q 1 0 0 1 10.123456 20.987654 cm 1.23 2.35 m 3.46 4.57 l (12.3456 7.8 m) Tj 5.56 6.67 7.78 8.89 re f Q\n' +
        'BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 1.23456 2.34567 m\nEI % 1.23456 2.34567 m\n0.01 0 0 0.01 0 0 cm 10 1 m 0.123 l 3 4 l S',
    )
    // Same structure for everything that reads the stream afterwards.
    expect(scanContent(rounded!)).toEqual(scanContent(content))
    expect(roundPaths(text('1 2 m 3 4 l S'), 20)).toBeNull()
  })

  it('carries matrices across a page’s content streams', () => {
    expect(entryScales(['q 2 0 0 2 0 0 cm', '1 1 m Q', '3 0 0 3 0 0 cm', ''].map(text))).toEqual([1, 2, 1, 3])
  })

  it('keeps drawings that soft masks and patterns use exact, even when a page also draws them', () => {
    const graph = new PdfGraph({
      'obj:5 0 R': { stream: { dict: { '/Subtype': '/Form', '/Resources': {} } } },
      'obj:6 0 R': { stream: { dict: { '/PatternType': 1, '/Resources': {} } } },
      'obj:7 0 R': { stream: { dict: { '/Subtype': '/Form', '/Resources': {} } } },
    })
    const resources = { '/XObject': { '/Fm0': '5 0 R', '/Fm1': '7 0 R' }, '/ExtGState': { '/G0': { '/SMask': { '/G': '5 0 R' } } }, '/Pattern': { '/P0': '6 0 R' } }
    expect([...untrackedDrawing(graph, resources).forms].sort()).toEqual(['5 0 R', '6 0 R'])
  })
})

describe('image inventory', () => {
  it('finds photos inside nested groups and soft masks shared by several images', () => {
    const photo = (extra: Record<string, unknown> = {}) => ({ stream: { dict: { '/Subtype': '/Image', '/Width': 2000, '/Height': 1000, '/BitsPerComponent': 8, '/ColorSpace': '/DeviceRGB', '/Filter': ['/FlateDecode', '/DCTDecode'], '/Length': 400_000, ...extra } } })
    const inspection = inspectionFromJson({
      pages: [
        { object: '1 0 R', contents: [], images: [] },
        { object: '2 0 R', contents: [], images: [{ object: '6 0 R', width: 2000, height: 1000, filter: ['/DCTDecode'], colorspace: '/DeviceRGB', bitspercomponent: 8, filterable: false }] },
      ],
      qpdf: [{ jsonversion: 2, maxobjectid: 9 }, {
        'obj:1 0 R': { value: { '/Type': '/Page', '/MediaBox': [0, 0, 960, 540], '/Resources': { '/XObject': { '/Fm0': '3 0 R' } } } },
        'obj:2 0 R': { value: { '/Type': '/Page', '/MediaBox': [0, 0, 960, 540], '/Resources': { '/XObject': { '/Im0': '6 0 R' } } } },
        'obj:3 0 R': { stream: { dict: { '/Subtype': '/Form', '/Resources': { '/XObject': { '/Fm1': '4 0 R' } } } } },
        'obj:4 0 R': { stream: { dict: { '/Subtype': '/Form', '/Resources': { '/XObject': { '/Im1': '5 0 R' } } } } },
        'obj:5 0 R': photo({ '/SMask': '7 0 R' }),
        'obj:6 0 R': photo({ '/SMask': '7 0 R', '/Filter': '/DCTDecode' }),
        'obj:7 0 R': { stream: { dict: { '/Subtype': '/Image', '/Width': 2000, '/Height': 1000, '/BitsPerComponent': 16, '/ColorSpace': '/DeviceGray', '/Filter': '/FlateDecode', '/Length': 90_000 } } },
      }],
    })
    const byRef = new Map(inspection.images.map((image) => [image.ref, image]))
    // QPDF lists only page 2's own image; the deflated JPEG two groups down is found too.
    expect(byRef.get('5 0 R')).toMatchObject({ kind: 'jpeg', pages: [], reach: [1] })
    expect(byRef.get('6 0 R')).toMatchObject({ kind: 'jpeg', pages: [2], reach: [2] })
    // The shared 16-bit mask goes wherever either image goes.
    expect(byRef.get('7 0 R')).toMatchObject({ kind: 'raw', bitsPerComponent: 16, maskOf: ['6 0 R', '5 0 R'], reach: [1, 2] })
  })
})

describe('JPEG helpers', () => {
  it('reads size, components and an estimated quality', () => {
    const info = readJpegInfo(photoJpeg(64, 32, 1, 90))
    expect(info).toMatchObject({ width: 64, height: 32, components: 3 })
    expect(info?.quality).toBeGreaterThanOrEqual(88)
    expect(info?.quality).toBeLessThanOrEqual(92)
    expect(readJpegInfo(text('not a jpeg'))).toBeNull()
  })

  it('drops EXIF and ICC segments so the browser cannot rotate or recolour the pixels', () => {
    const plain = photoJpeg(32, 32, 2)
    const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]
    const icc = [0xff, 0xe2, 0x00, 0x06, 0x49, 0x43, 0x43, 0x5f]
    const tagged = new Uint8Array([0xff, 0xd8, ...exif, ...icc, ...plain.subarray(2)])
    const stripped = stripJpegMetadata(tagged)
    expect(stripped.byteLength).toBe(plain.byteLength)
    expect(jpeg.decode(stripped, { useTArray: true }).width).toBe(32)
  })

  it('writes one-channel JPEGs that decode close to the input, including edge blocks', () => {
    for (const [width, height] of [[1, 1], [13, 9], [301, 77]]) {
      const samples = new Uint8Array(width * height)
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) samples[y * width + x] = 128 + 100 * Math.sin(x / 9) * Math.cos(y / 7)
      const bytes = encodeGrayJpeg(samples, width, height, 0.76)
      expect(readJpegInfo(bytes)).toMatchObject({ width, height, components: 1, quality: 76 })
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
      let squared = 0
      for (let pixel = 0; pixel < width * height; pixel += 1) squared += (decoded.data[pixel * 4] - samples[pixel]) ** 2
      // Mean error under 3 levels out of 255 (PSNR above 38 dB).
      expect(Math.sqrt(squared / (width * height))).toBeLessThan(3)
    }
    // Lower quality, fewer bytes.
    const flat = new Uint8Array(256 * 256).map((_, index) => (index * 37) % 251)
    expect(encodeGrayJpeg(flat, 256, 256, 0.5).byteLength).toBeLessThan(encodeGrayJpeg(flat, 256, 256, 0.9).byteLength)
  })
})

function image(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return { ref: '5 0 R', width: 4000, height: 2250, bitsPerComponent: 8, colorModel: 'rgb', filters: ['/DCTDecode'], bytes: 3_000_000, hasSoftMask: false, hasMatte: false, pages: [1], reach: [1], kind: 'jpeg', ...overrides }
}

const slide: PageInfo[] = [{ number: 1, ref: '3 0 R', width: 960, height: 540, contents: [], resources: null }]

describe('quality ladder', () => {
  it('sizes a full-slide photo to each rung’s pixels across the slide', () => {
    const plan = planImage(image(), [{ page: 1, width: 960, height: 540 }], slide)
    expect(plan.targets.map((target) => target && [target.width, target.height, target.quality])).toEqual([
      // 3840 px would keep 96% of the pixels across: not worth a resample, so only re-saved.
      [4000, 2250, 0.85],
      [2880, 1620, 0.82],
      [2400, 1350, 0.8],
      [1920, 1080, 0.76],
      [1680, 945, 0.72],
      [1440, 810, 0.66],
    ])
  })

  it('re-saves without resizing when the image is not much bigger than needed', () => {
    const plan = planImage(image({ width: 1800, height: 1012 }), [{ page: 1, width: 960, height: 540 }], slide)
    expect(plan.targets[0]).toMatchObject({ width: 1800, height: 1012, resized: false })
    expect(plan.targets[3]).toMatchObject({ width: 1800, height: 1012, resized: false, quality: 0.76 })
  })

  it('keeps full size where the placement is unknown, and never resizes a /Matte base image', () => {
    expect(planImage(image(), undefined, slide).targets[3]).toMatchObject({ width: 4000, resized: false })
    expect(planImage(image({ hasMatte: true }), [{ page: 1, width: 96, height: 54 }], slide).targets[3]).toMatchObject({ width: 4000 })
  })

  it('keeps gray images gray and leaves lossless graphics alone unless they shrink', () => {
    const placed = [{ page: 1, width: 240, height: 135 }]
    // Canvas JPEGs are three-channel, so gray photos get the engine's own one-channel JPEG.
    expect(planImage(image({ colorModel: 'gray', kind: 'raw', filters: ['/FlateDecode'] }), placed, slide).targets[0]).toMatchObject({ format: 'jpeg-gray', resized: true })
    expect(planImage(image({ colorModel: 'gray', kind: 'jpeg', filters: ['/FlateDecode', '/DCTDecode'], maskOf: ['9 0 R'] }), placed, slide).targets[0]).toMatchObject({ format: 'jpeg-gray', resized: true })
    // A mask stored losslessly stays lossless: JPEG ringing would show along its edges.
    expect(planImage(image({ colorModel: 'gray', kind: 'raw', filters: ['/FlateDecode'], maskOf: ['9 0 R'] }), placed, slide).targets[0]).toMatchObject({ format: 'flate-gray', resized: true })
    const graphic = image({ kind: 'raw', filters: ['/FlateDecode'], width: 1000, height: 500, bytes: 50_000 })
    expect(planImage(graphic, [{ page: 1, width: 960, height: 480 }], slide).targets[0]).toBeNull()
    expect(planImage(graphic, [{ page: 1, width: 96, height: 48 }], slide).targets[0]).toMatchObject({ format: 'flate-rgb', resized: true })
  })

  it('only keeps outputs that are actually lighter', () => {
    expect(acceptOutput({ width: 1, height: 1, format: 'jpeg', resized: false }, 1000, 950)).toBe(false)
    expect(acceptOutput({ width: 1, height: 1, format: 'jpeg', resized: false }, 1000, 850)).toBe(true)
    expect(acceptOutput({ width: 1, height: 1, format: 'jpeg', resized: true }, 1000, 990)).toBe(true)
  })

  it('learns from measured images', () => {
    const plan = planImage(image(), [{ page: 1, width: 960, height: 540 }], slide)
    const calibration = emptyCalibration()
    const before = predictImageBytes(plan, 0, calibration)
    calibrate(calibration, plan, 0, before / 2)
    expect(predictImageBytes(plan, 0, calibration)).toBeCloseTo(before / 2, 0)
  })

  it('encodes the best rung expected to fit plus a safety net, or plans a split', () => {
    const budget = 100
    // The rung above is encoded too: its sharper images fill the room left.
    expect(chooseRungs([200, 140, 90, 70], budget)).toEqual({ encode: [1, 2, 3], expected: 2 })
    expect(chooseRungs([90, 80, 70, 60], budget)).toEqual({ encode: [0, 1], expected: 0 })
    // Nothing fits: the sharpest rung that needs no more emails than the floor, plus the floor.
    expect(chooseRungs([400, 250, 175, 170], budget)).toEqual({ encode: [2, 3], expected: null })
    expect(chooseRungs([400, 250, 200, 180], budget)).toEqual({ encode: [3], expected: null })
  })
})

describe('progress', () => {
  it('only moves forward, throttles updates, and keeps a split on the same bar', () => {
    let time = 0
    const events: ProgressEvent[] = []
    const progress = new ProgressReporter((event) => events.push(event), 0, () => time)
    progress.enter('inspect')
    progress.update(1)
    time += 100
    progress.enter('photos')
    progress.update(0.5)
    progress.update(0.9) // throttled: same instant
    time += 100
    progress.update(0.2) // lower: the bar stays put
    progress.relabel('resize')
    expect(events.map((event) => event.stage)).toEqual(['inspect', 'photos', 'photos', 'resize'])
    const fractions = events.map((event) => event.fraction)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(events.at(-1)?.fraction).toBeCloseTo(0.16 + 0.62 * 0.9, 3)
    const split: ProgressEvent[] = []
    new ProgressReporter((event) => split.push(event), 0.95, () => time).enter('split')
    expect(split[0]).toMatchObject({ stage: 'split', fraction: 0.95 })
  })

  it('keeps a quiet wait alive without moving the bar', () => {
    let time = 0
    const events: ProgressEvent[] = []
    const progress = new ProgressReporter((event) => events.push(event), 0, () => time)
    progress.enter('photos')
    time += 400
    progress.update(0.5)
    time += 400
    progress.keepAlive()
    progress.keepAlive() // throttled: same instant
    time += 400
    progress.keepAlive()
    expect(events.length).toBe(4)
    expect(new Set(events.slice(1).map((event) => event.fraction)).size).toBe(1)
    expect(events.slice(1).every((event) => event.stage === 'photos')).toBe(true)
  })
})

describe('mapLimit', () => {
  it('limits both the count and the weight in flight', async () => {
    let running = 0
    let weight = 0
    let peakRunning = 0
    let peakWeight = 0
    const items = [40, 40, 40, 100, 10, 10]
    await mapLimit(items, 3, async (item) => {
      running += 1
      weight += item
      peakRunning = Math.max(peakRunning, running)
      peakWeight = Math.max(peakWeight, weight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      weight -= item
    }, (item) => item, 90)
    expect(peakRunning).toBeLessThanOrEqual(3)
    // The 100 runs alone; otherwise at most 90 is in flight.
    expect(peakWeight).toBe(100)
  })
})

describe('image worker pool', () => {
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: { preventDefault(): void }) => void) | null = null
    terminated = false
    constructor(private readonly crash = false) {}
    postMessage(request: PoolRequest) {
      setTimeout(() => {
        if (this.crash) this.onerror?.({ preventDefault() {} })
        else this.onmessage?.({ data: { id: request.id, results: request.outputs.map((output) => ({ ...output, bytes: new Uint8Array(1) })) } })
      }, 1)
    }
    terminate() {
      this.terminated = true
    }
  }
  const source = (): CodecSource => ({ kind: 'jpeg', bytes: new Uint8Array(8) })
  const fallback: ImageCodec = { encode: vi.fn(async (_source, outputs) => outputs.map((output) => ({ ...output, bytes: new Uint8Array(2) }))) }

  it('spreads work over workers', async () => {
    const workers: FakeWorker[] = []
    const pool = createCodecPool(() => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker }, 3, fallback)
    expect(pool.concurrency).toBe(3)
    const results = await Promise.all([1, 2, 3, 4].map(() => pool.encode(source(), [{ width: 1, height: 1, format: 'jpeg' }])))
    expect(results.every((result) => result[0].bytes.byteLength === 1)).toBe(true)
    pool.dispose()
    expect(workers.every((worker) => worker.terminated)).toBe(true)
  })

  it('falls back to the current worker when an image worker dies', async () => {
    const pool = createCodecPool(() => new FakeWorker(true) as unknown as Worker, 2, fallback)
    await expect(pool.encode(source(), [{ width: 1, height: 1, format: 'jpeg' }])).rejects.toThrow()
    const result = await pool.encode(source(), [{ width: 1, height: 1, format: 'jpeg' }])
    expect(result[0].bytes.byteLength).toBe(2)
  })
})

describe('small helpers', () => {
  it('finds a PDF header within the first kilobyte', () => {
    expect(looksLikePdf(text('%PDF-1.7\n'))).toBe(true)
    expect(looksLikePdf(text(`${' '.repeat(500)}%PDF-1.4`))).toBe(true)
    expect(looksLikePdf(text('PK\x03\x04 a zip file'))).toBe(false)
  })

  it('maps memory failures to a clear code', () => {
    expect(toEngineError(new RangeError('Array buffer allocation failed')).code).toBe('too-big')
    expect(toEngineError(new Error('boom'))).toMatchObject({ code: 'engine', message: MESSAGES.engine })
  })

  it('formats sizes in decimal units, like mail limits', () => {
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(25_000_000)).toBe('25.0 MB')
    expect(formatBytes(17_825_792)).toBe('17.8 MB')
  })
})

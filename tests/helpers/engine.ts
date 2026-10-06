import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import jpeg from 'jpeg-js'
import { PDFDocument, PDFName, PDFString, type PDFRef } from 'pdf-lib'
import type { CodecOutput, CodecResult, CodecSource, ImageCodec } from '../../src/lib/engine/codec'
import { encodeGrayJpeg } from '../../src/lib/engine/grayjpeg'
import { QpdfSession, type QpdfLoader, type QpdfModuleFactory } from '../../src/lib/engine/qpdf'

const require = createRequire(import.meta.url)
const qpdfEntry = require.resolve('@neslinesli93/qpdf-wasm')

/** QPDF from node_modules, the same build the browser loads. */
export const nodeQpdf: QpdfLoader = async () => ({
  factory: require('@neslinesli93/qpdf-wasm') as QpdfModuleFactory,
  wasmUrl: join(dirname(qpdfEntry), 'qpdf.wasm'),
})

type Rgba = { width: number; height: number; data: Uint8Array }

function toRgba(source: CodecSource): Rgba {
  if (source.kind === 'jpeg') {
    const decoded = jpeg.decode(source.bytes, { useTArray: true, formatAsRGBA: true })
    return { width: decoded.width, height: decoded.height, data: decoded.data }
  }
  const { width, height, components, bytes } = source
  const data = new Uint8Array(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) data[pixel * 4 + channel] = bytes[pixel * components + (components === 3 ? channel : 0)]
    data[pixel * 4 + 3] = 255
  }
  return { width, height, data }
}

/** Area-average downscale; plenty for tests. */
function scale(image: Rgba, width: number, height: number): Rgba {
  if (image.width === width && image.height === height) return image
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * image.height) / height)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height))
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * image.width) / width)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width))
      const sums = [0, 0, 0]
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const offset = (sy * image.width + sx) * 4
          sums[0] += image.data[offset]
          sums[1] += image.data[offset + 1]
          sums[2] += image.data[offset + 2]
        }
      }
      const count = (y1 - y0) * (x1 - x0)
      const out = (y * width + x) * 4
      data[out] = sums[0] / count
      data[out + 1] = sums[1] / count
      data[out + 2] = sums[2] / count
      data[out + 3] = 255
    }
  }
  return { width, height, data }
}

function encodeOutput(image: Rgba, output: CodecOutput): CodecResult {
  const scaled = scale(image, output.width, output.height)
  if (output.format === 'jpeg') {
    const encoded = jpeg.encode({ width: scaled.width, height: scaled.height, data: scaled.data }, Math.round((output.quality ?? 0.82) * 100))
    return { bytes: new Uint8Array(encoded.data), width: output.width, height: output.height, format: output.format }
  }
  const components = output.format === 'flate-rgb' ? 3 : 1
  const samples = new Uint8Array(output.width * output.height * components)
  for (let pixel = 0; pixel < output.width * output.height; pixel += 1) {
    for (let channel = 0; channel < components; channel += 1) samples[pixel * components + channel] = scaled.data[pixel * 4 + channel]
  }
  const bytes = output.format === 'jpeg-gray' ? encodeGrayJpeg(samples, output.width, output.height, output.quality ?? 0.82) : new Uint8Array(deflateSync(samples))
  return { bytes, width: output.width, height: output.height, format: output.format }
}

/** Stand-in for the browser's canvas codec, using jpeg-js and zlib. */
export function nodeCodec(log: CodecOutput[][] = []): ImageCodec {
  return {
    concurrency: 2,
    async encode(source, outputs) {
      log.push(outputs)
      const image = toRgba(source)
      return outputs.map((output) => encodeOutput(image, output))
    },
  }
}

/** A photo-like JPEG: smooth gradients plus a little noise, so it compresses like a real picture. */
export function photoJpeg(width: number, height: number, seed = 1, quality = 95): Uint8Array {
  const data = Buffer.alloc(width * height * 4)
  let state = seed * 2654435761
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const noise = (random() - 0.5) * 24
      data[offset] = Math.max(0, Math.min(255, 128 + 100 * Math.sin((x + seed * 40) / 37) + noise))
      data[offset + 1] = Math.max(0, Math.min(255, 128 + 90 * Math.cos((y + seed * 13) / 29) + noise))
      data[offset + 2] = Math.max(0, Math.min(255, ((x * y) / 97 + seed * 31) % 255 + noise))
      data[offset + 3] = 255
    }
  }
  return new Uint8Array(jpeg.encode({ width, height, data }, quality).data)
}

export type DeckOptions = {
  pages: number
  pageSize?: [number, number]
  image?: [number, number]
  /** Size the image is drawn at, in points (defaults to the full page). */
  drawn?: [number, number]
  /** Every page shares one resource dictionary listing every image (LibreOffice style). */
  sharedResources?: boolean
  /** A text page with no images at the front. */
  titlePage?: boolean
}

/** A deck with one photo per page. */
export async function photoDeck(options: DeckOptions): Promise<Uint8Array> {
  const [pageWidth, pageHeight] = options.pageSize ?? [960, 540]
  const [imageWidth, imageHeight] = options.image ?? [1200, 675]
  const [drawWidth, drawHeight] = options.drawn ?? [pageWidth, pageHeight]
  const document = await PDFDocument.create()
  if (options.titlePage) {
    const page = document.addPage([pageWidth, pageHeight])
    page.drawText('Quarterly plan', { x: 60, y: pageHeight / 2, size: 48 })
  }
  const images = []
  for (let index = 0; index < options.pages; index += 1) images.push(await document.embedJpg(photoJpeg(imageWidth, imageHeight, index + 1)))
  if (!options.sharedResources) {
    for (const image of images) {
      const page = document.addPage([pageWidth, pageHeight])
      page.drawImage(image, { x: 0, y: 0, width: drawWidth, height: drawHeight })
      page.drawText(`Slide ${images.indexOf(image) + 1}`, { x: 20, y: 20, size: 18 })
    }
    return document.save()
  }
  const xobjects = Object.fromEntries(images.map((image, index) => [`Im${index}`, image.ref]))
  const shared = document.context.register(document.context.obj({ XObject: xobjects }))
  images.forEach((_, index) => {
    const page = document.addPage([pageWidth, pageHeight])
    const content = document.context.register(document.context.stream(`q ${drawWidth} 0 0 ${drawHeight} 0 0 cm /Im${index} Do Q`))
    page.node.set(PDFName.of('Resources'), shared)
    page.node.set(PDFName.of('Contents'), content)
  })
  return document.save()
}

export async function textDeck(pages = 2, extra?: (document: PDFDocument) => void | Promise<void>): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  for (let index = 0; index < pages; index += 1) document.addPage([600, 400]).drawText(`Page ${index + 1}`, { x: 40, y: 200, size: 24 })
  await extra?.(document)
  return document.save()
}

export function addJavaScript(document: PDFDocument): void {
  document.catalog.set(PDFName.of('OpenAction'), document.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }))
}

export function addSignatureField(document: PDFDocument): PDFRef {
  const signature = document.context.register(document.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 10, 20, 30], Contents: PDFString.of('00') }))
  const field = document.context.register(document.context.obj({ FT: 'Sig', T: PDFString.of('Signature1'), V: signature, Subtype: 'Widget', Rect: [0, 0, 0, 0], P: document.getPage(0).ref }))
  document.catalog.set(PDFName.of('AcroForm'), document.context.obj({ Fields: [field], SigFlags: 3 }))
  document.getPage(0).node.set(PDFName.of('Annots'), document.context.obj([field]))
  return field
}

/** Run QPDF on `input` (as /work/in.pdf) and return /work/out.pdf. */
export async function qpdfTransform(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const session = await QpdfSession.create(nodeQpdf)
  session.writeFile('/work/in.pdf', input.slice())
  session.runOk([...args.map((arg) => arg.replace('{in}', '/work/in.pdf').replace('{out}', '/work/out.pdf'))])
  return session.readFile('/work/out.pdf')
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount()
}

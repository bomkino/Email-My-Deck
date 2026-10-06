import { EngineError, MESSAGES, type ProtectedReason } from './errors'
import { isDict, isRef, PdfGraph, refNumber, type JsonDict, type JsonValue, type QpdfJsonDocument } from './pdfjson'
import type { QpdfSession } from './qpdf'

export type PageInfo = {
  /** 1-based page number. */
  number: number
  ref: string
  /** Visible size in PDF units (CropBox clipped to MediaBox). */
  width: number
  height: number
  contents: string[]
  resources: JsonDict | null
}

export type ColorModel = 'rgb' | 'gray' | 'cmyk' | 'other'

export type ImageRecord = {
  ref: string
  width: number
  height: number
  bitsPerComponent: number
  colorModel: ColorModel
  filters: string[]
  /** Encoded stream length in bytes. */
  bytes: number
  hasSoftMask: boolean
  hasMatte: boolean
  /** 1-based page numbers that draw this image directly (QPDF's page image list). */
  pages: number[]
  /** How the engine may rewrite it, or why it leaves it untouched. */
  kind: 'jpeg' | 'raw' | null
  skipReason?: string
}

export type Inspection = {
  pageCount: number
  pages: PageInfo[]
  images: ImageRecord[]
  graph: PdfGraph
  encrypted: boolean
  protectedReason: ProtectedReason | null
  restricted: boolean
}

export const INSPECT_ARGS = [
  '--json=2',
  '--json-key=pages',
  '--json-key=encrypt',
  '--json-key=acroform',
  '--json-key=attachments',
  '--json-key=qpdf',
  '--json-stream-data=none',
]

const GENERAL_FILTERS = new Set(['/FlateDecode', '/Fl', '/LZWDecode', '/LZW', '/ASCII85Decode', '/A85', '/ASCIIHexDecode', '/AHx', '/RunLengthDecode', '/RL'])
const MIN_REWRITE_PIXELS = 128 * 128
const MIN_REWRITE_BYTES = 16 * 1024

export function looksLikePdf(bytes: Uint8Array): boolean {
  // The header may follow a little junk; PDF readers accept it within the first 1 KB.
  const limit = Math.min(bytes.byteLength - 5, 1024)
  for (let index = 0; index <= limit; index += 1) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x50 && bytes[index + 2] === 0x44 && bytes[index + 3] === 0x46 && bytes[index + 4] === 0x2d) return true
  }
  return false
}

/** Read structure, security and the image inventory with QPDF's JSON output. */
export function inspectWithQpdf(session: QpdfSession, inputPath: string): Inspection {
  const { result, data } = session.json<QpdfJsonDocument>([...INSPECT_ARGS, inputPath])
  if (!data) {
    const errors = result.stderr.join('\n')
    if (/invalid password/i.test(errors)) throw new EngineError('password', MESSAGES.password)
    if (/can't find PDF header|not a PDF/i.test(errors)) throw new EngineError('not-pdf', MESSAGES.notPdf)
    throw new EngineError('damaged', MESSAGES.damaged)
  }
  return inspectionFromJson(data)
}

export function inspectionFromJson(data: QpdfJsonDocument): Inspection {
  const graph = PdfGraph.fromJson(data)
  const pageEntries = data.pages ?? []
  if (!pageEntries.length) throw new EngineError('damaged', MESSAGES.damaged)

  const pages: PageInfo[] = pageEntries.map((entry, index) => {
    const dict = graph.dict(entry.object) ?? {}
    const box = pageBox(graph, dict)
    const resources = graph.dict(inherited(graph, dict, '/Resources'))
    return { number: index + 1, ref: entry.object, width: box.width, height: box.height, contents: entry.contents ?? [], resources }
  })

  const images = new Map<string, ImageRecord>()
  pageEntries.forEach((entry, index) => {
    for (const image of entry.images ?? []) {
      const existing = images.get(image.object)
      if (existing) {
        if (!existing.pages.includes(index + 1)) existing.pages.push(index + 1)
        continue
      }
      const record = imageRecord(graph, image.object)
      if (record) {
        record.pages.push(index + 1)
        images.set(image.object, record)
      }
    }
  })

  const encrypt = data.encrypt
  const encrypted = Boolean(encrypt?.encrypted)
  const restricted = encrypted && Object.values(encrypt?.capabilities ?? {}).some((allowed) => allowed === false)

  return {
    pageCount: pages.length,
    pages,
    images: [...images.values()],
    graph,
    encrypted,
    restricted,
    protectedReason: protectedReason(graph, data),
  }
}

export function imageRecord(graph: PdfGraph, ref: string): ImageRecord | null {
  const dict = graph.streamDict(ref)
  if (!dict || graph.name(dict['/Subtype']) !== '/Image') return null
  const width = graph.number(dict['/Width']) ?? 0
  const height = graph.number(dict['/Height']) ?? 0
  const imageMask = graph.resolve(dict['/ImageMask']) === true
  const bitsPerComponent = graph.number(dict['/BitsPerComponent']) ?? (imageMask ? 1 : 0)
  const filters = nameList(graph, dict['/Filter'])
  const decodeParms = graph.resolve(dict['/DecodeParms'])
  const colorModel = imageMask ? 'other' : colorModelOf(graph, dict['/ColorSpace'])
  const mask = graph.resolve(dict['/Mask'])
  const softMask = dict['/SMask']
  const softMaskDict = isRef(softMask) ? graph.streamDict(softMask) : null
  const record: ImageRecord = {
    ref,
    width,
    height,
    bitsPerComponent,
    colorModel,
    filters,
    bytes: graph.streamLength(ref),
    hasSoftMask: Boolean(softMaskDict),
    hasMatte: Boolean(softMaskDict && softMaskDict['/Matte'] !== undefined),
    pages: [],
    kind: null,
  }
  const skip = (reason: string) => {
    record.skipReason = reason
    return record
  }
  if (imageMask) return skip('stencil mask')
  if (bitsPerComponent !== 8) return skip(`${bitsPerComponent}-bit samples`)
  if (colorModel !== 'rgb' && colorModel !== 'gray') return skip(`${colorModel} colour`)
  if (Array.isArray(mask)) return skip('colour-key mask')
  if (width * height < MIN_REWRITE_PIXELS || record.bytes < MIN_REWRITE_BYTES) return skip('small')
  if (filters.length === 1 && (filters[0] === '/DCTDecode' || filters[0] === '/DCT')) {
    const parms = Array.isArray(decodeParms) ? graph.dict(decodeParms[0]) : graph.dict(decodeParms)
    if (parms && parms['/ColorTransform'] !== undefined) return skip('custom JPEG colour transform')
    record.kind = 'jpeg'
    return record
  }
  if (filters.every((filter) => GENERAL_FILTERS.has(filter))) {
    record.kind = 'raw'
    return record
  }
  return skip(`${filters.join(' ')} encoding`)
}

function nameList(graph: PdfGraph, value: JsonValue | undefined): string[] {
  const resolved = graph.resolve(value)
  if (typeof resolved === 'string') return [resolved]
  if (Array.isArray(resolved)) return resolved.map((item) => graph.name(item)).filter((item): item is string => Boolean(item))
  return []
}

export function colorModelOf(graph: PdfGraph, value: JsonValue | undefined): ColorModel {
  const resolved = graph.resolve(value)
  if (typeof resolved === 'string') {
    if (resolved === '/DeviceRGB' || resolved === '/RGB' || resolved === '/CalRGB') return 'rgb'
    if (resolved === '/DeviceGray' || resolved === '/G' || resolved === '/CalGray') return 'gray'
    if (resolved === '/DeviceCMYK' || resolved === '/CMYK') return 'cmyk'
    return 'other'
  }
  if (Array.isArray(resolved) && resolved.length) {
    const family = graph.name(resolved[0])
    if (family === '/CalRGB') return 'rgb'
    if (family === '/CalGray') return 'gray'
    if (family === '/ICCBased' && isRef(resolved[1])) {
      const components = graph.number(graph.streamDict(resolved[1])?.['/N'])
      if (components === 3) return 'rgb'
      if (components === 1) return 'gray'
      if (components === 4) return 'cmyk'
    }
  }
  return 'other'
}

function inherited(graph: PdfGraph, page: JsonDict, key: string): JsonValue | undefined {
  let node: JsonDict | null = page
  for (let depth = 0; node && depth < 64; depth += 1) {
    if (node[key] !== undefined) return node[key]
    node = graph.dict(node['/Parent'])
  }
  return undefined
}

function rect(graph: PdfGraph, value: JsonValue | undefined): [number, number, number, number] | null {
  const items = graph.array(value)
  if (!items || items.length !== 4) return null
  const numbers = items.map((item) => graph.number(item))
  if (numbers.some((item) => item === null)) return null
  const [x0, y0, x1, y1] = numbers as number[]
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]
}

export function pageBox(graph: PdfGraph, page: JsonDict): { width: number; height: number } {
  const media = rect(graph, inherited(graph, page, '/MediaBox')) ?? [0, 0, 612, 792]
  const crop = rect(graph, inherited(graph, page, '/CropBox'))
  const box = crop
    ? [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])]
    : media
  const width = box[2] - box[0]
  const height = box[3] - box[1]
  if (width <= 0 || height <= 0) return { width: media[2] - media[0], height: media[3] - media[1] }
  return { width, height }
}

function protectedReason(graph: PdfGraph, data: QpdfJsonDocument): ProtectedReason | null {
  const fields = data.acroform?.hasacroform ? data.acroform.fields ?? [] : []
  let signature = fields.some((field) => field.fieldtype === '/Sig')
  let attachments = Object.keys(data.attachments ?? {}).length > 0
  let javascript = false
  for (const dict of graph.dictionaries()) {
    if (dict['/ByteRange'] !== undefined && graph.name(dict['/Type']) === '/Sig') signature = true
    if (dict['/Perms'] !== undefined && graph.name(dict['/Type']) === '/Catalog') signature = true
    if (dict['/EF'] !== undefined || dict['/EmbeddedFiles'] !== undefined) attachments = true
    if (graph.name(dict['/Subtype']) === '/FileAttachment') attachments = true
    if (dict['/JS'] !== undefined || graph.name(dict['/S']) === '/JavaScript') javascript = true
    if (isDict(dict['/Names']) || isRef(dict['/Names'])) {
      const names = graph.dict(dict['/Names'])
      if (names && names['/JavaScript'] !== undefined) javascript = true
      if (names && names['/EmbeddedFiles'] !== undefined) attachments = true
    }
  }
  if (signature) return 'signature'
  if (fields.length > 0) return 'forms'
  if (attachments) return 'attachments'
  if (javascript) return 'javascript'
  return null
}

export function objectNumber(ref: string): number {
  return refNumber(ref)
}

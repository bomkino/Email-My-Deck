import { isRef, type JsonDict, type JsonValue, type PdfGraph } from './pdfjson'

/**
 * Finds how large each image is drawn on each page by following the
 * transformation matrix (q / Q / cm) through page content and form XObjects.
 * Only geometry matters here, so text, paths and colours are skipped.
 */

export type Matrix = [number, number, number, number, number, number]

export type Placement = {
  page: number
  /** Drawn size of the image's unit square, in PDF units. */
  width: number
  height: number
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ]
}

function isWhite(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00
}

function isDelimiter(byte: number): boolean {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e || byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d || byte === 0x2f || byte === 0x25
}

export type ContentEvent =
  | { op: 'q' }
  | { op: 'Q' }
  | { op: 'cm'; matrix: Matrix }
  | { op: 'Do'; name: string }

const NUMBER = 0
const NAME = 1
const OTHER = 2

/** Operands since the last operator, kept in reusable arrays: content streams run to millions of tokens. */
class Operands {
  count = 0
  kinds = new Uint8Array(64)
  values = new Float64Array(64)
  starts = new Int32Array(64)
  ends = new Int32Array(64)

  push(kind: number, value: number, start: number, end: number) {
    if (this.count === this.kinds.length) {
      const size = this.count * 2
      const grow = <T extends Uint8Array | Float64Array | Int32Array>(from: T, to: T) => (to.set(from), to)
      this.kinds = grow(this.kinds, new Uint8Array(size))
      this.values = grow(this.values, new Float64Array(size))
      this.starts = grow(this.starts, new Int32Array(size))
      this.ends = grow(this.ends, new Int32Array(size))
    }
    this.kinds[this.count] = kind
    this.values[this.count] = value
    this.starts[this.count] = start
    this.ends[this.count] = end
    this.count += 1
  }

  /** The last `n` operands as numbers, or null if any is not a number. */
  numbers(n: number): number[] | null {
    if (this.count < n) return null
    const result: number[] = []
    for (let index = this.count - n; index < this.count; index += 1) {
      if (this.kinds[index] !== NUMBER) return null
      result.push(this.values[index])
    }
    return result
  }
}

/** Operators of up to three letters, packed into one number for quick comparison. */
const opCode = (text: string) => text.charCodeAt(0) | ((text.charCodeAt(1) || 0) << 8) | ((text.charCodeAt(2) || 0) << 16)
const OP = { q: opCode('q'), Q: opCode('Q'), cm: opCode('cm'), Do: opCode('Do'), BI: opCode('BI') }
/** Operand counts of the path construction operators: m, l, c, v, y and re. */
const PATH_OPERANDS = new Map([['m', 2], ['l', 2], ['c', 6], ['v', 4], ['y', 4], ['re', 4]].map(([op, count]) => [opCode(op as string), count as number]))

/**
 * Split a content stream into operands and operators, calling `onOp` at each
 * operator with its operands in `operands`. Strings, arrays and dictionaries
 * are opaque operands, comments are dropped, and inline image data is skipped
 * (reported as one `BI` operator) so its bytes are never misread. Operators
 * longer than three letters are reported with code -1.
 */
function lexContent(bytes: Uint8Array, operands: Operands, onOp: (code: number, start: number, end: number) => void): void {
  const length = bytes.byteLength
  operands.count = 0
  let index = 0
  while (index < length) {
    const byte = bytes[index]
    const start = index
    if (isWhite(byte)) {
      index += 1
      continue
    }
    if (byte === 0x25) {
      while (index < length && bytes[index] !== 0x0a && bytes[index] !== 0x0d) index += 1
      continue
    }
    if (byte === 0x28) {
      // Literal string with nesting and escapes.
      let depth = 1
      index += 1
      while (index < length && depth > 0) {
        const current = bytes[index]
        if (current === 0x5c) index += 2
        else {
          if (current === 0x28) depth += 1
          else if (current === 0x29) depth -= 1
          index += 1
        }
      }
      operands.push(OTHER, 0, start, index)
      continue
    }
    if (byte === 0x3c) {
      if (bytes[index + 1] === 0x3c) index += 2
      else {
        while (index < length && bytes[index] !== 0x3e) index += 1
        index += 1
      }
      operands.push(OTHER, 0, start, index)
      continue
    }
    if (byte === 0x3e) {
      index += bytes[index + 1] === 0x3e ? 2 : 1
      continue
    }
    if (byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d) {
      index += 1
      operands.push(OTHER, 0, start, index)
      continue
    }
    if (byte === 0x2f) {
      index += 1
      while (index < length && !isWhite(bytes[index]) && !isDelimiter(bytes[index])) index += 1
      operands.push(NAME, 0, start, index)
      continue
    }
    if ((byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x2b || byte === 0x2e) {
      // A number: optional sign, digits, at most one point. Anything else makes it not a number.
      let negative = false
      if (byte === 0x2d || byte === 0x2b) {
        negative = byte === 0x2d
        index += 1
      }
      let whole = 0
      let fraction = 0
      let scale = 1
      let digits = 0
      let point = false
      let valid = true
      while (index < length && !isWhite(bytes[index]) && !isDelimiter(bytes[index])) {
        const current = bytes[index]
        if (current >= 0x30 && current <= 0x39) {
          if (point) {
            fraction = fraction * 10 + (current - 0x30)
            scale *= 10
          } else whole = whole * 10 + (current - 0x30)
          digits += 1
        } else if (current === 0x2e && !point) point = true
        else valid = false
        index += 1
      }
      const value = whole + fraction / scale
      if (valid && digits) operands.push(NUMBER, negative ? -value : value, start, index)
      else operands.push(OTHER, 0, start, index)
      continue
    }
    // An operator keyword (or true, false, null).
    let code = 0
    while (index < length && !isWhite(bytes[index]) && !isDelimiter(bytes[index])) {
      const offset = index - start
      code = offset < 3 ? code | (bytes[index] << (offset * 8)) : -1
      index += 1
    }
    if (index === start) {
      index += 1
      continue
    }
    const size = index - start
    if (size >= 4 && size <= 5 && isKeywordValue(bytes, start, size)) {
      operands.push(OTHER, 0, start, index)
      continue
    }
    if (code === OP.BI) index = skipInlineImage(bytes, index)
    onOp(code, start, index)
    operands.count = 0
  }
}

/** `true`, `false` or `null`: operands that look like operators. */
function isKeywordValue(bytes: Uint8Array, start: number, size: number): boolean {
  const text = ascii(bytes, start, start + size)
  return text === 'true' || text === 'false' || text === 'null'
}

/**
 * Tokenise a content stream and report only the operators that change or use
 * the current transformation matrix. Strings, arrays, dictionaries, comments
 * and inline image data are skipped so their bytes are never misread.
 */
export function scanContent(bytes: Uint8Array): ContentEvent[] {
  const events: ContentEvent[] = []
  const operands = new Operands()
  lexContent(bytes, operands, (code) => {
    if (code === OP.q) events.push({ op: 'q' })
    else if (code === OP.Q) events.push({ op: 'Q' })
    else if (code === OP.cm) {
      const matrix = operands.numbers(6)
      if (matrix) events.push({ op: 'cm', matrix: matrix as Matrix })
    } else if (code === OP.Do && operands.count >= 1) {
      const last = operands.count - 1
      if (operands.kinds[last] === NAME) events.push({ op: 'Do', name: decodeName(bytes, operands.starts[last] + 1, operands.ends[last]) })
    }
  })
  return events
}

/** Largest factor by which a matrix stretches any direction (its largest singular value). */
export function matrixScale(m: Matrix): number {
  const sum = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3]
  const det = m[0] * m[3] - m[1] * m[2]
  return Math.sqrt((sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2)
}

/**
 * A page's content streams run as one, so a matrix set in one stream can
 * still apply in the next. For each stream, the largest scale in force at its
 * start (the current matrix or any saved one a `Q` could restore); 1 for the first.
 */
export function entryScales(streams: Uint8Array[]): number[] {
  const scales: number[] = []
  const stack: Matrix[] = []
  let ctm = IDENTITY
  for (const stream of streams) {
    scales.push(Math.max(1, matrixScale(ctm), ...stack.map(matrixScale)))
    for (const event of scanContent(stream)) {
      if (event.op === 'q') stack.push(ctm)
      else if (event.op === 'Q') ctm = stack.pop() ?? IDENTITY
      else if (event.op === 'cm') ctm = multiply(event.matrix, ctm)
    }
  }
  return scales
}

/** Largest error, in pixels, that rounding a path coordinate may add. */
export const PATH_ERROR_PX = 0.1
const MAX_DECIMALS = 6
const POWERS = Array.from({ length: MAX_DECIMALS + 1 }, (_, power) => 10 ** power)

/**
 * Write `value` to `decimals` places into `out` in PDF's shortest form (no
 * exponent, no trailing zeros, no leading zero) and return its length.
 * `out` needs room for 32 bytes.
 */
function writeNumber(out: Uint8Array, value: number, decimals: number): number {
  const factor = POWERS[decimals]
  const scaled = Math.round(Math.abs(value) * factor)
  if (scaled === 0) {
    out[0] = 0x30
    return 1
  }
  let length = 0
  if (value < 0) out[length++] = 0x2d
  const whole = Math.floor(scaled / factor)
  let fraction = scaled - whole * factor
  let places = decimals
  while (places > 0 && fraction % 10 === 0) {
    fraction /= 10
    places -= 1
  }
  if (whole > 0) {
    let digits = 1
    for (let rest = whole; rest >= 10; rest = Math.floor(rest / 10)) digits += 1
    for (let place = length + digits - 1, rest = whole; place >= length; place -= 1, rest = Math.floor(rest / 10)) out[place] = 0x30 + (rest % 10)
    length += digits
  }
  if (places > 0) {
    out[length++] = 0x2e
    for (let place = places - 1; place >= 0; place -= 1) {
      out[length + place] = 0x30 + (fraction % 10)
      fraction = Math.floor(fraction / 10)
    }
    length += places
  }
  return length
}

/** `value` to `decimals` places in PDF's shortest form, as text. */
export function formatNumber(value: number, decimals: number): string {
  const out = new Uint8Array(32)
  return ascii(out, 0, writeNumber(out, value, decimals))
}

/**
 * Round the coordinates of path operators (m, l, c, v, y, re) no finer than
 * the eye can see. `pixelsPerUnit` is how many pixels one unit of this stream
 * spans in the sharpest view we plan for; the matrix set inside the stream
 * (q, Q, cm) is followed, so each path keeps PATH_ERROR_PX. Everything else,
 * matrices, text and colours included, stays byte for byte. Returns null when
 * nothing got shorter.
 */
export function roundPaths(content: Uint8Array, pixelsPerUnit: number): Uint8Array | null {
  const operands = new Operands()
  const out = new Uint8Array(content.byteLength)
  const text = new Uint8Array(32)
  const stack: Matrix[] = []
  let ctm = IDENTITY
  let decimals = -1
  let read = 0
  let write = 0
  lexContent(content, operands, (code) => {
    if (code === OP.q) stack.push(ctm)
    else if (code === OP.Q) {
      ctm = stack.pop() ?? IDENTITY
      decimals = -1
    } else if (code === OP.cm) {
      const matrix = operands.numbers(6)
      if (matrix) ctm = multiply(matrix as Matrix, ctm)
      decimals = -1
    } else if (PATH_OPERANDS.get(code) === operands.count) {
      for (let index = 0; index < operands.count; index += 1) {
        if (operands.kinds[index] !== NUMBER || !(Math.abs(operands.values[index]) < 1e9)) return
      }
      if (decimals < 0) {
        // Half a step of the last decimal, times the pixels it spans, stays within PATH_ERROR_PX.
        const pixels = pixelsPerUnit * matrixScale(ctm)
        decimals = Math.max(0, Math.ceil(Math.log10((pixels * 0.5) / PATH_ERROR_PX)))
      }
      // Drawn so large that six decimals are not enough: leave it exact.
      if (decimals > MAX_DECIMALS) return
      for (let index = 0; index < operands.count; index += 1) {
        const start = operands.starts[index]
        const end = operands.ends[index]
        const length = writeNumber(text, operands.values[index], decimals)
        if (length >= end - start) continue
        // Spans between numbers are a few bytes: copy by hand rather than make subarrays.
        while (read < start) out[write++] = content[read++]
        for (let at = 0; at < length; at += 1) out[write++] = text[at]
        read = end
      }
    }
  })
  if (read === 0) return null
  out.set(content.subarray(read), write)
  write += content.byteLength - read
  return out.slice(0, write)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = ''
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index])
  return text
}

function decodeName(bytes: Uint8Array, start: number, end: number): string {
  let text = ''
  for (let index = start; index < end; index += 1) {
    if (bytes[index] === 0x23 && index + 2 < end) {
      const code = parseInt(String.fromCharCode(bytes[index + 1], bytes[index + 2]), 16)
      if (Number.isFinite(code)) {
        text += String.fromCharCode(code)
        index += 2
        continue
      }
    }
    text += String.fromCharCode(bytes[index])
  }
  return text
}

/** Skip from after `BI` to after the matching `EI`. */
function skipInlineImage(bytes: Uint8Array, start: number): number {
  let index = start
  const length = bytes.byteLength
  // Find the ID keyword that ends the inline dictionary.
  while (index < length - 1) {
    if (bytes[index] === 0x49 && bytes[index + 1] === 0x44 && isWhite(bytes[index - 1] ?? 0x20) && (index + 2 >= length || isWhite(bytes[index + 2]))) {
      index += 3
      break
    }
    index += 1
  }
  // Binary data runs until whitespace, EI and whitespace (or the end).
  while (index < length - 1) {
    if (bytes[index] === 0x45 && bytes[index + 1] === 0x49 && isWhite(bytes[index - 1]) && (index + 2 >= length || isWhite(bytes[index + 2]) || isDelimiter(bytes[index + 2]))) {
      return index + 2
    }
    index += 1
  }
  return length
}

export type StreamSource = (ref: string) => Uint8Array | null

/** Every form XObject reachable from page resources, so their content can be fetched in one go. */
export function collectFormRefs(graph: PdfGraph, resources: Array<JsonDict | null>): string[] {
  const found = new Set<string>()
  const queue = [...resources]
  while (queue.length) {
    const current = queue.pop()
    const xobjects = current ? graph.dict(current['/XObject']) : null
    if (!xobjects) continue
    for (const value of Object.values(xobjects)) {
      if (!isRef(value) || found.has(value)) continue
      const dict = graph.streamDict(value)
      if (!dict || graph.name(dict['/Subtype']) !== '/Form') continue
      found.add(value)
      queue.push(graph.dict(dict['/Resources']))
    }
  }
  return [...found]
}

/**
 * What a page can draw without a `Do` in its content stream (or a form's):
 * soft-mask groups (ExtGState /SMask /G), tiling patterns and Type 3 glyphs.
 * Their drawing sizes are not followed, so `images` (reachable through them)
 * keep full size and `forms` keep their exact coordinates. `inherits` is true
 * when one of them has no resources of its own and may therefore draw any
 * image the page names.
 */
export function untrackedDrawing(graph: PdfGraph, resources: JsonDict | null): { images: Set<string>; forms: Set<string>; inherits: boolean } {
  const images = new Set<string>()
  const forms = new Set<string>()
  let inherits = false
  // A form can be reached both ways; it is visited once per way.
  const seen = new Set<string>()
  // Resource dictionaries to scan, and whether what they draw is tracked.
  const queue: Array<{ resources: JsonDict | null; tracked: boolean }> = [{ resources, tracked: true }]
  const visit = (ref: JsonValue | undefined, tracked: boolean) => {
    if (!isRef(ref) || seen.has(`${ref}|${tracked}`)) return
    seen.add(`${ref}|${tracked}`)
    const dict = graph.streamDict(ref)
    if (!dict) return
    if (!tracked) forms.add(ref)
    const own = graph.dict(dict['/Resources'])
    if (!own && !tracked) inherits = true
    queue.push({ resources: own, tracked })
  }
  while (queue.length) {
    const { resources: current, tracked } = queue.pop()!
    if (!current) continue
    for (const value of Object.values(graph.dict(current['/XObject']) ?? {})) {
      if (!isRef(value)) continue
      const subtype = graph.name(graph.streamDict(value)?.['/Subtype'])
      if (subtype === '/Image' && !tracked) images.add(value)
      else if (subtype === '/Form') visit(value, tracked)
    }
    for (const state of Object.values(graph.dict(current['/ExtGState']) ?? {})) {
      const mask = graph.dict(graph.dict(state)?.['/SMask'] ?? null)
      if (mask?.['/G'] !== undefined) visit(mask['/G'], false)
    }
    for (const pattern of Object.values(graph.dict(current['/Pattern']) ?? {})) {
      if (isRef(pattern) && graph.streamDict(pattern)) visit(pattern, false)
    }
    for (const font of Object.values(graph.dict(current['/Font']) ?? {})) {
      const dict = graph.dict(font)
      if (graph.name(dict?.['/Subtype']) !== '/Type3') continue
      const own = graph.dict(dict?.['/Resources'] ?? null)
      if (!own) inherits = true
      else queue.push({ resources: own, tracked: false })
    }
  }
  return { images, forms, inherits }
}

/**
 * Walk one page and report every image drawing with its displayed size.
 * Returns null when the page could not be read, so callers can stay
 * conservative about the images on it.
 */
export function placementsForPage(
  graph: PdfGraph,
  page: { number: number; contents: string[]; resources: JsonDict | null },
  source: StreamSource,
  formScales?: Map<string, number>,
): Map<string, Placement[]> | null {
  const result = new Map<string, Placement[]>()
  const parts: Uint8Array[] = []
  for (const ref of page.contents) {
    const data = source(ref)
    if (!data) return null
    parts.push(data)
  }
  // Content arrays are concatenated with whitespace between them.
  const total = parts.reduce((sum, part) => sum + part.byteLength + 1, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    merged[offset + part.byteLength] = 0x0a
    offset += part.byteLength + 1
  }
  const ok = walk(graph, merged, page.resources, IDENTITY, page.number, source, result, [], 0, formScales)
  return ok ? result : null
}

function walk(
  graph: PdfGraph,
  content: Uint8Array,
  resources: JsonDict | null,
  base: Matrix,
  pageNumber: number,
  source: StreamSource,
  result: Map<string, Placement[]>,
  ancestry: string[],
  depth: number,
  formScales?: Map<string, number>,
): boolean {
  if (depth > 16) return false
  const xobjects = resources ? graph.dict(resources['/XObject']) : null
  const stack: Matrix[] = []
  let ctm = base
  for (const event of scanContent(content)) {
    if (event.op === 'q') stack.push(ctm)
    else if (event.op === 'Q') ctm = stack.pop() ?? base
    else if (event.op === 'cm') ctm = multiply(event.matrix, ctm)
    else {
      const ref = xobjects?.[`/${event.name}`]
      if (!isRef(ref)) continue
      const dict = graph.streamDict(ref)
      if (!dict) continue
      const subtype = graph.name(dict['/Subtype'])
      if (subtype === '/Image') {
        const width = Math.hypot(ctm[0], ctm[1])
        const height = Math.hypot(ctm[2], ctm[3])
        if (width > 0 && height > 0) {
          const list = result.get(ref) ?? []
          list.push({ page: pageNumber, width, height })
          result.set(ref, list)
        }
      } else if (subtype === '/Form') {
        if (ancestry.includes(ref)) continue
        const data = source(ref)
        if (!data) return false
        const matrixValues = graph.array(dict['/Matrix'])?.map((value) => graph.number(value))
        const formMatrix = matrixValues && matrixValues.length === 6 && matrixValues.every((value) => value !== null) ? (matrixValues as Matrix) : IDENTITY
        const formResources = graph.dict(dict['/Resources']) ?? resources
        const formCtm = multiply(formMatrix, ctm)
        formScales?.set(ref, Math.max(formScales.get(ref) ?? 0, matrixScale(formCtm)))
        if (!walk(graph, data, formResources, formCtm, pageNumber, source, result, [...ancestry, ref], depth + 1, formScales)) return false
      }
    }
  }
  return true
}

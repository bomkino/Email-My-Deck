import { isRef, type JsonDict, type PdfGraph } from './pdfjson'

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

type Operand = number | { name: string } | null

export type ContentEvent =
  | { op: 'q' }
  | { op: 'Q' }
  | { op: 'cm'; matrix: Matrix }
  | { op: 'Do'; name: string }

/**
 * Tokenise a content stream and report only the operators that change or use
 * the current transformation matrix. Strings, arrays, dictionaries, comments
 * and inline image data are skipped so their bytes are never misread.
 */
export function* scanContent(bytes: Uint8Array): Generator<ContentEvent> {
  const operands: Operand[] = []
  const length = bytes.byteLength
  let index = 0
  while (index < length) {
    const byte = bytes[index]
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
      operands.push(null)
      continue
    }
    if (byte === 0x3c) {
      if (bytes[index + 1] === 0x3c) {
        index += 2
        operands.push(null)
        continue
      }
      while (index < length && bytes[index] !== 0x3e) index += 1
      index += 1
      operands.push(null)
      continue
    }
    if (byte === 0x3e) {
      index += bytes[index + 1] === 0x3e ? 2 : 1
      continue
    }
    if (byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d) {
      index += 1
      operands.push(null)
      continue
    }
    if (byte === 0x2f) {
      let end = index + 1
      while (end < length && !isWhite(bytes[end]) && !isDelimiter(bytes[end])) end += 1
      operands.push({ name: decodeName(bytes, index + 1, end) })
      index = end
      continue
    }
    // A number or an operator keyword.
    let end = index
    while (end < length && !isWhite(bytes[end]) && !isDelimiter(bytes[end])) end += 1
    if (end === index) {
      index += 1
      continue
    }
    const token = ascii(bytes, index, end)
    index = end
    const first = token.charCodeAt(0)
    if ((first >= 0x30 && first <= 0x39) || first === 0x2d || first === 0x2b || first === 0x2e) {
      const value = Number(token)
      operands.push(Number.isFinite(value) ? value : null)
      continue
    }
    if (token === 'BI') {
      index = skipInlineImage(bytes, index)
      operands.length = 0
      continue
    }
    if (token === 'q') yield { op: 'q' }
    else if (token === 'Q') yield { op: 'Q' }
    else if (token === 'cm' && operands.length >= 6) {
      const values = operands.slice(-6)
      if (values.every((value) => typeof value === 'number')) yield { op: 'cm', matrix: values as Matrix }
    } else if (token === 'Do' && operands.length >= 1) {
      const last = operands[operands.length - 1]
      if (last && typeof last === 'object') yield { op: 'Do', name: last.name }
    }
    if (token !== 'true' && token !== 'false' && token !== 'null') operands.length = 0
    else operands.push(null)
  }
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
 * Walk one page and report every image drawing with its displayed size.
 * Returns null when the page could not be read, so callers can stay
 * conservative about the images on it.
 */
export function placementsForPage(
  graph: PdfGraph,
  page: { number: number; contents: string[]; resources: JsonDict | null },
  source: StreamSource,
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
  const ok = walk(graph, merged, page.resources, IDENTITY, page.number, source, result, [], 0)
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
        if (!walk(graph, data, formResources, multiply(formMatrix, ctm), pageNumber, source, result, [...ancestry, ref], depth + 1)) return false
      }
    }
  }
  return true
}

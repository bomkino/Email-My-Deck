/**
 * Helpers for QPDF's JSON v2 object model (`qpdf --json=2 --json-key=qpdf`).
 *
 * Encoding, as QPDF writes it: names are "/Name", references are "12 0 R",
 * strings are "u:text" or "b:hex", dictionaries are objects with "/Key" keys,
 * and every top-level object is either {value} or {stream: {dict}}.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonDict = { [key: string]: JsonValue }

export type QpdfObjectEntry = {
  value?: JsonValue
  stream?: { dict: JsonDict; data?: string; datafile?: string }
}

export type QpdfJsonDocument = {
  version?: number
  pages?: Array<{
    object: string
    contents: string[]
    images: Array<{ object: string; width: number; height: number; filter: string[]; colorspace: JsonValue; bitspercomponent: number; filterable: boolean }>
  }>
  encrypt?: {
    encrypted: boolean
    userpasswordmatched: boolean
    ownerpasswordmatched: boolean
    capabilities: Record<string, boolean>
  }
  acroform?: {
    hasacroform: boolean
    fields: Array<{ fieldtype?: string | null; value?: JsonValue; object?: string }>
  }
  attachments?: Record<string, unknown>
  qpdf?: [{ jsonversion: number; maxobjectid: number }, Record<string, QpdfObjectEntry>]
}

const REF = /^(\d+) (\d+) R$/

export function isRef(value: JsonValue | undefined): value is string {
  return typeof value === 'string' && REF.test(value)
}

export function refNumber(ref: string): number {
  const match = REF.exec(ref)
  if (!match) throw new Error(`Not a reference: ${ref}`)
  return Number(match[1])
}

export function isDict(value: JsonValue | undefined): value is JsonDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class PdfGraph {
  readonly objects: Record<string, QpdfObjectEntry>
  readonly maxObjectId: number

  constructor(objects: Record<string, QpdfObjectEntry>, maxObjectId = 0) {
    this.objects = objects
    this.maxObjectId = maxObjectId
  }

  static fromJson(document: QpdfJsonDocument): PdfGraph {
    const section = document.qpdf
    if (!section) return new PdfGraph({})
    return new PdfGraph(section[1] ?? {}, section[0]?.maxobjectid ?? 0)
  }

  entry(ref: string): QpdfObjectEntry | undefined {
    return this.objects[`obj:${ref}`]
  }

  /** Follow references (bounded) to a direct value. Streams resolve to their dictionary. */
  resolve(value: JsonValue | undefined, depth = 0): JsonValue | undefined {
    if (!isRef(value)) return value
    if (depth > 32) return undefined
    const entry = this.entry(value)
    if (!entry) return undefined
    if (entry.stream) return entry.stream.dict
    return this.resolve(entry.value, depth + 1)
  }

  dict(value: JsonValue | undefined): JsonDict | null {
    const resolved = this.resolve(value)
    return isDict(resolved) ? resolved : null
  }

  array(value: JsonValue | undefined): JsonValue[] | null {
    const resolved = this.resolve(value)
    return Array.isArray(resolved) ? resolved : null
  }

  number(value: JsonValue | undefined): number | null {
    const resolved = this.resolve(value)
    return typeof resolved === 'number' && Number.isFinite(resolved) ? resolved : null
  }

  name(value: JsonValue | undefined): string | null {
    const resolved = this.resolve(value)
    return typeof resolved === 'string' && resolved.startsWith('/') ? resolved : null
  }

  isStream(ref: string): boolean {
    return Boolean(this.entry(ref)?.stream)
  }

  streamDict(ref: string): JsonDict | null {
    return this.entry(ref)?.stream?.dict ?? null
  }

  /** The encoded length of a stream, following an indirect /Length. */
  streamLength(ref: string): number {
    const dict = this.streamDict(ref)
    return dict ? this.number(dict['/Length']) ?? 0 : 0
  }

  /** Visit every dictionary in the file, including direct dictionaries nested inside other objects. */
  *dictionaries(): Generator<JsonDict> {
    const stack: JsonValue[] = []
    for (const entry of Object.values(this.objects)) {
      if (entry.stream) stack.push(entry.stream.dict)
      else if (entry.value !== undefined) stack.push(entry.value)
    }
    while (stack.length) {
      const value = stack.pop()
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === 'object' && item !== null) stack.push(item)
      } else if (isDict(value)) {
        yield value
        for (const item of Object.values(value)) if (typeof item === 'object' && item !== null) stack.push(item)
      }
    }
  }
}

/** Decode a QPDF JSON string value ("u:..." or "b:hex"). */
export function decodePdfString(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string') return null
  if (value.startsWith('u:')) return value.slice(2)
  if (value.startsWith('b:')) {
    const hex = value.slice(2)
    let text = ''
    for (let index = 0; index + 1 < hex.length; index += 2) text += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16))
    return text
  }
  return null
}

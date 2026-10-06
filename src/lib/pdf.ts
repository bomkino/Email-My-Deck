import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'

export type PdfInspection = {
  pages: number
  encrypted: boolean
  hasSignature: boolean
  hasForms: boolean
  hasAttachments: boolean
  hasJavaScript: boolean
  hasCompressedObjects: boolean
  pageSizes: Array<[number, number]>
}

function startsWithAscii(bytes: Uint8Array, value: string): boolean {
  if (bytes.byteLength < value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[index] !== value.charCodeAt(index)) return false
  }
  return true
}

function isPdfNameCharacter(byte: number | undefined): boolean {
  if (byte === undefined) return false
  if (byte <= 0x20) return false
  return ![0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25].includes(byte)
}

function matchesAsciiAt(bytes: Uint8Array, index: number, value: string): boolean {
  if (index < 0 || index + value.length > bytes.byteLength) return false
  for (let offset = 0; offset < value.length; offset += 1) {
    if (bytes[index + offset] !== value.charCodeAt(offset)) return false
  }
  return true
}

/** Find a PDF name without decoding the entire file into a second, giant string. */
export function countPdfName(bytes: Uint8Array, name: string): number {
  const token = `/${name}`
  let count = 0
  for (let index = 0; index <= bytes.byteLength - token.length; index += 1) {
    // Do not inspect compressed/binary stream payloads. Names in object
    // dictionaries and the trailer are structural; random bytes in a JPEG
    // are not evidence that a PDF contains JavaScript or a form.
    if (bytes[index] === 0x73 && (index === 0 || bytes[index - 1] === 0x0a || bytes[index - 1] === 0x0d) && matchesAsciiAt(bytes, index, 'stream') && !isPdfNameCharacter(bytes[index + 6])) {
      let end = index + 6
      while (end < bytes.byteLength && !matchesAsciiAt(bytes, end, 'endstream')) end += 1
      index = end + 8
      continue
    }
    if (bytes[index] !== 0x2f) continue
    let matches = true
    for (let offset = 1; offset < token.length; offset += 1) {
      if (bytes[index + offset] !== token.charCodeAt(offset)) {
        matches = false
        break
      }
    }
    if (matches && !isPdfNameCharacter(bytes[index + token.length])) count += 1
  }
  return count
}

export function hasPdfName(bytes: Uint8Array, name: string): boolean {
  return countPdfName(bytes, name) > 0
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  if (bytes.byteLength < 5 || !startsWithAscii(bytes, '%PDF-')) {
    throw new Error('This file does not look like a PDF.')
  }
  let encrypted = hasPdfName(bytes, 'Encrypt')
  let hasSignature = false
  let hasForms = false
  let hasAttachments = false
  let hasJavaScript = false
  const hasCompressedObjects = hasPdfName(bytes, 'ObjStm')
  let pages = countPdfName(bytes, 'Page')
  let pageSizes: Array<[number, number]> = []
  try {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    encrypted = encrypted || document.isEncrypted
    hasForms = hasPdfName(bytes, 'AcroForm') || hasPdfName(bytes, 'FT')
    try {
      hasForms = hasForms || document.getForm().getFields().length > 0
    } catch {
      // Keep a conservative fallback if the form catalog is unusual.
      hasForms = hasPdfName(bytes, 'AcroForm') || hasPdfName(bytes, 'FT')
    }
    const name = (key: string) => PDFName.of(key)
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue
      const type = object.get(name('Type'))?.toString()
      const fieldType = object.get(name('FT'))?.toString()
      hasSignature = hasSignature || type === '/Sig' || fieldType === '/Sig' || object.has(name('ByteRange'))
      hasAttachments = hasAttachments || type === '/Filespec' || object.has(name('EF')) || object.has(name('EmbeddedFiles'))
      hasJavaScript = hasJavaScript || object.has(name('JS')) || object.has(name('JavaScript')) || object.get(name('S'))?.toString() === '/JavaScript'
    }
    pages = document.getPageCount()
    pageSizes = document.getPages().map((page) => [page.getWidth(), page.getHeight()])
  } catch (error) {
    if (encrypted) return { pages: Math.max(1, pages), encrypted, hasSignature, hasForms, hasAttachments, hasJavaScript, hasCompressedObjects, pageSizes }
    throw error
  }
  return { pages: Math.max(1, pages), encrypted, hasSignature, hasForms, hasAttachments, hasJavaScript, hasCompressedObjects, pageSizes }
}

export async function splitPdf(bytes: Uint8Array, maxPartBytes: number): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages = source.getPageCount()
  if (pages === 0) throw new Error('This PDF has no pages to split.')
  const parts: Uint8Array[] = []

  // Rebuild each candidate from the original page range. pdf-lib can retain
  // removed page resources, which makes an apparently smaller part stay large.
  async function buildPart(start: number, end: number): Promise<Uint8Array> {
    const part = await PDFDocument.create()
    const pagesToCopy = Array.from({ length: end - start }, (_, offset) => start + offset)
    const copiedPages = await part.copyPages(source, pagesToCopy)
    copiedPages.forEach((page) => part.addPage(page))
    return part.save({ useObjectStreams: true, addDefaultPage: false })
  }

  let start = 0
  while (start < pages) {
    const singlePage = await buildPart(start, start + 1)
    if (singlePage.byteLength > maxPartBytes) {
      throw new Error(`Page ${start + 1} is too large to fit this email limit. Try a larger target or export that page as an image.`)
    }
    let low = start + 1
    let high = pages
    let end = start + 1
    let best = singlePage
    while (low <= high) {
      const candidateEnd = Math.floor((low + high) / 2)
      const candidate = await buildPart(start, candidateEnd)
      if (candidate.byteLength <= maxPartBytes) {
        best = candidate
        end = candidateEnd
        low = candidateEnd + 1
      } else {
        high = candidateEnd - 1
      }
    }
    parts.push(best)
    start = end
  }
  return parts
}

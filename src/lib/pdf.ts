import { PDFDocument } from 'pdf-lib'

export type PdfInspection = {
  pages: number
  encrypted: boolean
  hasSignature: boolean
  hasForms: boolean
  hasAttachments: boolean
  hasJavaScript: boolean
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('This file does not look like a PDF.')
  }
  const source = new TextDecoder('latin1').decode(bytes)
  const encrypted = /\/Encrypt\b/.test(source)
  const hasSignature = /\/Type\s*\/Sig\b|\/ByteRange\s*\[/.test(source)
  const hasForms = /\/AcroForm\b|\/FT\s*\//.test(source)
  const hasAttachments = /\/EmbeddedFiles\b|\/FileAttachment\b/.test(source)
  const hasJavaScript = /\/JavaScript\b|\/JS\b/.test(source)
  let pages = (source.match(/\/Type\s*\/Page\b/g) ?? []).length
  try {
    const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    pages = document.getPageCount()
  } catch (error) {
    if (encrypted) return { pages: Math.max(1, pages), encrypted, hasSignature, hasForms, hasAttachments, hasJavaScript }
    throw error
  }
  return { pages: Math.max(1, pages), encrypted, hasSignature, hasForms, hasAttachments, hasJavaScript }
}

export async function splitPdf(bytes: Uint8Array, maxPartBytes: number): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false })
  const pages = source.getPageCount()
  const parts: Uint8Array[] = []
  let current = await PDFDocument.create()

  for (let index = 0; index < pages; index += 1) {
    const [page] = await current.copyPages(source, [index])
    current.addPage(page)
    const candidate = await current.save({ useObjectStreams: true, addDefaultPage: false })
    if (candidate.byteLength > maxPartBytes && current.getPageCount() > 1) {
      current.removePage(current.getPageCount() - 1)
      parts.push(await current.save({ useObjectStreams: true, addDefaultPage: false }))
      current = await PDFDocument.create()
      const [singlePage] = await current.copyPages(source, [index])
      current.addPage(singlePage)
    }
  }
  if (current.getPageCount()) parts.push(await current.save({ useObjectStreams: true, addDefaultPage: false }))
  return parts
}

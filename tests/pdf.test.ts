import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { countPdfName, hasPdfName, inspectPdf, splitPdf } from '../src/lib/pdf'

describe('PDF inspection', () => {
  it('finds structural names without treating stream bytes as features', async () => {
    const streamBytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nstream\nrandom /JavaScript /JS /AcroForm\nendstream\ntrailer\n<< /Encrypt 5 0 R >>')
    expect(countPdfName(streamBytes, 'Page')).toBe(1)
    expect(hasPdfName(streamBytes, 'Encrypt')).toBe(true)
    expect(hasPdfName(streamBytes, 'JavaScript')).toBe(false)
    expect(hasPdfName(streamBytes, 'JS')).toBe(false)
    expect(hasPdfName(streamBytes, 'AcroForm')).toBe(false)
  })

  it('reports page count for a normal generated PDF', async () => {
    const document = await PDFDocument.create()
    document.addPage([600, 400])
    document.addPage([600, 400])
    const bytes = await document.save()
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ pages: 2, encrypted: false, hasForms: false })
  })

  it('detects a form inside an object stream', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([600, 400])
    const field = document.getForm().createTextField('name')
    field.addToPage(page)
    const bytes = await document.save({ useObjectStreams: true })
    await expect(inspectPdf(bytes)).resolves.toMatchObject({ hasForms: true, hasCompressedObjects: true })
  })
})

describe('PDF splitting', () => {
  it('returns fresh, measured parts whose pages add up to the source', async () => {
    const source = await PDFDocument.create()
    for (let index = 0; index < 4; index += 1) source.addPage([600, 400])
    const sourceBytes = await source.save()
    const onePage = await PDFDocument.create()
    onePage.addPage([600, 400])
    const onePageBytes = await onePage.save()
    const parts = await splitPdf(sourceBytes, onePageBytes.byteLength + 20)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => part.byteLength <= onePageBytes.byteLength + 20)).toBe(true)
    let pageTotal = 0
    for (const part of parts) pageTotal += (await PDFDocument.load(part)).getPageCount()
    expect(pageTotal).toBe(4)
  })

  it('rejects a budget smaller than a single page', async () => {
    const source = await PDFDocument.create()
    source.addPage([600, 400])
    await expect(splitPdf(await source.save(), 1)).rejects.toThrow('too large')
  })
})

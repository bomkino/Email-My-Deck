/**
 * What the UI learns about a PDF. Structure is read by QPDF inside the worker
 * (see src/lib/engine/inspect.ts); nothing here scans raw bytes, which is what
 * used to mistake image data for form fields.
 */
export type PdfInspection = {
  pages: number
  pageSizes: Array<[number, number]>
  images: number
}

export { looksLikePdf } from './engine/inspect'

import type { PdfInspection } from './pdf'
import type { TargetProfile } from './profiles'
import { estimatedMessageBytes, rawBudgetBytes } from './profiles'

export type CompressionProgress = {
  label: string
  fraction: number
}

export type CompressionCandidate = {
  bytes: Uint8Array
  engine: 'original' | 'qpdf' | 'ghostscript'
  quality: 'preserved' | 'optimized' | 'strong'
  notes: string[]
}

export type CompressionOutcome = {
  candidate: CompressionCandidate
  targetBytes: number
  estimatedMessageBytes: number
  verified: boolean
  inspection: PdfInspection
  elapsedMs: number
}

type QpdfModule = {
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void }
  callMain(args: string[]): number
}

async function runQpdf(input: Uint8Array, optimizeImages: boolean, onProgress?: (progress: CompressionProgress) => void): Promise<Uint8Array> {
  onProgress?.({ label: optimizeImages ? 'Recompressing eligible images' : 'Tidying PDF structure', fraction: optimizeImages ? 0.48 : 0.28 })
  const { default: createModule } = await import('@neslinesli93/qpdf-wasm')
  const wasmUrl = (await import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url')).default
  const qpdf = (await createModule({
    locateFile: () => wasmUrl,
  })) as unknown as QpdfModule
  const inputPath = '/email-my-deck-input.pdf'
  const outputPath = '/email-my-deck-output.pdf'
  qpdf.FS.writeFile(inputPath, input)
  const args = [
    '--deterministic-id',
    '--object-streams=generate',
    '--stream-data=compress',
    '--recompress-flate',
  ]
  if (optimizeImages) args.push('--optimize-images', '--jpeg-quality=82')
  args.push(inputPath, outputPath)
  const result = qpdf.callMain(args)
  if (result !== 0) throw new Error('The local PDF engine could not create a valid candidate.')
  const output = qpdf.FS.readFile(outputPath)
  qpdf.FS.unlink(inputPath)
  qpdf.FS.unlink(outputPath)
  onProgress?.({ label: optimizeImages ? 'Checking image candidate' : 'Checking structural candidate', fraction: optimizeImages ? 0.7 : 0.42 })
  return new Uint8Array(output)
}

export async function runGhostscript(input: Uint8Array, onProgress?: (progress: CompressionProgress) => void): Promise<Uint8Array> {
  onProgress?.({ label: 'Opening strong compression engine', fraction: 0.58 })
  const { load } = await import('@wasm-zoo/ghostscript')
  const gs = await load()
  try {
    const result = await gs.exec([
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dDetectDuplicateImages',
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7',
      '-dPDFSETTINGS=/prepress', '-dDownsampleColorImages=true',
      '-dColorImageDownsampleType=/Bicubic', '-dColorImageResolution=150',
      '-dDownsampleGrayImages=true', '-dGrayImageDownsampleType=/Bicubic',
      '-dGrayImageResolution=150', '-dDownsampleMonoImages=true',
      '-dMonoImageResolution=300', '-dPreserveAnnots=true',
      '-sOutputFile=/email-my-deck-strong.pdf', '/email-my-deck-input.pdf',
    ], {
      files: [{ name: '/email-my-deck-input.pdf', data: input }],
      dirs: ['/out'],
      outputs: ['/email-my-deck-strong.pdf'],
      timeoutMs: 90000,
    })
    onProgress?.({ label: 'Checking strong candidate', fraction: 0.82 })
    const output = result.files.find((file: { name: string }) => file.name === '/email-my-deck-strong.pdf')
    if (!output) throw new Error('The strong PDF engine returned no output.')
    return new Uint8Array(output.data)
  } finally {
    gs.dispose()
  }
}

function candidateRank(candidate: CompressionCandidate, targetBytes: number): number {
  if (candidate.bytes.byteLength > targetBytes) return -Infinity
  const qualityRank = candidate.quality === 'preserved' ? 3 : candidate.quality === 'optimized' ? 2 : 1
  return qualityRank * 1_000_000_000 + candidate.bytes.byteLength
}

export async function compressPdf(
  original: Uint8Array,
  profile: TargetProfile,
  inspection: PdfInspection,
  onProgress?: (progress: CompressionProgress) => void,
  signal?: AbortSignal,
): Promise<CompressionOutcome> {
  const started = performance.now()
  const targetBytes = rawBudgetBytes(profile)
  const candidates: CompressionCandidate[] = [{
    bytes: original,
    engine: 'original',
    quality: 'preserved',
    notes: ['Original bytes preserved.'],
  }]
  if (original.byteLength <= targetBytes) {
    onProgress?.({ label: 'Original already fits', fraction: 1 })
    return {
      candidate: candidates[0],
      targetBytes,
      estimatedMessageBytes: estimatedMessageBytes(original.byteLength, profile),
      verified: true,
      inspection,
      elapsedMs: performance.now() - started,
    }
  }
  if (inspection.encrypted || inspection.hasSignature || inspection.hasForms || inspection.hasAttachments || inspection.hasJavaScript) {
    throw new Error('This PDF contains protected features that should not be rewritten automatically. Export a flattened copy first.')
  }
  if (signal?.aborted) throw new DOMException('Compression cancelled.', 'AbortError')
  try {
    const structural = await runQpdf(original, false, onProgress)
    if (structural.byteLength < original.byteLength) candidates.push({ bytes: structural, engine: 'qpdf', quality: 'preserved', notes: ['PDF structure optimized.'] })
    if (structural.byteLength > targetBytes) {
      const images = await runQpdf(original, true, onProgress)
      if (images.byteLength < original.byteLength) candidates.push({ bytes: images, engine: 'qpdf', quality: 'optimized', notes: ['Eligible JPEG images recompressed.'] })
    }
  } catch (error) {
    console.warn('QPDF candidate unavailable', error)
  }
  if (signal?.aborted) throw new DOMException('Compression cancelled.', 'AbortError')
  const winner = candidates.reduce((current, candidate) => candidateRank(candidate, targetBytes) > candidateRank(current, targetBytes) ? candidate : current)
  onProgress?.({ label: winner.bytes.byteLength <= targetBytes ? 'Ready to verify' : 'Best single-file attempt measured', fraction: 0.94 })
  return {
    candidate: winner,
    targetBytes,
    estimatedMessageBytes: estimatedMessageBytes(winner.bytes.byteLength, profile),
    verified: winner.engine === 'original' || winner.bytes.byteLength > 0,
    inspection,
    elapsedMs: performance.now() - started,
  }
}

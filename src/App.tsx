import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompressionOutcome } from './lib/compression'
import { ENGINE_FEATURES } from './lib/engine/protocol'
import type { SplitPlan } from './lib/engine/split'
import { emailVersionName } from './lib/filename'
import { estimatedMessageBytes, getTargetProfile, rawBudgetBytes, TARGET_PROFILES, type TargetProfile, type TargetProfileId } from './lib/profiles'
import {
  busyCopy, cantFitCopy, errorCopy, errorKindFor, idleCopy, mailboxCopy, mailboxName, pageTooLargeTitle, protectedCopy, readyCopy, splitCopy,
  stageCopy, stageFor, unsupportedCopy, waitFor, weighInLine, whatFlatteningDid, whatWeDid, type ErrorKind, type Weights,
} from './ui/copy'
import { deckName, formatElapsed, formatSize, percentLighter } from './ui/format'
import { DeckStack, Icon, Meter, Stamp, TipCard, useElapsed, useSmoothProgress, useStatusLine } from './ui/pieces'

type Stage = 'idle' | 'reading' | 'compressing' | 'splitting' | 'flattening' | 'ready' | 'cant-fit' | 'split' | 'error' | 'unsupported'
type Job = 'compress' | 'split' | 'flatten'
type SplitPart = { bytes: Uint8Array; name: string; startPage: number; endPage: number; fits?: boolean }
type Progress = { label: string; fraction: number; stage?: unknown; page?: number; pages?: number }
type ErrorState = { kind: ErrorKind; detail: string; reason?: string; page?: number }
type WayTrouble = { job: 'split' | 'flatten'; kind: ErrorKind }

const MAX_BROWSER_BYTES = 200 * 1024 * 1024
// A job is stopped after this long without any word from the engine. A big
// deck on a slow phone can go quiet for a while and take far longer in total,
// as long as it keeps moving.
const MAX_STALL_MS = 120_000

const positive = (value: unknown) => (Number(value) > 0 ? Number(value) : undefined)

/** What a deck of this size weighs against the mailbox picked. */
function weightsFor(deck: number, profileId: TargetProfileId, profile: TargetProfile): Weights {
  return {
    deck,
    email: estimatedMessageBytes(deck, profile),
    limit: profile.maxMessageBytes,
    budget: rawBudgetBytes(profile),
    mailbox: mailboxName(profileId, profile.maxMessageBytes),
    conditional: Boolean(profile.conditional),
  }
}

/**
 * The lightest single file the engine reached. `bytes` may be a prediction
 * (`estimated`); `measured` is the lightest file it actually built.
 */
function lightestOf(outcome: CompressionOutcome): { bytes: number; estimated: boolean; measured: number } {
  let lightest = { bytes: outcome.receipt?.outputBytes ?? outcome.candidate.bytes.byteLength, estimated: false }
  let measured = lightest.bytes
  for (const attempt of outcome.receipt?.attempts ?? []) {
    if (!(attempt.bytes > 0)) continue
    if (attempt.bytes < lightest.bytes) lightest = { bytes: attempt.bytes, estimated: Boolean(attempt.predicted) }
    if (!attempt.predicted) measured = Math.min(measured, attempt.bytes)
  }
  return { ...lightest, measured }
}

/** The engine's per-page weights for the version that didn't fit, when it sent them. */
function splitPlanOf(outcome: CompressionOutcome): SplitPlan | null {
  const plan = outcome.splitPlan
  if (!plan || !Array.isArray(plan.pageBytes) || plan.pageBytes.length < 2) return null
  return plan
}

/** Estimated size of the part holding slides start..end (1-based, inclusive). */
function partEstimate(plan: SplitPlan, start: number, end: number): number {
  let total = plan.sharedBytes
  for (let page = start; page <= end; page += 1) total += plan.pageBytes[page - 1] ?? 0
  return total
}

/** Page ranges for breaks after the given slides. */
function rangesFor(breaks: number[], pages: number): Array<[number, number]> {
  const edges = [0, ...breaks, pages]
  return edges.slice(1).map((end, index) => [edges[index] + 1, end])
}

/** The fewest parts that each come in under budget, packing slides in order. */
function fewestParts(plan: SplitPlan, budget: number): number {
  let parts = 1
  let start = 1
  for (let page = 1; page <= plan.pageBytes.length; page += 1) {
    if (page > start && partEstimate(plan, start, page) > budget) {
      parts += 1
      start = page
    }
  }
  return Math.max(2, parts)
}

/** Breaks that give `parts` parts of about the same size. */
function evenBreaks(plan: SplitPlan, parts: number): number[] {
  const pages = plan.pageBytes.length
  const total = plan.pageBytes.reduce((sum, bytes) => sum + bytes, 0)
  const breaks: number[] = []
  let running = 0
  for (let page = 1; page < pages && breaks.length < parts - 1; page += 1) {
    const target = (total * (breaks.length + 1)) / parts
    const before = running
    running += plan.pageBytes[page - 1]
    if (running >= target) {
      // Break where the running total lands nearer the target, leaving room for the slides still to place.
      const pick = target - before < running - target && page - 1 > (breaks.at(-1) ?? 0) ? page - 1 : page
      breaks.push(Math.min(pick, pages - (parts - 1 - breaks.length)))
    }
  }
  while (breaks.length < parts - 1) breaks.push(Math.min(pages - 1, (breaks.at(-1) ?? 0) + 1))
  return breaks
}

function browserCanRunEngine(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker === 'function' && typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer === 'function' && typeof URL.createObjectURL === 'function'
}

// A detached link, so the download never bubbles through page-level click
// listeners. The object URL carries no file name. It stays valid for a
// minute: Safari on iPhone asks before downloading, and a URL revoked while
// that question is up gives a failed download.
function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const jobTimeoutRef = useRef<number | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const activeFileRef = useRef<File | null>(null)
  const jobIdRef = useRef(0)
  const jobRef = useRef<Job>('compress')
  const dragDepthRef = useRef(0)
  const [stage, setStage] = useState<Stage>(() => browserCanRunEngine() ? 'idle' : 'unsupported')
  const [file, setFile] = useState<File | null>(null)
  const [profileId, setProfileId] = useState<TargetProfileId>('common-25')
  const [customMessageMB, setCustomMessageMB] = useState(25)
  const [progress, setProgress] = useState<Progress>({ label: '', fraction: 0 })
  const [outcome, setOutcome] = useState<CompressionOutcome | null>(null)
  // The lightest single file, kept while the visitor picks a way to send it.
  const [cantFit, setCantFit] = useState<CompressionOutcome | null>(null)
  const [flattenMiss, setFlattenMiss] = useState<CompressionOutcome | null>(null)
  // A split or flatten that failed, shown on the way that failed.
  const [wayTrouble, setWayTrouble] = useState<WayTrouble | null>(null)
  const [breaks, setBreaks] = useState<number[]>([])
  const [parts, setParts] = useState<SplitPart[]>([])
  const [error, setError] = useState<ErrorState | null>(null)
  const [hoveringZone, setHoveringZone] = useState(false)
  const [draggingPage, setDraggingPage] = useState(false)
  // When the drop zone is on screen it answers the drag itself; the full-page
  // "Drop it anywhere" card only shows when it has scrolled out of sight.
  const [zoneInView, setZoneInView] = useState(false)
  const [workerNonce, setWorkerNonce] = useState(0)
  const [announcement, setAnnouncement] = useState('')

  const profile = useMemo(() => getTargetProfile(profileId, customMessageMB), [profileId, customMessageMB])
  const isBusy = stage === 'reading' || stage === 'compressing' || stage === 'splitting' || stage === 'flattening'
  const stageRef = useRef(stage)
  stageRef.current = stage
  const cantFitRef = useRef(cantFit)
  cantFitRef.current = cantFit

  const clearJobTimeout = useCallback(() => {
    if (jobTimeoutRef.current !== null) {
      window.clearTimeout(jobTimeoutRef.current)
      jobTimeoutRef.current = null
    }
  }, [])

  const fail = useCallback((message: string, code?: unknown, extra: { reason?: unknown; page?: unknown } = {}) => {
    clearJobTimeout()
    const kind = errorKindFor(message, code)
    // A split or flatten that goes wrong goes back to the ways, with a note,
    // on a fresh engine. The deck they already have is still there.
    const job = stageRef.current === 'splitting' ? 'split' : stageRef.current === 'flattening' ? 'flatten' : null
    if (job && cantFitRef.current) {
      workerRef.current?.terminate()
      workerRef.current = null
      setWorkerNonce((nonce) => nonce + 1)
      setWayTrouble({ job, kind })
      setProgress({ label: '', fraction: 0 })
      setStage('cant-fit')
      return
    }
    setError({ kind, detail: message, reason: typeof extra.reason === 'string' ? extra.reason : undefined, page: positive(extra.page) })
    setStage('error')
  }, [clearJobTimeout])

  const armWatchdog = useCallback((jobId: number) => {
    clearJobTimeout()
    // A hidden tab or a sleeping phone pauses the work, so that time doesn't
    // count. Coming back starts the wait again.
    if (document.hidden) return
    jobTimeoutRef.current = window.setTimeout(() => {
      if (jobId !== jobIdRef.current) return
      workerRef.current?.terminate()
      workerRef.current = null
      setWorkerNonce((nonce) => nonce + 1)
      fail('This file took too long.', 'timeout')
    }, MAX_STALL_MS)
  }, [clearJobTimeout, fail])

  // Move focus to the new state's heading, and say it out loud once.
  useEffect(() => {
    if (stage === 'idle') return
    const heading = headingRef.current
    if (heading) {
      heading.focus({ preventScroll: true })
      const rect = heading.getBoundingClientRect()
      if (rect.top < 0 || rect.top > window.innerHeight * 0.6) heading.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      setAnnouncement(heading.textContent ?? '')
    }
  }, [stage])

  useEffect(() => {
    if (stage === 'unsupported') return
    const worker = new Worker(new URL('./workers/pdf.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onerror = () => {
      if (workerRef.current !== worker) return
      fail('The browser PDF engine stopped unexpectedly.', 'engine')
    }
    worker.onmessageerror = () => {
      if (workerRef.current !== worker) return
      fail('The browser could not read the PDF engine result.', 'engine')
    }
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const message = event.data
      const jobId = Number(message.jobId)
      if (jobId !== jobIdRef.current) return
      if (message.type === 'progress') {
        armWatchdog(jobId)
        // The bar never moves backwards within a job, across compress and split.
        setProgress((current) => ({ label: String(message.label ?? ''), fraction: Math.max(current.fraction, Number(message.fraction) || 0), stage: message.stage, page: positive(message.page), pages: positive(message.pages) }))
        return
      }
      if (message.type === 'compress-result') {
        const next = message.outcome as CompressionOutcome
        clearJobTimeout()
        setProgress({ label: '', fraction: 1 })
        if (next.fits ?? next.candidate.bytes.byteLength <= next.targetBytes) {
          setOutcome(next)
          setStage('ready')
        } else if (jobRef.current === 'flatten') {
          setFlattenMiss(next)
          setStage('cant-fit')
        } else {
          // Nothing is split until the visitor picks a way to send it.
          setCantFit(next)
          setFlattenMiss(null)
          setWayTrouble(null)
          setBreaks([])
          setStage('cant-fit')
        }
        return
      }
      if (message.type === 'split-result') {
        clearJobTimeout()
        const source = activeFileRef.current
        const rawParts = message.parts as Array<{ bytes: Uint8Array; pages: number; startPage?: number; endPage?: number; fits?: boolean }>
        let nextPage = 1
        setParts(rawParts.map((part, index) => {
          const startPage = positive(part.startPage) ?? nextPage
          const endPage = positive(part.endPage) ?? startPage + part.pages - 1
          nextPage = endPage + 1
          return { bytes: part.bytes, name: emailVersionName(source?.name ?? 'deck.pdf', { index: index + 1, total: rawParts.length }), startPage, endPage, fits: typeof part.fits === 'boolean' ? part.fits : undefined }
        }))
        setProgress({ label: '', fraction: 1 })
        setStage('split')
        return
      }
      if (message.type === 'error') fail(String(message.message ?? ''), message.code, { reason: message.reason, page: message.page })
    }
    return () => {
      clearJobTimeout()
      worker.terminate()
      workerRef.current = null
    }
  }, [workerNonce, stage === 'unsupported', clearJobTimeout, armWatchdog, fail]) // eslint-disable-line react-hooks/exhaustive-deps

  // While a job runs: the watchdog sleeps when the tab does, the screen stays
  // on where the browser allows it, and leaving the page asks first.
  useEffect(() => {
    if (!isBusy) return
    let lock: { release: () => Promise<void> } | null = null
    let gone = false
    const keepAwake = async () => {
      const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      if (!wakeLock || document.hidden || lock) return
      try {
        const next = await wakeLock.request('screen')
        if (gone) void next.release().catch(() => undefined)
        else { lock = next; (next as unknown as EventTarget).addEventListener?.('release', () => { if (lock === next) lock = null }) }
      } catch { /* Low battery, a policy, or no permission: the job runs anyway. */ }
    }
    const onVisibility = () => {
      if (document.hidden) clearJobTimeout()
      else { armWatchdog(jobIdRef.current); void keepAwake() }
    }
    const onLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    void keepAwake()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onLeave)
      void lock?.release().catch(() => undefined)
      lock = null
    }
  }, [isBusy, armWatchdog, clearJobTimeout])

  const reset = useCallback(() => {
    clearJobTimeout()
    jobIdRef.current += 1
    workerRef.current?.terminate()
    workerRef.current = null
    setWorkerNonce((nonce) => nonce + 1)
    setStage('idle')
    setFile(null)
    activeFileRef.current = null
    setOutcome(null)
    setCantFit(null)
    setFlattenMiss(null)
    setWayTrouble(null)
    setBreaks([])
    setParts([])
    setError(null)
    setProgress({ label: '', fraction: 0 })
    if (inputRef.current) inputRef.current.value = ''
    window.setTimeout(() => document.getElementById('emd-drop')?.focus({ preventScroll: true }), 0)
  }, [clearJobTimeout])

  const chooseFile = useCallback((next: File | undefined, requestedProfileId: TargetProfileId = profileId, requestedCustomMessageMB = customMessageMB) => {
    if (!next || stage === 'unsupported') return
    if (!next.name.toLowerCase().endsWith('.pdf') && next.type !== 'application/pdf') {
      fail('Please choose a PDF.', 'not-pdf')
      return
    }
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    const browserBudget = deviceMemory !== undefined && deviceMemory <= 2 ? 80 * 1024 * 1024 : MAX_BROWSER_BYTES
    if (next.size > browserBudget) {
      fail('This file is larger than the browser memory budget.', 'too-big')
      return
    }
    activeFileRef.current = next
    const jobId = ++jobIdRef.current
    jobRef.current = 'compress'
    armWatchdog(jobId)
    setFile(next)
    setError(null)
    setOutcome(null)
    setCantFit(null)
    setFlattenMiss(null)
    setWayTrouble(null)
    setBreaks([])
    setParts([])
    setStage('reading')
    setProgress({ label: 'Reading this file locally', fraction: 0.06, stage: 'read' })
    window.setTimeout(() => {
      const worker = workerRef.current
      if (!worker || jobId !== jobIdRef.current) return
      setStage('compressing')
      next.arrayBuffer().then((buffer) => {
        if (jobId !== jobIdRef.current || workerRef.current !== worker) return
        setProgress((current) => ({ ...current, fraction: Math.max(current.fraction, 0.14) }))
        // No autoSplit: when it can't fit, the visitor chooses what happens next.
        worker.postMessage({ type: 'compress', jobId, bytes: new Uint8Array(buffer), profileId: requestedProfileId, customMessageMB: requestedCustomMessageMB, autoSplit: false }, [buffer])
      }).catch(() => {
        if (jobId !== jobIdRef.current) return
        fail('The file could not be read in this browser.', 'read')
      })
    }, 0)
  }, [profileId, customMessageMB, stage, armWatchdog, fail])

  // Split the lightest version, after the slides the visitor picked (or
  // wherever fits, when the engine sent no per-page weights).
  const split = useCallback((breakAfter?: number[]) => {
    const worker = workerRef.current
    if (!worker || !cantFit) return
    const jobId = ++jobIdRef.current
    jobRef.current = 'split'
    setWayTrouble(null)
    armWatchdog(jobId)
    if (breakAfter) setBreaks(breakAfter)
    setStage('splitting')
    setProgress({ label: '', fraction: 0, stage: 'split' })
    // A copy goes to the engine, so the visitor can come back and split it differently.
    const bytes = cantFit.candidate.bytes.slice()
    worker.postMessage({ type: 'split', jobId, bytes, maxPartBytes: cantFit.targetBytes, breakAfter }, [bytes.buffer])
  }, [cantFit, armWatchdog])

  // Pages become pictures, then get squeezed. Starts from the original file.
  const flatten = useCallback(() => {
    const worker = workerRef.current
    const source = activeFileRef.current
    if (!worker || !source) return
    const jobId = ++jobIdRef.current
    jobRef.current = 'flatten'
    setWayTrouble(null)
    armWatchdog(jobId)
    setStage('flattening')
    setProgress({ label: '', fraction: 0.02, stage: 'flatten' })
    source.arrayBuffer().then((buffer) => {
      if (jobId !== jobIdRef.current || workerRef.current !== worker) return
      worker.postMessage({ type: 'compress', jobId, bytes: new Uint8Array(buffer), profileId, customMessageMB, mode: 'flatten' }, [buffer])
    }).catch(() => {
      if (jobId !== jobIdRef.current) return
      fail('The file could not be read in this browser.', 'read')
    })
  }, [profileId, customMessageMB, armWatchdog, fail])

  // Back to the three ways. Stops a split or flatten that's still running.
  const backToWays = useCallback(() => {
    jobIdRef.current += 1
    clearJobTimeout()
    if (stage === 'splitting' || stage === 'flattening') {
      workerRef.current?.terminate()
      workerRef.current = null
      setWorkerNonce((nonce) => nonce + 1)
    }
    setProgress({ label: '', fraction: 0 })
    setStage('cant-fit')
  }, [stage, clearJobTimeout])

  // Drop anywhere on the page. Without this, a near-miss opens the PDF in the
  // tab and the visitor loses the page.
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepthRef.current += 1
      if (dragDepthRef.current === 1) {
        const zone = document.getElementById('emd-drop')?.getBoundingClientRect()
        setZoneInView(!!zone && Math.min(zone.bottom, innerHeight) - Math.max(zone.top, 0) >= 160)
      }
      if (!isBusy) setDraggingPage(true)
    }
    const onOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault() }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDraggingPage(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepthRef.current = 0
      setDraggingPage(false)
      setHoveringZone(false)
      if (isBusy) return
      chooseFile(event.dataTransfer?.files[0])
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [chooseFile, isBusy])

  return <div className={`emd ${draggingPage ? 'emd--dragging' : ''}`} data-stage={stage}>
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    {stage === 'unsupported' && <Unsupported headingRef={headingRef} />}
    {(stage === 'idle' || stage === 'error') && <>
      {error && <ErrorNote error={error} headingRef={headingRef} onDismiss={reset} />}
      <section className="emd-step" aria-labelledby="emd-step-where">
        <div className="emd-step-head">
          <span className="emd-step-number" aria-hidden="true">1</span>
          <h2 id="emd-step-where" data-pd-type="title.functional">{idleCopy.stepWhere}</h2>
          <a className="emd-step-aside" href="#mailboxes" data-pd-type="body.small">{idleCopy.stepWhereAside}</a>
        </div>
        <MailboxChoice profileId={profileId} customMessageMB={customMessageMB} onChange={setProfileId} onCustomChange={setCustomMessageMB} />
      </section>
      <section className="emd-step" aria-labelledby="emd-step-drop">
        <div className="emd-step-head">
          <span className="emd-step-number" aria-hidden="true">2</span>
          <h2 id="emd-step-drop" data-pd-type="title.functional">{idleCopy.stepDrop}</h2>
        </div>
        <DropZone dragging={hoveringZone || draggingPage} onHover={setHoveringZone} onChoose={() => inputRef.current?.click()} />
      </section>
      <p className="emd-step-after" data-pd-type="body.small"><span className="emd-step-number emd-step-number--quiet" aria-hidden="true">3</span>{idleCopy.stepAfter}</p>
      <input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf" tabIndex={-1} aria-hidden="true" onChange={(event) => chooseFile(event.target.files?.[0])} />
    </>}
    {isBusy && file && <Busy file={file} stage={stage} progress={progress} weights={weightsFor(file.size, profileId, profile)} headingRef={headingRef} onCancel={cantFit && (stage === 'splitting' || stage === 'flattening') ? backToWays : reset} />}
    {stage === 'ready' && file && outcome && <Ready
      file={file} outcome={outcome} profileId={profileId} weights={weightsFor(file.size, profileId, profile)} headingRef={headingRef}
      onStricter={() => { setProfileId('strict-20'); chooseFile(file, 'strict-20', customMessageMB) }}
      onWays={cantFit ? backToWays : undefined}
      onReset={reset}
    />}
    {stage === 'cant-fit' && file && cantFit && <CantFit
      outcome={cantFit} flattenMiss={flattenMiss} trouble={wayTrouble} breaks={breaks} profileId={profileId} weights={weightsFor(file.size, profileId, profile)} headingRef={headingRef}
      onGmail={() => { setProfileId('gmail-advanced'); chooseFile(file, 'gmail-advanced', customMessageMB) }}
      onSplit={split} onFlatten={flatten} onReset={reset}
    />}
    {stage === 'split' && file && <Parts
      file={file} parts={parts} budget={cantFit?.targetBytes ?? 0} weights={weightsFor(file.size, profileId, profile)} headingRef={headingRef}
      onWays={cantFit ? backToWays : undefined} onReset={reset}
    />}
    {draggingPage && !((stage === 'idle' || stage === 'error') && zoneInView) && (stage === 'idle' || stage === 'error' || stage === 'ready' || stage === 'cant-fit' || stage === 'split') && <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay-card"><DeckStack label="your-deck.pdf" state="hover" /><strong data-pd-type="heading.subsection">{idleCopy.dropAnywhere}</strong><span data-pd-type="body.default">{idleCopy.dropAnywhereNote}</span></div>
    </div>}
  </div>
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>

function ErrorNote({ error: { kind, detail, reason, page }, headingRef, onDismiss }: { error: ErrorState; headingRef: HeadingRef; onDismiss: () => void }) {
  const copy = errorCopy[kind]
  const title = kind === 'page-too-large' && page ? pageTooLargeTitle(page) : copy.title
  const body = kind === 'protected' && reason && reason in protectedCopy ? protectedCopy[reason] : copy.body
  return <div className="note note--error" role="alert">
    <div>
      <h2 ref={headingRef} tabIndex={-1} data-pd-type="title.card">{title}</h2>
      <p data-pd-type="body.default">{body}</p>
      {kind === 'unknown' && detail && <p className="note-detail" data-pd-type="body.small">{detail}</p>}
    </div>
    <button className="icon-button" type="button" onClick={onDismiss} aria-label="Dismiss and start again"><Icon name="close" size={18} /></button>
  </div>
}

/** True on phones and tablets, where nothing gets dragged and "drop" means nothing. */
function useCoarsePointer() {
  const query = '(hover: none) and (pointer: coarse)'
  const [coarse, setCoarse] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const list = matchMedia(query)
    const update = () => setCoarse(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])
  return coarse
}

/**
 * The big target. It breathes while it waits, shows a ghost deck dropping in
 * a few times so the gesture explains itself, leans toward the pointer, and
 * fans the cards out when a file is over it.
 */
function DropZone({ dragging, onHover, onChoose }: { dragging: boolean; onHover: (value: boolean) => void; onChoose: () => void }) {
  const coarse = useCoarsePointer()
  const [touched, setTouched] = useState(false)
  const zoneRef = useRef<HTMLButtonElement>(null)
  const lean = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse' || !zoneRef.current) return
    const box = zoneRef.current.getBoundingClientRect()
    zoneRef.current.style.setProperty('--lean-x', (((event.clientX - box.left) / box.width) * 2 - 1).toFixed(3))
    zoneRef.current.style.setProperty('--lean-y', (((event.clientY - box.top) / box.height) * 2 - 1).toFixed(3))
  }
  const settle = () => {
    zoneRef.current?.style.setProperty('--lean-x', '0')
    zoneRef.current?.style.setProperty('--lean-y', '0')
  }
  return <button
    ref={zoneRef}
    id="emd-drop"
    className={`dropzone ${dragging ? 'dropzone--hover' : ''} ${touched ? '' : 'dropzone--demo'} ${coarse ? 'dropzone--touch' : ''}`}
    onClick={onChoose}
    onPointerEnter={() => setTouched(true)}
    onPointerMove={lean}
    onPointerLeave={settle}
    onFocus={() => setTouched(true)}
    onDragEnter={() => { setTouched(true); onHover(true) }}
    onDragLeave={() => onHover(false)}
    type="button"
    aria-describedby="emd-drop-note"
  >
    <svg className="dropzone-edge" aria-hidden="true" focusable="false"><rect x="0" y="0" width="100%" height="100%" /></svg>
    <span className="dropzone-art">
      <DeckStack label="your-deck.pdf" state={dragging ? 'hover' : 'idle'} />
      <span className="dropzone-ghost" aria-hidden="true">
        <span className="deck-card-title" /><span className="deck-card-line" /><span className="deck-card-label">pitch.pdf</span>
        <svg className="dropzone-cursor" viewBox="0 0 24 24" focusable="false"><path d="M5 2.5 19 13l-6.4 1.2-3.6 6.3z" /></svg>
      </span>
    </span>
    <span className="dropzone-title" data-pd-type="heading.subsection">{dragging ? idleCopy.dragging : coarse ? idleCopy.titleTouch : idleCopy.title}</span>
    {!coarse && <span className="dropzone-or" data-pd-type="metadata">or</span>}
    <span className="button button--brand button--large"><Icon name="file" size={20} />{idleCopy.choose}</span>
    <span className="dropzone-note" id="emd-drop-note" data-pd-type="body.small">{idleCopy.note}</span>
  </button>
}

/** Where the deck is going, out in the open: four big choices, one already picked. */
function MailboxChoice({ profileId, customMessageMB, onChange, onCustomChange }: { profileId: TargetProfileId; customMessageMB: number; onChange: (value: TargetProfileId) => void; onCustomChange: (value: number) => void }) {
  const ids: TargetProfileId[] = ['common-25', 'strict-20', 'gmail-advanced', 'custom']
  const budget = (id: TargetProfileId) => id === 'custom' ? '' : `about ${formatSize(TARGET_PROFILES[id].recommendedRawBytes)}`
  const current = mailboxCopy[profileId]
  return <fieldset className="choices">
    <legend className="sr-only">{idleCopy.stepWhere}</legend>
    <div className="choice-row">
      {ids.map((id) => <label className={`choice ${profileId === id ? 'choice--on' : ''}`} key={id}>
        <input type="radio" name="emd-profile" value={id} checked={profileId === id} onChange={() => onChange(id)} aria-describedby={profileId === id ? 'emd-choice-detail' : undefined} />
        <span className="choice-tick" aria-hidden="true"><Icon name="check" size={14} /></span>
        <span className="choice-label" data-pd-type="label">{mailboxCopy[id].label}</span>
        <span className="choice-hint" data-pd-type="body.small">{mailboxCopy[id].hint}</span>
        {mailboxCopy[id].badge && <em className="badge choice-badge">{mailboxCopy[id].badge}</em>}
      </label>)}
    </div>
    <div className="choice-detail" id="emd-choice-detail" key={profileId}>
      {profileId === 'custom'
        ? <span className="custom-input">
            <label htmlFor="emd-custom-mb" data-pd-type="body.small">{current.detail('')}</label>
            <input id="emd-custom-mb" type="number" inputMode="decimal" min="5" max="70" defaultValue={customMessageMB}
              onChange={(event) => { const parsed = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(parsed)) onCustomChange(Math.min(70, Math.max(5, parsed))) }}
              onBlur={(event) => { const parsed = Number(event.target.value); const next = Math.min(70, Math.max(5, Number.isFinite(parsed) && parsed > 0 ? parsed : 5)); event.currentTarget.value = String(next); onCustomChange(next) }} />
            <span data-pd-type="metadata">MB</span>
          </span>
        : <p data-pd-type="body.small">{current.detail(budget(profileId))} <a href="#mailboxes">Why it matters</a></p>}
    </div>
  </fieldset>
}

function Busy({ file, stage, progress, weights, headingRef, onCancel }: { file: File; stage: Stage; progress: Progress; weights: Weights; headingRef: HeadingRef; onCancel: () => void }) {
  const shown = useSmoothProgress(progress.fraction, true)
  const elapsed = useElapsed(true)
  const key = stage === 'splitting' ? 'split' : stageFor(progress.label, progress.stage) ?? (stage === 'flattening' ? 'flatten' : null)
  const words = key ? stageCopy[key] : progress.label || stageCopy.work
  const label = progress.page && progress.pages && (key === 'photos' || key === 'sharpen' || key === 'split' || key === 'flatten') ? `${words} · slide ${progress.page} of ${progress.pages}` : words
  const percent = Math.round(shown * 100)
  const status = useStatusLine(key, label)
  return <section className="panel panel--busy" aria-busy="true" aria-labelledby="emd-busy-title">
    <div className="busy-file">
      <span className="busy-file-icon"><Icon name="file" size={22} /></span>
      <span className="busy-file-name" data-pd-type="label">{file.name}</span>
      <span data-pd-type="data">{formatSize(file.size)}</span>
    </div>
    <p className="eyebrow" data-pd-type="metadata"><span className="pulse-dot" aria-hidden="true" />{busyCopy.eyebrow}</p>
    <h2 id="emd-busy-title" ref={headingRef} tabIndex={-1} data-pd-type="heading.subsection">{stage === 'splitting' ? busyCopy.splittingTitle : stage === 'flattening' ? busyCopy.flatteningTitle : busyCopy.workingTitle}</h2>
    {stage !== 'splitting' && <p className="busy-weigh" data-pd-type="body.default">{weighInLine(weights)}</p>}
    <div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%. ${label}`}>
      <span className="progress-fill" style={{ '--progress': shown } as React.CSSProperties} />
    </div>
    <div className="progress-meta" data-pd-type="data"><span className={`progress-label${status.real ? '' : ' progress-label--aside'}`} key={status.text}>{status.text}</span><span>{percent}% · {formatElapsed(elapsed)}</span></div>
    <p className="busy-note" key={waitFor(elapsed)} data-pd-type="body.small">{waitFor(elapsed)}</p>
    <TipCard stage={key} />
    <button className="text-button busy-cancel" onClick={onCancel} type="button">{busyCopy.cancel}</button>
  </section>
}

function Ready({ file, outcome, profileId, weights, headingRef, onStricter, onWays, onReset }: { file: File; outcome: CompressionOutcome; profileId: TargetProfileId; weights: Weights; headingRef: HeadingRef; onStricter: () => void; onWays?: () => void; onReset: () => void }) {
  const [downloaded, setDownloaded] = useState(false)
  const untouched = outcome.candidate.engine === 'original'
  const flattened = (outcome.candidate.engine as string) === 'flattened'
  const outputBytes = outcome.candidate.bytes.byteLength
  const outputName = emailVersionName(file.name)
  const lighter = percentLighter(file.size, outputBytes)
  const flatten = (outcome.receipt as CompressionOutcome['receipt'] & { flatten?: { pages: number; longEdgePx?: number } }).flatten
  const did = untouched ? [] : flattened ? whatFlatteningDid(flatten, outcome.inspection.pages) : whatWeDid(outcome)
  const save = () => { download(outcome.candidate.bytes, outputName); setDownloaded(true) }
  return <section className="panel panel--ready" aria-labelledby="emd-ready-title">
    <div className="ready-top">
      <DeckStack label={outputName} state="done" />
      <Stamp text={untouched ? readyCopy.stampFits : readyCopy.stamp} />
    </div>
    <p className="eyebrow" data-pd-type="metadata">{readyCopy.eyebrow}</p>
    <h2 id="emd-ready-title" ref={headingRef} tabIndex={-1} data-pd-type="heading.subsection">{untouched ? readyCopy.fitsTitle : readyCopy.title}</h2>
    {untouched
      ? <p className="ready-lede" data-pd-type="body.default">{readyCopy.fitsBody} {readyCopy.fitsWeight(weights)}</p>
      : <><p className="ready-lede" data-pd-type="body.default">{flattened ? readyCopy.flattened(weights) : readyCopy.madeRoom(weights)}</p><div className="receipt">
        <div className="receipt-sizes">
          <span className="receipt-before" data-pd-type="data"><s>{formatSize(file.size)}</s></span>
          <Icon name="arrow" size={22} />
          <strong className="receipt-after">{formatSize(outputBytes)}</strong>
          {lighter > 0 && <span className="chip" data-pd-type="metadata">{lighter}% lighter</span>}
        </div>
        <ul className="receipt-list" data-pd-type="body.default">
          {did.map((line) => <li key={line}><Icon name="check" size={16} />{line}</li>)}
          <li><Icon name="check" size={16} />{readyCopy.sameSlides(outcome.inspection.pages)}</li>
        </ul>
      </div></>}
    <Meter used={outcome.estimatedMessageBytes} limit={weights.limit} label="Room in the email" />
    {weights.conditional && <p className="note note--warn" data-pd-type="body.small">{readyCopy.conditional}</p>}
    <div className="actions">
      {untouched
        ? <button className="button" onClick={save} type="button"><Icon name="download" size={18} />{downloaded ? readyCopy.downloadAgain : readyCopy.downloadOriginal}</button>
        : <button className="button button--brand button--large" onClick={save} type="button"><Icon name="download" size={19} />{downloaded ? readyCopy.downloadAgain : readyCopy.download}</button>}
      <span className="file-name" data-pd-type="data">{outputName}</span>
    </div>
    {downloaded && <p className="farewell" data-pd-type="body.default">{readyCopy.downloadedNote} <em data-pd-emphasis="head-italic">{readyCopy.farewell}</em></p>}
    {flattened && onWays && <p className="ready-alt" data-pd-type="body.small">{readyCopy.rather} <button className="text-button" type="button" onClick={onWays}>{readyCopy.ratherAction}</button></p>}
    {profileId !== 'strict-20' && !untouched && !flattened && <p className="ready-alt" data-pd-type="body.small">{readyCopy.stricter} <button className="text-button" type="button" onClick={onStricter}>{readyCopy.stricterAction}</button></p>}
    <button className="text-button start-over" onClick={onReset} type="button">{readyCopy.startOver}</button>
  </section>
}

function CantFit({ outcome, flattenMiss, trouble, breaks, profileId, weights, headingRef, onGmail, onSplit, onFlatten, onReset }: {
  outcome: CompressionOutcome; flattenMiss: CompressionOutcome | null; trouble: WayTrouble | null; breaks: number[]; profileId: TargetProfileId; weights: Weights; headingRef: HeadingRef
  onGmail: () => void; onSplit: (breakAfter?: number[]) => void; onFlatten: () => void; onReset: () => void
}) {
  const reason = outcome.splitReason
  const lightest = lightestOf(outcome)
  const sizeText = (found: { bytes: number; estimated: boolean }) => `${found.estimated ? 'about ' : ''}${formatSize(found.bytes)}`
  // Worth a second run only if a file we actually built would clear Gmail's
  // bigger allowance. A prediction alone could send them round in a circle.
  const gmailBudget = TARGET_PROFILES['gmail-advanced'].recommendedRawBytes
  const tryGmail = profileId !== 'gmail-advanced' && reason !== 'browser-cannot-resize' && weights.budget < gmailBudget && lightest.measured <= gmailBudget
  // The page's send-a-link guide, when the page around the tool has one.
  const hasGuide = Boolean(document.getElementById('send-a-link'))
  return <section className="panel panel--split" aria-labelledby="emd-split-title">
    <p className="eyebrow" data-pd-type="metadata">{cantFitCopy.eyebrow}</p>
    <h2 id="emd-split-title" ref={headingRef} tabIndex={-1} data-pd-type="heading.subsection">{cantFitCopy.title}</h2>
    <p className="ready-lede" data-pd-type="body.default">{cantFitCopy.reason(reason, sizeText(lightest), weights, outcome.weight)}</p>
    {tryGmail && <p className="ready-alt" data-pd-type="body.small">{cantFitCopy.gmailHint} <button className="text-button" type="button" onClick={onGmail}>{cantFitCopy.gmailAction}</button></p>}
    <p className="ways-intro" data-pd-type="title.functional">{cantFitCopy.ways(ENGINE_FEATURES.flatten ? 3 : 2)}</p>

    <div className="way way--pick">
      <h3 className="way-title" data-pd-type="title.card"><span className="way-number" data-pd-type="data">1</span>{cantFitCopy.linkTitle}<em className="badge">{cantFitCopy.linkBadge}</em></h3>
      <p data-pd-type="body.default">{cantFitCopy.linkBody}</p>
      {hasGuide && <a className="way-more" href="#send-a-link" data-pd-type="body.small">{cantFitCopy.linkMore}<Icon name="arrow" size={16} /></a>}
    </div>

    <SplitChooser outcome={outcome} initial={breaks} weights={weights} trouble={trouble?.job === 'split' ? trouble.kind : null} onSplit={onSplit} />

    {ENGINE_FEATURES.flatten && <div className="way way--last">
      <h3 className="way-title" data-pd-type="title.card"><span className="way-number" data-pd-type="data">3</span>{cantFitCopy.flattenTitle}<em className="badge badge--quiet">{cantFitCopy.flattenBadge}</em></h3>
      {trouble?.job === 'flatten'
        ? <p className="note note--warn" role="status" data-pd-type="body.default">{cantFitCopy.flattenTrouble(trouble.kind)}</p>
        : flattenMiss
        ? <p className="note note--warn" role="status" data-pd-type="body.default">{cantFitCopy.flattenMiss(sizeText(lightestOf(flattenMiss)), weights)}</p>
        : <>
          <p data-pd-type="body.default">{cantFitCopy.flattenBody}</p>
          <ul className="way-costs" data-pd-type="body.default">{cantFitCopy.flattenCosts.map((cost) => <li key={cost}>{cost}</li>)}</ul>
          <p data-pd-type="body.small">{cantFitCopy.flattenMaybe}</p>
          <div className="actions"><button className="button" type="button" onClick={onFlatten}>{cantFitCopy.flattenAction}</button></div>
        </>}
    </div>}
    <button className="text-button start-over" onClick={onReset} type="button">{readyCopy.startOver}</button>
  </section>
}

function SplitChooser({ outcome, initial, weights, trouble, onSplit }: { outcome: CompressionOutcome; initial: number[]; weights: Weights; trouble: ErrorKind | null; onSplit: (breakAfter?: number[]) => void }) {
  const plan = useMemo(() => splitPlanOf(outcome), [outcome])
  const budget = outcome.targetBytes
  const pages = plan?.pageBytes.length ?? outcome.inspection.pages
  const suggested = useMemo(() => plan ? evenBreaks(plan, Math.min(pages, fewestParts(plan, budget))) : [], [plan, pages, budget])
  const [breaks, setBreaks] = useState<number[]>(() => initial.length && initial.every((page) => page < pages) ? initial : suggested)
  const count = plan ? breaks.length + 1 : 2
  const ranges = rangesFor(breaks, pages)
  const sizes = plan ? ranges.map(([start, end]) => partEstimate(plan, start, end)) : []
  const over = sizes.findIndex((bytes) => bytes > budget)
  const move = (index: number, value: number) => setBreaks((current) => current.map((page, at) => at === index ? value : page))
  return <div className="way">
    <h3 className="way-title" data-pd-type="title.card"><span className="way-number" data-pd-type="data">2</span>{cantFitCopy.partsTitle(count)}</h3>
    <p data-pd-type="body.default">{cantFitCopy.partsBody}</p>
    {plan && <>
      <p data-pd-type="body.small">{cantFitCopy.partsEven(count)}</p>
      {breaks.map((page, index) => {
        const min = (breaks[index - 1] ?? 0) + 1
        const max = (breaks[index + 1] ?? pages) - 1
        const id = `emd-break-${index + 1}`
        return <div className="split-break" key={id}>
          <label htmlFor={id} data-pd-type="label">{cantFitCopy.breakLabel(index + 1, count)} <strong data-pd-type="data">{page}</strong></label>
          <input id={id} type="range" min={min} max={max} step={1} value={page} disabled={min >= max}
            aria-valuetext={`After slide ${page}`} onChange={(event) => move(index, Number(event.target.value))} />
        </div>
      })}
      <ol className="split-preview" data-pd-type="body.small">
        {ranges.map(([start, end], index) => <li key={`${start}-${end}`} className={sizes[index] > budget ? 'split-preview-over' : undefined}>
          <span>{cantFitCopy.partLine(index + 1, start, end)}</span>
          <span data-pd-type="data">about {formatSize(sizes[index])}{sizes[index] > budget && <em className="badge badge--warn">{cantFitCopy.partOver}</em>}</span>
        </li>)}
      </ol>
      {over >= 0 && <p className="note note--warn" role="status" data-pd-type="body.small">{cantFitCopy.partsOver(over + 1, formatSize(weights.budget))}</p>}
    </>}
    {trouble && <p className="note note--warn" role="status" data-pd-type="body.default">{cantFitCopy.splitTrouble(trouble)}</p>}
    <div className="actions">
      <button className="button" type="button" disabled={over >= 0} onClick={() => onSplit(plan ? breaks : undefined)}>{plan ? cantFitCopy.splitHere : cantFitCopy.splitForMe}</button>
    </div>
  </div>
}

function Parts({ file, parts, budget, weights, headingRef, onWays, onReset }: { file: File; parts: SplitPart[]; budget: number; weights: Weights; headingRef: HeadingRef; onWays?: () => void; onReset: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const name = deckName(file.name)
  const overBudget = (part: SplitPart) => part.fits === false || (budget > 0 && part.bytes.byteLength > budget)
  const anyOver = parts.some(overBudget)
  const plan = parts.map((part, index) => `Email ${index + 1} of ${parts.length}\nSubject: ${splitCopy.subject(name, index + 1, parts.length)}\nAttach: ${part.name}\n\n${splitCopy.emailBody(name, index + 1, parts.length, part.startPage, part.endPage)}`).join('\n—\n\n')
  const downloadAll = () => parts.forEach((part, index) => window.setTimeout(() => download(part.bytes, part.name), index * 450))
  return <section className="panel panel--split" aria-labelledby="emd-parts-title">
    <p className="eyebrow" data-pd-type="metadata">{splitCopy.eyebrow(parts.length)}</p>
    <h2 id="emd-parts-title" ref={headingRef} tabIndex={-1} data-pd-type="heading.subsection">{splitCopy.title}</h2>
    {!anyOver && <p className="ready-lede" data-pd-type="body.default">{splitCopy.body(parts.length, weights.mailbox)}</p>}
    <ol className="parts">
      {parts.map((part, index) => <li className={`part${overBudget(part) ? ' part--over' : ''}`} key={part.name}>
        <span className="part-number" data-pd-type="data">{String(index + 1).padStart(2, '0')}</span>
        <span className="part-info"><strong data-pd-type="label">{part.name}</strong><span data-pd-type="data">{formatSize(part.bytes.byteLength)} · {part.startPage === part.endPage ? `slide ${part.startPage}` : `slides ${part.startPage}–${part.endPage}`}</span>
          {overBudget(part) && <span className="part-warn" data-pd-type="body.small">{splitCopy.partOver(formatSize(weights.budget))}</span>}
        </span>
        <button className="button button--small" onClick={() => download(part.bytes, part.name)} type="button" aria-label={`Download part ${index + 1}`}><Icon name="download" size={16} />{splitCopy.download}</button>
      </li>)}
    </ol>
    <div className="actions">
      <button className="button button--brand" type="button" onClick={downloadAll}><Icon name="download" size={18} />{splitCopy.downloadAll(parts.length)}</button>
      {onWays && <button className="text-button" type="button" onClick={onWays}>{splitCopy.change}</button>}
    </div>
    <div className="plan">
      <div className="plan-head"><strong data-pd-type="title.functional">{splitCopy.planTitle}</strong>
        <button className="button button--small" type="button" onClick={async () => { const ok = await copyText(plan); setCopied(ok ? 'done' : 'failed'); if (ok) window.setTimeout(() => setCopied('idle'), 2200) }}><Icon name={copied === 'done' ? 'check' : 'copy'} size={16} />{copied === 'done' ? splitCopy.copied : splitCopy.copy}</button>
      </div>
      <p data-pd-type="body.small">{copied === 'failed' ? splitCopy.copyFailed : splitCopy.planIntro}</p>
      <pre className="plan-text" tabIndex={0} data-pd-type="data">{plan}</pre>
    </div>
    <button className="text-button start-over" onClick={onReset} type="button">{readyCopy.startOver}</button>
  </section>
}

function Unsupported({ headingRef }: { headingRef: HeadingRef }) {
  const [copied, setCopied] = useState(false)
  return <section className="panel panel--unsupported" aria-labelledby="emd-unsupported-title">
    <DeckStack label="your-deck.pdf" state="idle" />
    <h2 id="emd-unsupported-title" ref={headingRef} tabIndex={-1} data-pd-type="title.card">{unsupportedCopy.title}</h2>
    <p data-pd-type="body.default">{unsupportedCopy.body}</p>
    <button className="button" type="button" onClick={async () => setCopied(await copyText(location.href))}><Icon name={copied ? 'check' : 'link'} size={18} />{copied ? unsupportedCopy.copied : unsupportedCopy.copyLink}</button>
  </section>
}

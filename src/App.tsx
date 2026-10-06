import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CompressionOutcome } from './lib/compression'
import { emailVersionName } from './lib/filename'
import { formatBytes } from './lib/format'
import { getTargetProfile, TARGET_PROFILES, type TargetProfileId } from './lib/profiles'

type Stage = 'idle' | 'reading' | 'compressing' | 'splitting' | 'ready' | 'split' | 'error'
type SplitPart = { bytes: Uint8Array; name: string; startPage: number; endPage: number }

const MAX_BROWSER_BYTES = 200 * 1024 * 1024
const MAX_JOB_MS = 120_000

function Icon({ name, size = 24 }: { name: 'file' | 'download' | 'check' | 'arrow' | 'copy' | 'help' | 'spark'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'file') return <svg {...common}><path d="M14 2H6.8A1.8 1.8 0 0 0 5 3.8v16.4A1.8 1.8 0 0 0 6.8 22h10.4a1.8 1.8 0 0 0 1.8-1.8V7z" /><path d="M14 2v5h5M8.5 13.5h7M8.5 17h5" /></svg>
  if (name === 'download') return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20.5h16" /></svg>
  if (name === 'check') return <svg {...common}><path d="m5 12 4.2 4.2L19 6.5" /></svg>
  if (name === 'arrow') return <svg {...common}><path d="M5 12h13m-5-5 5 5-5 5" /></svg>
  if (name === 'copy') return <svg {...common}><rect x="8" y="8" width="11" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" /></svg>
  if (name === 'help') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.7 9.3a2.4 2.4 0 1 1 3.8 1.9c-.9.6-1.5 1-1.5 2.3m0 2.6h.01" /></svg>
  return <svg {...common}><path d="m12 2 1.4 6.1L19 10l-5.6 1.9L12 18l-1.4-6.1L5 10l5.6-1.9zM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6z" /></svg>
}

function bytesWithUnit(bytes: number): string {
  return formatBytes(bytes)
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const modalCloseRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const howTriggerRef = useRef<HTMLButtonElement>(null)
  const wasHowOpenRef = useRef(false)
  const jobTimeoutRef = useRef<number | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const activeFileRef = useRef<File | null>(null)
  const jobIdRef = useRef(0)
  const [stage, setStage] = useState<Stage>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [profileId, setProfileId] = useState<TargetProfileId>('common-25')
  const [customMessageMiB, setCustomMessageMiB] = useState(25)
  const [progress, setProgress] = useState({ label: '', fraction: 0 })
  const [outcome, setOutcome] = useState<CompressionOutcome | null>(null)
  const [parts, setParts] = useState<SplitPart[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [showHow, setShowHow] = useState(false)
  const [showChanged, setShowChanged] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [workerNonce, setWorkerNonce] = useState(0)

  const profile = useMemo(() => getTargetProfile(profileId, customMessageMiB), [profileId, customMessageMiB])
  const isBusy = stage === 'reading' || stage === 'compressing' || stage === 'splitting'

  function clearJobTimeout() {
    if (jobTimeoutRef.current !== null) {
      window.clearTimeout(jobTimeoutRef.current)
      jobTimeoutRef.current = null
    }
  }

  useLayoutEffect(() => {
    if (!showHow) return
    wasHowOpenRef.current = true
    modalCloseRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowHow(false)
      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showHow])

  useLayoutEffect(() => {
    if (!showHow && wasHowOpenRef.current) {
      wasHowOpenRef.current = false
      howTriggerRef.current?.focus()
    }
  }, [showHow])

  useEffect(() => {
    const worker = new Worker(new URL('./workers/pdf.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onerror = () => {
      if (workerRef.current !== worker) return
      clearJobTimeout()
      setError('The browser PDF engine stopped unexpectedly. Try the file again or split it in your PDF app first.')
      setStage('error')
    }
    worker.onmessageerror = () => {
      if (workerRef.current !== worker) return
      clearJobTimeout()
      setError('The browser could not read the PDF engine result. Try the file again.')
      setStage('error')
    }
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const message = event.data
      if (Number(message.jobId) !== jobIdRef.current) return
      if (message.type === 'progress') {
        setProgress({ label: String(message.label), fraction: Number(message.fraction) })
        return
      }
      if (message.type === 'compress-result') {
        const next = message.outcome as CompressionOutcome
        setOutcome(next)
        if (next.candidate.bytes.byteLength <= next.targetBytes) {
          clearJobTimeout()
          setStage('ready')
          setProgress({ label: 'Verified locally', fraction: 1 })
        } else {
          setStage('splitting')
          setProgress({ label: 'Preparing measured split parts', fraction: 0.99 })
          worker.postMessage({ type: 'split', jobId: jobIdRef.current, bytes: next.candidate.bytes, maxPartBytes: next.targetBytes }, [next.candidate.bytes.buffer])
        }
        return
      }
      if (message.type === 'split-result') {
        clearJobTimeout()
        const source = activeFileRef.current
        const rawParts = message.parts as Array<{ bytes: Uint8Array; pages: number }>
        if (message.outcome) setOutcome(message.outcome as CompressionOutcome)
        let startPage = 1
        setParts(rawParts.map((part, index) => {
          const next = { bytes: part.bytes, name: emailVersionName(source?.name ?? 'deck.pdf', { index: index + 1, total: rawParts.length }), startPage, endPage: startPage + part.pages - 1 }
          startPage += part.pages
          return next
        }))
        setStage('split')
        setProgress({ label: 'Parts verified locally', fraction: 1 })
        return
      }
      if (message.type === 'error') {
        clearJobTimeout()
        setError(String(message.message))
        setStage('error')
      }
    }
    return () => {
      clearJobTimeout()
      worker.terminate()
      workerRef.current = null
    }
  }, [workerNonce])

  function reset() {
    clearJobTimeout()
    jobIdRef.current += 1
    workerRef.current?.terminate()
    workerRef.current = null
    setWorkerNonce((nonce) => nonce + 1)
    setStage('idle')
    setFile(null)
    activeFileRef.current = null
    setOutcome(null)
    setParts([])
    setError('')
    setProgress({ label: '', fraction: 0 })
    setShowChanged(false)
    setCopied(false)
    setCopyFailed(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function chooseFile(next: File | undefined, requestedProfileId = profileId, requestedCustomMessageMiB = customMessageMiB) {
    if (!next) return
    if (!next.name.toLowerCase().endsWith('.pdf') && next.type !== 'application/pdf') {
      setError('Please choose a PDF. The original file has not left your device.')
      setStage('error')
      return
    }
    const deviceMemory = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined
    const browserBudget = deviceMemory !== undefined && deviceMemory <= 2 ? 80 * 1024 * 1024 : MAX_BROWSER_BYTES
    if (next.size > browserBudget) {
      setError('This file is larger than the browser memory budget for this first release. Try splitting it from your PDF app first.')
      setStage('error')
      return
    }
    activeFileRef.current = next
    const jobId = ++jobIdRef.current
    clearJobTimeout()
    jobTimeoutRef.current = window.setTimeout(() => {
      if (jobId !== jobIdRef.current) return
      workerRef.current?.terminate()
      workerRef.current = null
      setWorkerNonce((nonce) => nonce + 1)
      setError('This file took too long for a safe browser-only pass. Try a smaller PDF or split it in your PDF app first.')
      setStage('error')
    }, MAX_JOB_MS)
    setFile(next)
    setError('')
    setStage('reading')
    setProgress({ label: 'Reading this file locally', fraction: 0.08 })
    window.setTimeout(() => {
      const worker = workerRef.current
      if (!worker || jobId !== jobIdRef.current) return
      setStage('compressing')
      setProgress({ label: 'Finding the best readable fit', fraction: 0.18 })
      next.arrayBuffer().then((buffer) => {
        if (jobId !== jobIdRef.current || workerRef.current !== worker) return
        worker.postMessage({ type: 'compress', jobId, bytes: new Uint8Array(buffer), profileId: requestedProfileId, customMessageMiB: requestedCustomMessageMiB }, [buffer])
      }).catch(() => {
        if (jobId !== jobIdRef.current) return
        setError('The file could not be read in this browser.')
        setStage('error')
      })
    }, 0)
  }

  function download(bytes: Uint8Array, name: string) {
    const safeBytes = bytes.slice()
    const url = URL.createObjectURL(new Blob([safeBytes.buffer], { type: 'application/pdf' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyPlan() {
    const deckName = file?.name.replace(/\.pdf$/i, '') || 'Deck'
    const planLines = parts.map((part, index) => `${index + 1}. Subject: ${deckName} (${index + 1}/${parts.length})\nAttachment: ${part.name} (${bytesWithUnit(part.bytes.byteLength)})`).join('\n\n')
    const text = `Send these emails in order:\n${planLines}\n\nAdd a short note in the email body, then attach each file.`
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      setCopyFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  function renderUploader() {
    return <>
      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">Make this deck email-ready.</h1>
        <p>Readable, private, and sized for the mailbox you’re sending from.</p>
      </section>
      <button
        className={`dropzone ${dragging ? 'dropzone--active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]) }}
        type="button"
      >
        <span className="file-mark"><Icon name="file" size={38} /></span>
        <strong>Drop your PDF here</strong>
        <span className="primary-button">Choose a PDF</span>
        <small>Your file stays on this device.</small>
      </button>
      <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseFile(event.target.files?.[0])} />
      <ProfilePicker profileId={profileId} customMessageMiB={customMessageMiB} onChange={setProfileId} onCustomChange={setCustomMessageMiB} />
    </>
  }

  function renderBusy() {
    return <section className="status-panel" aria-live="polite" aria-busy="true">
      <div className="status-heading"><span className="spinner" /><div><p className="eyebrow">Working locally</p><h1>{stage === 'splitting' ? 'Making the safest recovery.' : 'Finding the best readable fit.'}</h1></div></div>
      <p className="status-copy">Your PDF has not been uploaded. The browser is checking a small set of measured candidates, then it will verify the page count before offering a download.</p>
      <div className="progress-track" role="progressbar" aria-label="Compression progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}><span style={{ width: `${Math.max(8, progress.fraction * 100)}%` }} /></div>
      <div className="progress-meta"><span>{progress.label}</span><span>{Math.round(progress.fraction * 100)}%</span></div>
      <button className="text-button" onClick={reset} type="button">Cancel</button>
    </section>
  }

  function renderReady() {
    if (!file || !outcome) return null
    const outputBytes = outcome.candidate.bytes.byteLength
    const outputName = emailVersionName(file.name)
    const status = outcome.candidate.engine === 'original' ? 'Already under the target' : profile.conditional ? 'Conditional Gmail attachment fit' : 'Good fit for the selected mail system'
    return <section className="result-panel" aria-live="polite">
      <div className="result-heading"><p className="eyebrow">Verified on this device</p><h1>{outcome.candidate.engine === 'original' ? 'Your original is ready.' : 'Your email version is ready.'}</h1><p className="result-size">{bytesWithUnit(outputBytes)} PDF · estimated message {bytesWithUnit(outcome.estimatedMessageBytes)}</p><p className="output-name">Download name: <strong>{outputName}</strong></p></div>
      <div className="result-grid">
        <div className="result-main">
          <div className="fit-status"><span className="check-mark"><Icon name="check" size={18} /></span><div><strong>{status}</strong><span>{profile.detail}</span>{profile.conditional && <small className="conditional-note">Use only when the sender and recipient are on Gmail or Workspace. Other mail systems may reject this size.</small>}</div></div>
          <div className="actions"><button className="primary-button primary-button--large" onClick={() => download(outcome.candidate.bytes, outputName)} type="button"><Icon name="download" size={19} />Download email version</button><button className="link-button" onClick={() => setShowChanged(!showChanged)} type="button">{showChanged ? 'Hide details' : 'Compare'} <Icon name="arrow" size={16} /></button></div>
        </div>
        <div className="file-comparison"><div><span>Original</span><strong>{bytesWithUnit(file.size)}</strong><small>{outcome.inspection.pages} pages</small></div><Icon name="arrow" size={20} /><div><span>Email version</span><strong>{bytesWithUnit(outputBytes)}</strong><small>{outcome.inspection.pages} pages</small></div></div>
      </div>
      <div className={`details ${showChanged ? 'details--open' : ''}`}><button className="details-toggle" aria-expanded={showChanged} aria-controls="details-body" onClick={() => setShowChanged(!showChanged)} type="button"><span>{showChanged ? '−' : '+'}</span> What changed</button>{showChanged && <div className="details-body" id="details-body"><p>{outcome.candidate.notes.join(' ')}</p><p>Page count and page geometry were checked before this result was offered. Visual differences can still occur in compressed images.</p></div>}</div>
      <div className="secondary-action"><button className="secondary-link" onClick={() => { if (file) { setProfileId('strict-20'); chooseFile(file, 'strict-20', customMessageMiB) } }} type="button"><Icon name="spark" size={17} />Try strict 20 MB target</button><span>Creates more headroom for stricter mail systems.</span></div>
      <button className="start-over" onClick={reset} type="button">Use another PDF</button>
    </section>
  }

  function renderSplit() {
    if (!file || !outcome) return null
    const partLabel = `${parts.length} emails`
    return <section className="split-panel" aria-live="polite"><p className="eyebrow">Quality floor protected</p><h1>This deck needs {partLabel}.</h1><p className="split-copy">Keeping the text and diagrams readable is more important than forcing one attachment.</p><div className="parts-list">{parts.map((part, index) => <div className="part-row" key={part.name}><span className="part-number">{index + 1}</span><div className="part-info"><strong>{part.name}</strong><span>{bytesWithUnit(part.bytes.byteLength)} PDF · pages {part.startPage}–{part.endPage}</span></div><button className="download-part" onClick={() => download(part.bytes, part.name)} type="button"><Icon name="download" size={17} />Download</button></div>)}</div><div className="email-plan"><div className="plan-title"><span><Icon name="copy" size={18} />Copy this email plan</span><button onClick={copyPlan} type="button">{copied ? 'Copied' : copyFailed ? 'Copy failed' : 'Copy all'}</button></div><p>Send these emails in order:</p>{parts.map((part, index) => <div className="plan-line" key={part.name}><strong>{index + 1}. Subject:</strong> {file.name.replace(/\.pdf$/i, '')} ({index + 1}/{parts.length})<br /><span>Attachment: {part.name} ({bytesWithUnit(part.bytes.byteLength)})</span></div>)}<p>{copyFailed ? 'Your browser blocked clipboard access. Select the plan text above to copy it.' : 'Add a short note in the email body, then attach each file.'}</p></div><button className="start-over" onClick={reset} type="button">Use another PDF</button></section>
  }

  return <div className="app-shell">
    <header className="topbar"><button className="wordmark" onClick={reset} type="button">Email My Deck</button><button ref={howTriggerRef} className="nav-link" onClick={() => setShowHow(true)} type="button">How it works</button></header>
    <main className="main-content">{stage === 'idle' || stage === 'error' ? renderUploader() : null}{isBusy ? renderBusy() : null}{stage === 'ready' ? renderReady() : null}{stage === 'split' ? renderSplit() : null}{stage === 'error' && <div className="error-callout" role="alert"><strong>We couldn’t make a safe result.</strong><span>{error}</span><button className="text-button" onClick={reset} type="button">Try another PDF</button></div>}</main>
    <footer className="footer"><span>PDF only · no account · no upload</span><span className="footer-detail"><Icon name="check" size={14} /> Processed in your browser · <a className="footer-link" href="https://github.com/bomkino/Email-My-Deck" target="_blank" rel="noreferrer">Source</a></span></footer>
    {showHow && <div className="modal-backdrop" role="presentation" onClick={() => setShowHow(false)}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="how-title" onClick={(event) => event.stopPropagation()}><button ref={modalCloseRef} className="modal-close" onClick={() => setShowHow(false)} aria-label="Close" type="button">×</button><p className="eyebrow">A small, honest tool</p><h2 id="how-title">One PDF in. One useful answer out.</h2><p>We keep the original bytes in your browser, test the lightest safe changes first, and only offer a download after checking that the page count survived.</p><p>The default target leaves room for email encoding and message text. If a readable single file cannot fit, you get measured, sequential parts with names you can attach immediately.</p><div className="modal-rule" /><p className="modal-note"><Icon name="help" size={16} /> No accounts, analytics, upload endpoint, or email integration.</p></section></div>}
  </div>
}

function ProfilePicker({ profileId, customMessageMiB, onChange, onCustomChange }: { profileId: TargetProfileId; customMessageMiB: number; onChange: (value: TargetProfileId) => void; onCustomChange: (value: number) => void }) {
  return <fieldset className="profiles"><legend>Target email system <span className="help" title="We estimate MIME overhead so the PDF leaves room for the email itself."><Icon name="help" size={15} /></span></legend>{(Object.values(TARGET_PROFILES) as typeof TARGET_PROFILES[keyof typeof TARGET_PROFILES][]).map((profile) => <label className="profile-option" key={profile.id}><input type="radio" name="profile" checked={profileId === profile.id} onChange={() => onChange(profile.id)} /><span className="radio" /><span className="profile-copy"><strong>{profile.label}</strong><small>{profile.detail}</small></span></label>)}<label className="profile-option profile-option--custom"><input type="radio" name="profile" checked={profileId === 'custom'} onChange={() => onChange('custom')} /><span className="radio" /><span className="profile-copy"><strong>Custom size limit</strong><small>Pick a specific maximum message size</small></span>{profileId === 'custom' && <span className="custom-input"><input aria-label="Custom message limit in megabytes" type="number" min="5" max="70" defaultValue={customMessageMiB} onChange={(event) => { if (event.target.value === '') return; const parsed = Number(event.target.value); if (Number.isFinite(parsed)) onCustomChange(Math.min(70, Math.max(5, parsed))) }} onBlur={(event) => { const parsed = Number(event.target.value); const next = Math.min(70, Math.max(5, Number.isFinite(parsed) && parsed > 0 ? parsed : 5)); event.currentTarget.value = String(next); onCustomChange(next) }} /><span>MB</span></span>}</label></fieldset>
}

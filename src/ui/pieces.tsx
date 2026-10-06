import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { busyCopy, commentary, commentaryKeyFor, dogFact, type CommentaryKey, type StageKey } from './copy'
import { formatSize } from './format'

type IconName = 'file' | 'download' | 'check' | 'arrow' | 'copy' | 'link' | 'close' | 'shuffle'

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false }
  if (name === 'file') return <svg {...common}><path d="M14 2H6.8A1.8 1.8 0 0 0 5 3.8v16.4A1.8 1.8 0 0 0 6.8 22h10.4a1.8 1.8 0 0 0 1.8-1.8V7z" /><path d="M14 2v5h5" /></svg>
  if (name === 'download') return <svg {...common}><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20.5h16" /></svg>
  if (name === 'check') return <svg {...common}><path d="m5 12.5 4.2 4.2L19 7" /></svg>
  if (name === 'arrow') return <svg {...common}><path d="M5 12h13m-5-5 5 5-5 5" /></svg>
  if (name === 'copy') return <svg {...common}><rect x="8" y="8" width="11" height="12" rx="1" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" /></svg>
  if (name === 'link') return <svg {...common}><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></svg>
  if (name === 'shuffle') return <svg {...common}><path d="M4 7h3.5c2 0 3 1 4.2 3l1.6 2.8c1.2 2 2.2 3.2 4.2 3.2H20m0 0-2.5-2.5M20 16l-2.5 2.5M4 16h3.5c1 0 1.7-.3 2.3-.8M20 7h-2.5c-1 0-1.7.3-2.3.8M20 7l-2.5-2.5M20 7l-2.5 2.5" /></svg>
  return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>
}

/** The little paper deck that sits in the drop zone and reacts to you. */
export function DeckStack({ label, state }: { label: string; state: 'idle' | 'hover' | 'done' }) {
  return <div className={`deck-stack deck-stack--${state}`} aria-hidden="true">
    <span className="deck-card deck-card--back" />
    <span className="deck-card deck-card--middle" />
    <span className="deck-card deck-card--front">
      <span className="deck-card-title" />
      <span className="deck-card-line" />
      <span className="deck-card-line deck-card-line--short" />
      <span className="deck-card-label">{label}</span>
    </span>
  </div>
}

export function Stamp({ text }: { text: string }) {
  return <span className="stamp" aria-hidden="true"><Icon name="check" size={18} />{text}</span>
}

/** How much of the mailbox limit the email will use. */
export function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const share = Math.min(1, used / limit)
  return <div className="meter">
    <div className="meter-head" data-pd-type="metadata"><span>{label}</span><span>About {formatSize(used)} of {formatSize(limit)}</span></div>
    <div className="meter-track" aria-hidden="true"><span className="meter-fill" style={{ '--share': share } as React.CSSProperties} /><span className="meter-limit" /></div>
  </div>
}

/**
 * Real progress from the engine, plus a slow, honest creep so the bar never
 * looks frozen while a single long step runs. It never passes the next
 * milestone the engine has not reached.
 */
export function useSmoothProgress(real: number, active: boolean): number {
  const [shown, setShown] = useState(0)
  const realRef = useRef(real)
  realRef.current = real
  useEffect(() => {
    if (!active) { setShown(real >= 1 ? 1 : 0); return }
    const timer = window.setInterval(() => {
      setShown((current) => {
        const target = realRef.current
        if (current < target) return Math.min(target, current + Math.max(0.01, (target - current) * 0.25))
        const ceiling = Math.min(0.97, target + 0.16)
        return current + Math.max(0, (ceiling - current) * 0.012)
      })
    }, 120)
    return () => window.clearInterval(timer)
  }, [active, real])
  return shown
}

export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!active) { setElapsed(0); return }
    const started = performance.now()
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 500)
    return () => window.clearInterval(timer)
  }, [active])
  return elapsed
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Loading-screen commentary. It follows the engine from step to step, giving
 * each step's own lines first and then wandering into the general ones.
 * A line stays up for at least a moment, and the card pauses while you read.
 */
export function TipCard({ stage }: { stage: StageKey | null }) {
  const own = useMemo(() => Object.fromEntries((Object.keys(commentary) as CommentaryKey[]).map((key) => [key, key === 'any' ? [] : shuffle(commentary[key])])) as Record<CommentaryKey, string[]>, [])
  const general = useMemo(() => shuffle([...commentary.any, dogFact]), [])
  const cursors = useRef<Partial<Record<CommentaryKey, number>>>({})
  const generalCursor = useRef(0)
  const pick = useCallback((key: CommentaryKey) => {
    const at = cursors.current[key] ?? 0
    if (at < own[key].length) {
      cursors.current[key] = at + 1
      return own[key][at]
    }
    const line = general[generalCursor.current % general.length]
    generalCursor.current += 1
    return line
  }, [own, general])
  const wanted = commentaryKeyFor(stage)
  const [shown, setShown] = useState(() => ({ key: wanted, line: pick(wanted) }))
  const [paused, setPaused] = useState(false)
  const shownAt = useRef(performance.now())
  const show = useCallback((key: CommentaryKey) => {
    shownAt.current = performance.now()
    setShown({ key, line: pick(key) })
  }, [pick])
  // A new step gets its own line once it has lasted a moment and the current
  // line has been up long enough to read. Steps that flash past get none.
  useEffect(() => {
    if (wanted === shown.key) return
    const timer = window.setTimeout(() => show(wanted), Math.max(900, 2600 - (performance.now() - shownAt.current)))
    return () => window.clearTimeout(timer)
  }, [wanted, shown.key, show])
  useEffect(() => {
    if (paused) return
    const timer = window.setTimeout(() => show(shown.key), 8000)
    return () => window.clearTimeout(timer)
  }, [shown, paused, show])
  const isDogFact = shown.line === dogFact
  return <aside className="tip-card" aria-label="While you wait" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <div className="tip-head" data-pd-type="metadata">
      <span>{isDogFact ? busyCopy.dogFactEyebrow : busyCopy.commentaryEyebrow}</span>
    </div>
    <p className="tip-text" key={shown.line} data-pd-type="body.default">{shown.line}</p>
    <button className="tip-next" type="button" onClick={() => show(shown.key)}><Icon name="shuffle" size={16} />{busyCopy.another}</button>
  </aside>
}

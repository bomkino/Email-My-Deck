// Decimal units everywhere, so a size here matches Finder, Explorer and the
// limit printed by mail providers.
// The number and its unit are joined by a no-break space, so "35.9 MB" never
// breaks across two lines.
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes}\u00a0B`
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))}\u00a0KB`
  const mb = bytes / 1_000_000
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1).replace(/\.0$/, '')}\u00a0MB`
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function percentLighter(before: number, after: number): number {
  if (before <= 0 || after >= before) return 0
  return Math.round((1 - after / before) * 100)
}

export function deckName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || 'my deck'
}

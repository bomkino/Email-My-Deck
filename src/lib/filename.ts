export function emailVersionName(originalName: string, part?: { index: number; total: number }): string {
  const base = originalName.replace(/\.pdf$/i, '') || 'deck'
  const safe = base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'deck'
  if (!part) return `${safe}-email-version.pdf`
  return `${safe}-email-version-part-${String(part.index).padStart(2, '0')}-of-${String(part.total).padStart(2, '0')}.pdf`
}

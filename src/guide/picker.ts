// Sorting for the "Send a link instead" guide. The section is already on the
// page as plain HTML; this folds it down to its headline, shows the buttons
// and re-orders the rows by what the visitor picks. Nothing here is sent anywhere.
import './guide.css'
import { guideCopy, NEEDS } from './copy'
import type { Need } from './types'

type Scored = { row: HTMLElement; hits: number; boost: number; rank: number }

const words = (value: string | undefined) => (value ?? '').split(' ').filter(Boolean)

/** Most matches first; a tie goes to our pick for that need, then to our usual order. */
export function rank(rows: HTMLElement[], needs: Need[]): Scored[] {
  return rows.map((row) => {
    const has = words(row.dataset.has)
    const picks = words(row.dataset.picks)
    return { row, hits: needs.filter((need) => has.includes(need)).length, boost: needs.filter((need) => picks.includes(need)).length, rank: Number(row.dataset.rank) }
  }).sort((a, b) => b.hits - a.hits || b.boost - a.boost || a.rank - b.rank)
}

const nameOf = (row: HTMLElement) => row.querySelector('.svc-name')?.firstChild?.textContent?.trim() ?? ''

function openRow(row: HTMLElement | null) {
  const details = row?.querySelector('details')
  if (details) details.open = true
}

const calm = () => typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Folds the guide behind its toggle. Links to #send-a-link (the FAQ, the
 * can't-fit screen, another page) open it again, and so does find-in-page
 * where the browser supports hidden="until-found".
 */
function setUpFold(section: HTMLElement) {
  const more = section.querySelector<HTMLElement>('[data-send-more]')
  const toggle = section.querySelector<HTMLButtonElement>('[data-send-toggle]')
  const fold = section.querySelector<HTMLButtonElement>('[data-send-fold]')
  if (!more || !toggle) return () => {}

  const setOpen = (open: boolean) => {
    if (open) more.removeAttribute('hidden')
    else more.setAttribute('hidden', 'until-found')
    toggle.setAttribute('aria-expanded', String(open))
    section.dataset.open = String(open)
  }
  const open = () => { if (toggle.getAttribute('aria-expanded') !== 'true') setOpen(true) }

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'))
  fold?.addEventListener('click', () => {
    setOpen(false)
    toggle.focus({ preventScroll: true })
    section.scrollIntoView?.({ block: 'start', behavior: calm() ? 'auto' : 'smooth' })
  })
  more.addEventListener('beforematch', () => setOpen(true))
  // Runs before the browser follows the link, so the section is already open when it scrolls there.
  document.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest?.('a[href="#send-a-link"]')) open()
  })

  setOpen(false)
  toggle.hidden = false
  if (fold) fold.hidden = false
  return open
}

export function setUpSendGuide(root: ParentNode = document) {
  const section = root.querySelector<HTMLElement>('#send-a-link')
  const filter = section?.querySelector<HTMLElement>('[data-send-filter]')
  const list = section?.querySelector<HTMLOListElement>('.svc-list')
  if (!section || !filter || !list) return
  const openGuide = setUpFold(section)
  const rows = Array.from(list.children) as HTMLElement[]
  const chips = Array.from(filter.querySelectorAll<HTMLButtonElement>('button[data-need]'))
  const clear = filter.querySelector<HTMLButtonElement>('[data-send-clear]')
  const result = filter.querySelector<HTMLElement>('[data-send-result]')
  const heads = Array.from(section.querySelectorAll<HTMLElement>('.svc-head [data-need]'))
  const selected: Need[] = []

  const update = () => {
    const before = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]))
    const scored = rank(rows, selected)
    scored.forEach(({ row }) => list.append(row))
    scored.forEach(({ row, hits }, index) => {
      row.dataset.match = selected.length === 0 ? '' : hits === selected.length ? 'all' : hits > 0 ? 'some' : 'none'
      row.querySelectorAll<HTMLElement>('.svc-fact').forEach((cell) => { cell.dataset.lit = String(selected.includes(cell.dataset.need as Need)) })
      const badge = row.querySelector<HTMLElement>('[data-svc-badge]')
      if (!badge) return
      const ourPick = words(row.dataset.picks).includes('all')
      const text = selected.length === 0 ? (ourPick ? guideCopy.badgeOurs : '') : index === 0 && hits > 0 ? guideCopy.badgeBest : ''
      badge.textContent = text
      badge.hidden = text === ''
    })
    heads.forEach((head) => { head.dataset.lit = String(selected.includes(head.dataset.need as Need)) })
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(selected.includes(chip.dataset.need as Need))))
    if (clear) clear.hidden = selected.length === 0
    const top = scored[0]
    if (result) result.textContent = selected.length === 0 ? guideCopy.resultIdle : guideCopy.result(nameOf(top.row), top.hits, selected.length, selected.map((need) => NEEDS.find((item) => item.id === need)!.short))

    // Let the rows glide to their new places, unless motion is unwelcome.
    if (calm()) return
    rows.forEach((row) => {
      if (typeof row.animate !== 'function') return
      const shift = (before.get(row) ?? 0) - row.getBoundingClientRect().top
      if (Math.abs(shift) < 1) return
      row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.23, 1, .32, 1)' })
    })
  }

  chips.forEach((chip) => chip.addEventListener('click', () => {
    const need = chip.dataset.need as Need
    const at = selected.indexOf(need)
    if (at === -1) selected.push(need)
    else selected.splice(at, 1)
    update()
  }))
  clear?.addEventListener('click', () => { selected.length = 0; update(); chips[0]?.focus() })

  // A pick's "how to set it up" link opens that row's steps.
  section.querySelectorAll<HTMLAnchorElement>('[data-svc-open]').forEach((link) => link.addEventListener('click', () => openRow(document.getElementById(`svc-${link.dataset.svcOpen}`))))

  // Arriving at #send-a-link, or at one service's row, opens the guide there.
  const fromHash = () => {
    const hash = location.hash
    if (hash !== '#send-a-link' && !hash.startsWith('#svc-')) return
    openGuide()
    if (hash === '#send-a-link') return
    const row = document.getElementById(hash.slice(1))
    if (!row || !section.contains(row)) return
    openRow(row)
    row.scrollIntoView?.({ block: 'start' })
  }
  fromHash()
  window.addEventListener('hashchange', fromHash)

  filter.hidden = false
}

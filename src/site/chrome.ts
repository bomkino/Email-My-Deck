// The pitch.dog page around the tool: theme, mobile menu, hero entrance and
// copy-link buttons. Mirrors the behaviour of the other pitch.dog pages.


const root = document.documentElement
const themeOrder = ['auto', 'light', 'dark'] as const
type Theme = typeof themeOrder[number]
const colorPreference = matchMedia('(prefers-color-scheme: dark)')

function readSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem('pitchdog-theme')
    if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved
  } catch { /* storage can be blocked */ }
  return 'auto'
}

function applyTheme(choice: Theme, persist = true) {
  const resolved = choice === 'auto' ? (colorPreference.matches ? 'dark' : 'light') : choice
  root.dataset.theme = choice
  root.dataset.resolvedTheme = resolved
  const label = document.querySelector('#theme-label')
  const icon = document.querySelector('#theme-icon use')
  const button = document.querySelector('#theme-button')
  const name = choice[0].toUpperCase() + choice.slice(1)
  if (label) label.textContent = name
  icon?.setAttribute('href', `/assets/phosphor-sprite.svg#ph-${choice === 'auto' ? 'circle-half' : choice === 'light' ? 'sun' : 'moon'}`)
  const next = themeOrder[(themeOrder.indexOf(choice) + 1) % themeOrder.length]
  button?.setAttribute('aria-label', `Theme: ${name}. Activate to switch to ${next[0].toUpperCase() + next.slice(1)}.`)
  const themeColor = document.querySelector<HTMLMetaElement>('#theme-color')
  if (themeColor) themeColor.content = resolved === 'dark' ? '#0b0c0e' : '#f6f5f8'
  const favicon = document.querySelector<HTMLLinkElement>('#theme-favicon')
  if (favicon) favicon.href = resolved === 'dark' ? '/assets/favicon-dark.svg' : '/assets/favicon-light.svg'
  if (persist) try { localStorage.setItem('pitchdog-theme', choice) } catch { /* ignore */ }
}

export function setUpChrome() {
  root.classList.add('js')
  applyTheme(readSavedTheme(), false)
  document.querySelector('#theme-button')?.addEventListener('click', () => {
    const current = (root.dataset.theme as Theme) || 'auto'
    applyTheme(themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length])
  })
  colorPreference.addEventListener('change', () => { if (root.dataset.theme === 'auto') applyTheme('auto', false) })

  const toggle = document.querySelector<HTMLButtonElement>('#mobile-menu-toggle')
  const menu = document.querySelector<HTMLElement>('#mobile-menu')
  if (toggle && menu) {
    const setMenu = (open: boolean, restoreFocus = false) => {
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
      menu.setAttribute('aria-hidden', String(!open))
      menu.inert = !open
      document.body.classList.toggle('mobile-menu-open', open)
      if (open) requestAnimationFrame(() => menu.querySelector('a')?.focus({ preventScroll: true }))
      else if (restoreFocus) toggle.focus({ preventScroll: true })
    }
    toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true', true))
    menu.querySelectorAll('[data-mobile-menu-close]').forEach((node) => node.addEventListener('click', () => setMenu(false, true)))
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)))
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { event.preventDefault(); setMenu(false, true) }
    })
    matchMedia('(min-width: 601px)').addEventListener('change', (event) => { if (event.matches) setMenu(false) })
  }

  document.querySelectorAll<HTMLButtonElement>('[data-copy-link]').forEach((button) => {
    const label = button.querySelector('span')
    const original = label?.textContent ?? ''
    button.addEventListener('click', async () => {
      let ok = false
      try { await navigator.clipboard.writeText(location.origin + location.pathname); ok = true } catch { /* blocked */ }
      if (label) label.textContent = ok ? 'Link copied' : 'Copy blocked. Use the address bar.'
      window.setTimeout(() => { if (label) label.textContent = original }, 2400)
    })
  })

  const buildLink = document.querySelector<HTMLAnchorElement>('#emd-build-link')
  if (buildLink && __EMD_SOURCE_URL__) buildLink.href = __EMD_SOURCE_URL__

  const reveal = document.querySelectorAll<HTMLElement>('[data-reveal]')
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      observer.unobserve(entry.target)
    }), { threshold: 0.25 })
    reveal.forEach((node) => observer.observe(node))
  } else reveal.forEach((node) => node.classList.add('is-visible'))

  requestAnimationFrame(() => root.classList.add('hero-ready'))
}

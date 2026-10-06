import { beforeEach, describe, expect, it } from 'vitest'
import { rank, setUpSendGuide } from '../src/guide/picker'
import { renderSendGuide } from '../src/guide/render'
import { NEEDS } from '../src/guide/copy'
import { CHECKED, LEFT_OUT, PICKS, SERVICES } from '../src/guide/services'
import type { Need } from '../src/guide/types'

// Every source must be the service's own site. A blog post about a free plan
// is not a source.
const OWN_DOMAINS: Record<string, string[]> = {
  'google-drive': ['google.com'],
  dropbox: ['dropbox.com'],
  onedrive: ['microsoft.com', 'live.com', 'onedrive.com'],
  'proton-drive': ['proton.me'],
  swisstransfer: ['swisstransfer.com', 'infomaniak.com'],
  wetransfer: ['wetransfer.com', 'wetransfer.zendesk.com'],
  transfernow: ['transfernow.net'],
  'mail-drop': ['apple.com'],
  papermark: ['papermark.com', 'papermark.io'],
  wormhole: ['wormhole.app'],
  'tresorit-send': ['tresorit.com'],
}

const LEFT_OUT_DOMAINS: Record<string, string> = { Smash: 'fromsmash.com', Filemail: 'filemail.com', Wormhole: 'wormhole.app', MEGA: 'mega.io', DocSend: 'dropbox.com' }

const registrable = (host: string) => host.split('.').slice(-2).join('.')

describe('send-a-link guide data', () => {
  it('records when it was checked', () => {
    expect(CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('cites only each service’s own site, over https', () => {
    for (const service of SERVICES) {
      const own = OWN_DOMAINS[service.id]
      expect(own, `${service.id} needs its own domains listed in this test`).toBeDefined()
      expect(service.sources.length).toBeGreaterThan(0)
      for (const { url } of [...service.sources, { url: service.url }]) {
        const { protocol, hostname } = new URL(url)
        expect(protocol).toBe('https:')
        expect(own.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`) || registrable(hostname) === domain), `${url} is not ${service.name}’s own site`).toBe(true)
      }
    }
  })

  it('cites the left-out services’ own sites too', () => {
    for (const item of LEFT_OUT) {
      const { protocol, hostname } = new URL(item.url)
      expect(protocol).toBe('https:')
      expect(registrable(hostname), item.name).toBe(LEFT_OUT_DOMAINS[item.name])
    }
  })

  it('has at least one service for every need, so no button sorts to nothing', () => {
    for (const need of NEEDS) expect(SERVICES.some((service) => service.facts[need.id].yes), need.id).toBe(true)
  })

  it('only recommends a service for a need it actually meets', () => {
    for (const pick of PICKS) {
      const service = SERVICES.find((item) => item.id === pick.service)
      expect(service, pick.service).toBeDefined()
      if (pick.for !== 'all') expect(service!.facts[pick.for].yes, `${pick.service} for ${pick.for}`).toBe(true)
    }
    expect(PICKS.filter((pick) => pick.for === 'all')).toHaveLength(1)
  })

  it('gives every service steps and unique ids', () => {
    expect(new Set(SERVICES.map((service) => service.id)).size).toBe(SERVICES.length)
    for (const service of SERVICES) expect(service.how.length).toBeGreaterThan(1)
  })
})

describe('send-a-link guide page', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main>${renderSendGuide()}</main>`
  })

  it('reads without JavaScript: every service, its facts and its steps are in the HTML', () => {
    const html = renderSendGuide()
    expect(html).not.toMatch(/<script/i)
    for (const service of SERVICES) {
      const row = document.getElementById(`svc-${service.id}`)!
      expect(row).not.toBeNull()
      expect(row.querySelectorAll('.svc-fact')).toHaveLength(NEEDS.length)
      expect(row.querySelectorAll('.svc-steps li')).toHaveLength(service.how.length)
    }
    // The sorting buttons only appear once the script is running.
    expect(document.querySelector<HTMLElement>('[data-send-filter]')!.hidden).toBe(true)
  })

  it('opens outside links in a new tab, so a finished deck on this page is not lost', () => {
    const outside = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'))
    expect(outside.length).toBeGreaterThan(SERVICES.length)
    for (const link of outside) {
      expect(link.target).toBe('_blank')
      expect(link.rel).toContain('noopener')
      expect(link.textContent).toContain('opens in a new tab')
    }
  })

  it('links each pick to its row', () => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.send-pick-link')) {
      expect(document.getElementById(link.getAttribute('href')!.slice(1))).not.toBeNull()
    }
  })

  it('puts our pick for a need on top when that need is chosen alone', () => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.svc'))
    for (const pick of PICKS) {
      if (pick.for === 'all') continue
      expect(rank(rows, [pick.for as Need])[0].row.id, pick.for).toBe(`svc-${pick.service}`)
    }
    const ours = PICKS.find((pick) => pick.for === 'all')!
    expect(rank(rows, [])[0].row.id).toBe(`svc-${ours.service}`)
  })

  it('sorts the rows when a need is pressed, and says what came out on top', () => {
    setUpSendGuide(document)
    const filter = document.querySelector<HTMLElement>('[data-send-filter]')!
    expect(filter.hidden).toBe(false)
    const pick = PICKS.find((item) => item.for === 'private')!
    const chip = filter.querySelector<HTMLButtonElement>('button[data-need="private"]')!
    chip.click()
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    const first = document.querySelector<HTMLElement>('.svc-list > li')!
    expect(first.id).toBe(`svc-${pick.service}`)
    expect(first.dataset.match).toBe('all')
    expect(first.querySelector<HTMLElement>('[data-svc-badge]')!.hidden).toBe(false)
    expect(filter.querySelector('[data-send-result]')!.textContent).toContain(SERVICES.find((s) => s.id === pick.service)!.name)
    expect(first.querySelector<HTMLElement>('.svc-fact[data-need="private"]')!.dataset.lit).toBe('true')

    filter.querySelector<HTMLButtonElement>('[data-send-clear]')!.click()
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    const ours = PICKS.find((item) => item.for === 'all')!
    expect(document.querySelector<HTMLElement>('.svc-list > li')!.id).toBe(`svc-${ours.service}`)
  })
})

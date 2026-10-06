// The shape of the "Send a link instead" guide. The facts live in
// services.ts; render.ts turns them into the page's HTML at build time, and
// picker.ts only re-sorts what's already on the page.

/** Something a visitor can ask the guide to sort by. Each one is a column. */
export type Need = 'looks' | 'lasts' | 'no-signup' | 'private' | 'opened' | 'huge'

/** One fact in a column. `yes` decides the tick and whether the service matches that need. */
export type Fact = { yes: boolean; text: string }

export type Source = { label: string; url: string }

export type Service = {
  id: string
  name: string
  /** Where you start: the service's own page. */
  url: string
  /** What it's best at, in our words. */
  line: string
  facts: Record<Need, Fact>
  /** The settings to use for a deck, in the service's own words for its buttons. `**x**` marks a label on screen. */
  how: string[]
  /** Worth knowing before you send. */
  watch: string[]
  /** Every limit above traces to one of these, checked on the date in services.ts. */
  sources: Source[]
}

/** A recommendation for one need, or 'all' for our pick overall. */
export type Pick = { for: Need | 'all'; label: string; service: string; why: string }

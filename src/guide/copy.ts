// The words around the facts in the "Send a link instead" guide.
import type { Need } from './types'

/** The things the guide can sort by. The order here is the column order. */
export const NEEDS: { id: Need; chip: string; column: string; short: string }[] = [
  { id: 'looks', chip: 'Opens as a preview', column: 'When they click', short: 'a preview in the browser' },
  { id: 'lasts', chip: 'Link that lasts', column: 'Link lasts', short: 'a link that lasts' },
  { id: 'no-signup', chip: 'No sign-up for me', column: 'Your sign-up', short: 'no sign-up' },
  { id: 'private', chip: 'Private, even from them', column: 'End-to-end encrypted', short: 'end-to-end encryption' },
  { id: 'opened', chip: 'Tells me they looked', column: 'Tells you', short: 'word when they’ve looked' },
  { id: 'huge', chip: 'Room for 10 GB+', column: 'Free limit', short: 'room for 10 GB or more' },
]

const count = (n: number) => ['none', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n)
const list = (items: string[]) => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

export const guideCopy = {
  eyebrow: 'Or send a link',
  title: 'A link weighs nothing.',
  lead: 'Put your deck somewhere it can be fetched and email the link instead. The email stays tiny, and your deck arrives whole, every photo as sharp as you made it.',
  body: [
    'Size is rarely the question. Every service here takes a 100 MB deck in its stride. What changes is what happens when they click: a clean preview or a download, a link that lasts or one that’s gone in a week, and who could read your deck on the way.',
    'Already made an email version here? For a link, send your original. There’s no limit to fit, so there’s nothing to give up.',
  ],
  pickLink: 'How to set it up',
  compareTitle: 'Side by side.',
  compareIntro: 'Free plans only, as each service describes them on its own site. None of them makes the person you’re sending to sign up.',
  filterLabel: 'Sort by what matters to you',
  clear: 'Clear',
  serviceColumn: 'Service',
  howSummary: (name: string) => `How to send a deck with ${name}`,
  watchTitle: 'Worth knowing',
  checkedOn: (date: string) => `Checked on ${date}:`,
  goTo: (name: string) => `Go to ${name}`,
  badgeOurs: 'Our pick',
  badgeBest: 'Best match',
  resultIdle: 'In our order, until you pick something.',
  result: (name: string, hits: number, total: number, wanted: string[]) => hits === total
    ? total === 1 ? `Best match: ${name}.` : `Best match: ${name}, with ${total === 2 ? 'both' : `all ${count(total)}`}: ${list(wanted)}.`
    : `Nothing here has ${total === 2 ? 'both' : `all ${count(total)}`}. ${name} comes closest, with ${count(hits)}.`,
  rulesTitle: 'Whatever you use.',
  rules: [
    { title: 'Open the link in a private window first.', body: 'If it asks you to sign in or request access, it will ask them too. Better you find out than they do.' },
    { title: 'Choose the longest life you’re offered.', body: 'Decks get opened days late, then forwarded to a partner after that. If a link can expire, give it as long as it allows, or use one that lasts until you delete it.' },
    { title: 'Name the file for their screen.', body: 'The file name is the title on the page they land on. “Your Project – Pitch Deck.pdf” sits there better than “final_v7_FINAL.pdf”.' },
    { title: 'Say what they’re clicking.', body: 'One line does it: “Our deck, a 40 MB PDF that opens in your browser.” People are right to be careful with mystery links.' },
    { title: 'Save the extra locks for decks that need them.', body: 'Passwords, expiry dates and view-only links each add a step for your reader. Use them when the deck is confidential, and send any password in a separate message.' },
  ],
  leftOut: 'We also checked',
  fineprint: (date: string) => `We checked every limit here on each service’s own site on ${date}, and each one lists its sources. Free plans change. Nobody paid to be on this list, and none of these links earn us anything.`,
  fineprintLink: 'Spotted something out of date? Tell us.',
}

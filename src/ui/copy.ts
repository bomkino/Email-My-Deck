import type { TargetProfileId } from '../lib/profiles'
import { formatSize } from './format'

// Every word the tool says lives here, so voice edits never touch logic.

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The mailbox the visitor picked, as a sentence names it. */
export function mailboxName(profileId: TargetProfileId, maxMessageBytes: number): string {
  if (profileId === 'gmail-advanced') return 'Gmail to Gmail'
  const size = formatSize(maxMessageBytes)
  // "an 8 MB limit", "an 11 MB limit", "an 18 MB limit": said, they start with a vowel.
  return `${/^(8|1[18](?!\d))/.test(size) ? 'an' : 'a'} ${size} ${profileId === 'custom' ? 'limit' : 'mailbox'}`
}

/** Sizes for the weigh-in, all in bytes. `email` is the whole email: the packed deck plus room for a message. */
export type Weights = { deck: number; email: number; limit: number; budget: number; mailbox: string; conditional: boolean }

export type WeighIn = 'fits' | 'looks-like-it-fits' | 'over'

// A deck under the limit can still be too big: the email is about a third
// heavier than the file. This is the moment people get caught out.
export const weighInFor = ({ deck, limit, budget, conditional }: Weights): WeighIn =>
  deck <= budget ? 'fits' : !conditional && deck < limit ? 'looks-like-it-fits' : 'over'

// Said the moment a deck is dropped, before any work starts.
export function weighInLine(weights: Weights): string {
  const { deck, email, budget, mailbox, conditional } = weights
  const kind = weighInFor(weights)
  if (conditional) return kind === 'fits'
    ? `Gmail to Gmail takes decks up to ${formatSize(budget)}. At ${formatSize(deck)}, this one fits, so we’re only checking it.`
    : `Gmail to Gmail takes decks up to ${formatSize(budget)}, so we’re bringing this one down to that.`
  if (kind === 'fits') return `${formatSize(deck)} on your device, about ${formatSize(email)} as an email. That fits ${mailbox}, so we’re only checking it.`
  if (kind === 'looks-like-it-fits') return `${formatSize(deck)} looks like it fits ${mailbox}. It doesn’t: packing it into an email adds about a third, so with your message it comes to about ${formatSize(email)}. We’re bringing it under ${formatSize(budget)}.`
  return `As an email it would weigh about ${formatSize(email)}. ${capitalise(mailbox)} takes decks up to ${formatSize(budget)}, so we’re bringing it under that.`
}

export const mailboxCopy: Record<TargetProfileId, { label: string; detail: (budget: string) => string; badge?: string }> = {
  'common-25': {
    label: 'Most mailboxes',
    detail: (budget) => `Keeps the whole email under 25 MB. Your deck can be up to ${budget}.`,
    badge: 'Our pick',
  },
  'strict-20': {
    label: 'Strict or work mailboxes',
    detail: (budget) => `For 20 MB limits, like iCloud Mail and many company servers. Deck up to ${budget}.`,
  },
  'gmail-advanced': {
    label: 'Gmail to Gmail only',
    detail: (budget) => `Only when you and everyone you’re sending to use Gmail or Google Workspace. Deck up to ${budget}.`,
  },
  custom: {
    label: 'I know my limit',
    detail: () => 'Type the message limit your mail system gives you.',
  },
}

export const mailboxWhy =
  'Mail systems weigh the whole email, after your file has been packed for the trip. Packing adds roughly a third, so we aim below the limit and leave room for your message.'

export type StageKey = 'read' | 'tidy' | 'photos' | 'resize' | 'sharpen' | 'verify' | 'split' | 'flatten' | 'work'

// The real step, next to the percentage. Plain on purpose: the curve balls
// below take turns with it, and this is the line that says nothing's stuck.
export const stageCopy: Record<StageKey, string> = {
  read: 'Opening your deck',
  tidy: 'Tidying the file’s insides',
  photos: 'Re-saving photos',
  resize: 'Resizing oversized photos',
  sharpen: 'Spending the room left on sharper photos',
  verify: 'Counting every slide back in',
  split: 'Splitting it into emails',
  flatten: 'Turning slides into pictures',
  work: 'Trying versions until one fits',
}

// Map whatever the engine reports onto plain words. Unknown labels fall
// back to the engine's own text, so a new stage never shows a blank line.
export function stageFor(label: string, stage?: unknown): StageKey | null {
  // The engine's last pass shares the resize stage; its label tells them apart.
  if (/sharper|room left/i.test(label)) return 'sharpen'
  if (typeof stage === 'string' && stage in stageCopy) return stage as StageKey
  if (typeof stage === 'string') {
    if (/inspect|read/i.test(stage)) return 'read'
    if (/ghost|strong|resample|downsample/i.test(stage)) return 'resize'
  }
  const text = label.toLowerCase()
  if (!text) return null
  if (/split|part/.test(text)) return 'split'
  if (/flatten|render/.test(text)) return 'flatten'
  if (/strong|ghostscript|downsampl|resiz|resampl/.test(text)) return 'resize'
  if (/check|verif|measur|ready to/.test(text)) return 'verify'
  if (/image|photo|jpeg|recompress/.test(text)) return 'photos'
  if (/tidy|structur|optimi/.test(text)) return 'tidy'
  if (/read|open|inspect/.test(text)) return 'read'
  if (/finding|fit/.test(text)) return 'work'
  return null
}

export const idleCopy = {
  title: 'Drop your deck here',
  dragging: 'Let go. We’ve got it.',
  choose: 'Choose a PDF',
  note: 'PDF only. It stays on this device.',
  dropAnywhere: 'Drop it anywhere',
  dropAnywhereNote: 'Your deck stays on this device.',
}

export const busyCopy = {
  eyebrow: 'Working on this device',
  splittingTitle: 'Packing it into parts.',
  flatteningTitle: 'Flattening it.',
  workingTitle: 'Making it fit.',
  cancel: 'Cancel',
  commentaryEyebrow: 'Meanwhile',
  dogFactEyebrow: 'A short break',
  another: 'Another one',
  // The line under the bar changes as the wait gets longer. Each one is true:
  // the device does the work, and the watchdog stops a stalled job and says so.
  waits: [
    { after: 0, text: 'Nothing gets uploaded. Your device is doing all the lifting itself, so a big deck can take a minute.' },
    { after: 25_000, text: 'Still going. Some of these photos are enormous, and your device is handling each one personally.' },
    { after: 75_000, text: 'Still at it. Phones take their time with a deck this size. No rush, and nobody else is looking.' },
    { after: 150_000, text: 'A long one. It’s still working, and if it ever gets stuck, we’ll stop and tell you. Stretch your legs. Your deck can’t.' },
  ],
}

export const waitFor = (elapsed: number) => [...busyCopy.waits].reverse().find((wait) => elapsed >= wait.after)?.text ?? busyCopy.waits[0].text

// Loading-screen commentary: our kind of funny about whatever is happening
// right now. No advice. The card switches to the current step's lines as the
// engine moves on, then wanders into the general ones. Exactly one dog fact.
export type CommentaryKey = 'read' | 'tidy' | 'photos' | 'verify' | 'split' | 'flatten' | 'any'

export const commentary: Record<CommentaryKey, string[]> = {
  read: [
    'Every slide is present and accounted for. Even the one you keep meaning to delete.',
    'First, a good look at what we’re working with. It’s a lovely deck. It’s also quite heavy.',
  ],
  tidy: [
    'Decks collect junk the way bags collect receipts. Clearing some out.',
    'Plenty of a file’s weight never makes it onto a slide. That goes first.',
  ],
  photos: [
    'A photo built for a billboard is finding out it’s going to a laptop. It’s taking it well.',
    'Text weighs almost nothing and stays exactly as sharp. It’s the photos that packed three coats.',
    'Every pixel here is headed for a screen, not a billboard. Packing accordingly.',
    'Photos can lose a surprising amount of weight before anyone’s eyes notice. Surprising to the photos, mostly.',
  ],
  verify: [
    'Counting slides back in. If one’s missing, nobody leaves.',
    'Same slides, same order, same page sizes. Checking anyway. We’re like that.',
  ],
  split: [
    'Splitting between slides, never through one. Nobody gets cut in half.',
    'Each part packs its own fonts, so no slide opens in the wrong typeface.',
    'Every part gets weighed on the way out. Guesses don’t go in the post.',
  ],
  flatten: [
    'Every slide is having its portrait taken. Hold still.',
    'Your text is about to become a picture of text. It won’t notice. Search will.',
  ],
  any: [
    'Your deck has no idea any of this is happening. Best not to tell it.',
    'All of this is happening inside your browser. If your fan just got louder, that’s the sound of privacy.',
    'Not one byte is leaving the room. The room is your browser. It’s a nice room.',
    'Email adds about a third to whatever you attach. Nobody asked for that, least of all your deck.',
    'Somewhere, a mail server is weighing every attachment with a very straight face. We’re getting yours past it.',
    'Soon this deck will be in someone’s inbox at 7:42 on a Tuesday, between a receipt and a newsletter. Big day.',
    'This counts as work. Tell anyone who asks that you’re compressing a deck.',
    'The progress bar is doing its best. It moves when the work does, and fidgets a little in between.',
    'The 25 MB limit was set by someone who never had to email a deck. We think about them often.',
  ],
}

// Fake steps that slip in between the real ones, next to the percentage.
// Short, so they fit beside it on a phone. None of them is about a dog.
export const curveBalls: Record<CommentaryKey, string[]> = {
  read: [
    'Politely not reading your slides',
    'Keeping the guest list short',
  ],
  tidy: [
    'Throwing out the packing peanuts',
    'Finding things nobody will miss',
  ],
  photos: [
    'Rolling the socks',
    'Leaving the third coat behind',
    'Sitting on the suitcase',
    'Complimenting the photos',
  ],
  verify: [
    'Counting heads',
    'Checking under the seats',
  ],
  split: [
    'Buying a second suitcase',
    'Deciding who sits with who',
  ],
  flatten: [
    'Saying cheese',
    'Laminating the slides',
  ],
  any: [
    'Still not uploading anything',
    'Making this look easy',
    'Doing the maths twice',
    'Glaring at the 25 MB limit',
    'Whistling casually',
  ],
}

export const dogFact = 'Dog fact: no two dogs have the same nose print. It works like a fingerprint. (Nothing to do with decks. You looked like you needed a break.)'

export const commentaryKeyFor = (stage: StageKey | null): CommentaryKey =>
  stage === 'read' || stage === 'tidy' || stage === 'photos' || stage === 'verify' || stage === 'split' || stage === 'flatten' ? stage : stage === 'resize' || stage === 'sharpen' ? 'photos' : 'any'

export const readyCopy = {
  eyebrow: 'Checked on this device',
  title: 'Ready to attach.',
  fitsTitle: 'Good news: it already fits.',
  fitsBody: 'Attach your original exactly as it is. We didn’t change a byte.',
  // The confirmation under "it already fits": what it weighs on the way.
  fitsWeight: ({ deck, mailbox, conditional }: Weights) => conditional
    ? `At ${formatSize(deck)}, it’s within what Gmail to Gmail takes.`
    : `At ${formatSize(deck)}, it fits ${mailbox}, packing and all, with room left for your message.`,
  // Above the receipt: why it had to change at all.
  // `weights` are the original's.
  madeRoom: (weights: Weights) => {
    if (weights.conditional) return 'Here’s what we changed to get it under what Gmail to Gmail takes:'
    if (weighInFor(weights) === 'looks-like-it-fits') return `${formatSize(weights.deck)} looked like it would fit ${weights.mailbox}, but with your message the email would have come to about ${formatSize(weights.email)}. Here’s what we changed to get it in:`
    return `As an email it would have weighed about ${formatSize(weights.email)}. Here’s what we changed to get it in:`
  },
  // Above the receipt of a flattened deck.
  flattened: (weights: Weights) => weights.conditional
    ? 'Flattened, it fits what Gmail to Gmail takes. Here’s what that changed:'
    : `Flattened, it fits ${weights.mailbox}. Here’s what that changed:`,
  rather: 'Rather keep the text and links?',
  ratherAction: 'See the other ways',
  stamp: 'Fits',
  stampFits: 'Already fits',
  download: 'Download email version',
  downloadAgain: 'Download again',
  downloadOriginal: 'Download a renamed copy',
  downloadedNote: 'Check your downloads folder.',
  sameSlides: (pages: number) => `Same ${pages} ${pages === 1 ? 'slide' : 'slides'}, same order, same page sizes.`,
  conditional: 'Only send this one when you and every recipient are on Gmail or Google Workspace. Other mailboxes may turn it away.',
  stricter: 'Sending somewhere stricter?',
  stricterAction: 'Make a 20 MB version',
  startOver: 'Use another PDF',
  farewell: 'Go well, little deck.',
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type ReceiptLike = {
  candidate: { notes: string[] }
  receipt?: { lossless: boolean; longEdgePx?: number; images: { resized: number; resaved: number; untouched?: number }; paths?: { drawings: number } }
}

// The ready screen's "what we did" lines, from what the engine measured.
export function whatWeDid({ candidate, receipt }: ReceiptLike): string[] {
  if (!receipt) return candidate.notes
  if (receipt.lossless) return ['Tidied the file’s insides. Nothing you can see changed.']
  const { resized, resaved } = receipt.images
  const lines: string[] = []
  if (resized && receipt.longEdgePx) lines.push(`Shrank ${count(resized, 'photo', 'photos')} that were bigger than they needed to be, to at least ${receipt.longEdgePx.toLocaleString('en')} pixels across the slide.`)
  if (resaved) lines.push(`Re-saved ${count(resaved, 'photo', 'photos')} a little lighter.`)
  if (receipt.images.untouched) lines.push(`Left ${count(receipt.images.untouched, 'photo', 'photos')} exactly as ${receipt.images.untouched === 1 ? 'it was' : 'they were'}.`)
  if (receipt.paths?.drawings) lines.push('Trimmed the drawings’ coordinates to finer than any screen can show.')
  lines.push('Text, fonts and links weren’t touched.')
  return lines
}

// The receipt of a flattened deck: what it cost, said as plainly as what it saved.
export function whatFlatteningDid(flatten: { pages: number; longEdgePx?: number } | undefined, pages: number): string[] {
  const slides = flatten?.pages ?? pages
  const across = flatten?.longEdgePx ? `, ${flatten.longEdgePx.toLocaleString('en')} pixels across` : ''
  return [
    `Turned ${slides === 1 ? 'the slide' : `all ${slides} slides`} into pictures${across}.`,
    'Text can’t be selected or searched now, and links won’t click.',
  ]
}

// When one email can't carry it. Say so plainly, say why, then give three
// ways out: a link keeps the deck whole, parts keep it in the inbox, and
// flattening keeps it in one file at a cost we spell out before anyone pays it.
export const cantFitCopy = {
  eyebrow: 'Too big for one email',
  title: 'We can’t get this one into a single email.',
  // `weight` is where the lightest version's bytes are, when the engine says.
  reason: (reason: string | undefined, lightest: string, weights: Weights, weight?: { keptImagesBytes: number; otherBytes: number }) => {
    const takes = `${capitalise(weights.mailbox)} takes decks up to ${formatSize(weights.budget)}.`
    if (reason === 'browser-cannot-resize') return `This browser can’t resize photos, and photos are where the room usually is. The lightest it can make this deck is ${lightest}. ${takes} Chrome or Brave on a laptop may well fit it in one.`
    if (reason === 'not-photos') return weight?.otherBytes
      ? `Most of what’s left isn’t photos. About ${formatSize(weight.otherBytes)} of it is drawings, outlined text, fonts or files tucked inside, which we can only trim a little, so the lightest we can make it is ${lightest}. ${takes}`
      : `Most of what’s left isn’t photos. It’s drawings, outlined text, fonts or files tucked inside, which we can only trim a little, so the lightest we can make it is ${lightest}. ${takes}`
    if (reason === 'kept-images') return `${weight?.keptImagesBytes ? `About ${formatSize(weight.keptImagesBytes)} of this deck is` : 'Most of its weight is in'} images we leave exactly as they are, like print-ready CMYK photos or JPEG 2000 files, because rewriting them could shift the colours or break them. The lightest we can make it is ${lightest}. ${takes}`
    if (reason === 'quality-floor') return `The lightest we can make it without blurring your slides is ${lightest}. ${takes} Getting the rest off would mean blurry photos, and nobody should have to squint at your deck.`
    return `The lightest we can make it is ${lightest}. ${takes}`
  },
  ways: (count: number) => `${count === 3 ? 'Three' : 'Two'} ways to send it anyway:`,
  linkTitle: 'Send one link',
  linkBadge: 'Our pick',
  linkBody: 'Your whole deck, full quality, in one piece. Put it on Google Drive or another free service, and email the link instead of the file.',
  linkMore: 'How to send it by link, for free',
  partsTitle: (count: number) => `Split it into ${count} emails`,
  partsBody: 'Every slide stays sharp, and every link still works. The catch: your recipient gets more than one email and has to open them in order.',
  partsEven: (count: number) => count === 2
    ? 'We’ve set it to two halves of about the same size. Move it so the split lands between sections, not mid-story.'
    : `We’ve set it to ${count} parts of about the same size. Move the splits so they land between sections, not mid-story.`,
  breakLabel: (index: number, count: number) => count === 2 ? 'Split after slide' : `Email ${index} ends after slide`,
  partLine: (index: number, start: number, end: number) => `Email ${index} · ${start === end ? `slide ${start}` : `slides ${start}–${end}`}`,
  partOver: 'too big',
  partsOver: (index: number, budget: string) => `Email ${index} comes to more than ${budget}. Move a split so it carries fewer slides.`,
  splitHere: 'Split it here',
  splitForMe: 'Split it for me',
  flattenTitle: 'Flatten it',
  flattenBadge: 'Last resort',
  flattenBody: 'We turn every slide into a single picture, then squeeze the pictures. It stays one file and looks much the same on a screen. What it costs:',
  flattenCosts: [
    'Text can’t be selected, searched or copied.',
    'Links stop working.',
    'Small type goes a little soft.',
  ],
  flattenMaybe: 'It might still be too big. If it is, we’ll say so, and the other two ways will be right here.',
  flattenAction: 'Flatten it and try',
  // After a flatten that still didn't fit.
  flattenMiss: (lightest: string, weights: Weights) => `We tried. Even flattened, the lightest we can make it is ${lightest}, and ${weights.mailbox} takes decks up to ${formatSize(weights.budget)}. Some decks are simply too much deck for one email. A link or a split will carry it.`,
  gmailHint: 'Sending from Gmail to Gmail or Google Workspace? Gmail takes a little more, so it may fit in one.',
  gmailAction: 'Try Gmail to Gmail',
}

export const splitCopy = {
  eyebrow: (count: number) => `Split into ${count} emails`,
  title: 'Your deck, in parts.',
  body: (count: number, mailbox: string) => `Each part fits ${mailbox}. Send ${count === 2 ? 'both' : `all ${count}`} in order, and mention there’s more than one.`,
  partOver: (budget: string) => `Over ${budget}. Move the split and try again.`,
  change: 'Change where it splits',
  downloadAll: (count: number) => count === 2 ? 'Download both' : `Download all ${count}`,
  download: 'Download',
  planTitle: 'Your email plan',
  planIntro: 'Send them in order. Here’s everything to paste:',
  copy: 'Copy the plan',
  copied: 'Copied',
  copyFailed: 'Your browser blocked copying. Select the text and copy it yourself.',
  subject: (deck: string, index: number, total: number) => `${deck} (part ${index} of ${total})`,
  emailBody: (deck: string, index: number, total: number, start: number, end: number) =>
    `Hi,\n\nI’m sending ${deck} in ${total} parts so every slide stays sharp. This is part ${index} of ${total} (${start === end ? `slide ${start}` : `slides ${start}–${end}`}).\n\n`,
}

export type ErrorKind = 'not-pdf' | 'damaged' | 'too-big' | 'timeout' | 'password' | 'restricted' | 'protected' | 'page-too-large' | 'engine' | 'read' | 'unknown'

export const errorCopy: Record<ErrorKind, { title: string; body: string }> = {
  'not-pdf': {
    title: 'That’s not a PDF.',
    body: 'Export your deck as a PDF first. In most apps it’s under File, then Export or Download. Then drop it here.',
  },
  damaged: {
    title: 'This PDF is a little broken.',
    body: 'We couldn’t read it safely, so we stopped before changing anything. Export a fresh copy from your presentation app and drop that in.',
  },
  'too-big': {
    title: 'That’s a lot of deck.',
    body: 'It’s more than this browser can safely hold in one go. Try a laptop, or export the deck with smaller images and drop it in again.',
  },
  timeout: {
    title: 'This one’s too heavy for this device.',
    body: 'It went a whole minute without getting anywhere, so we stopped rather than leave you waiting. Try Chrome or Brave on a laptop, or export the deck with smaller images.',
  },
  password: {
    title: 'This PDF is locked.',
    body: 'We won’t try to open a password-protected file. Export an unlocked copy from the app you made it in, then try again.',
  },
  restricted: {
    title: 'This PDF has security settings.',
    body: 'We won’t quietly remove them. Export a fresh copy without restrictions, then try again.',
  },
  protected: {
    title: 'This PDF has parts we won’t touch.',
    body: 'It has forms, signatures, attachments or scripts, and rewriting the file could quietly break them. Export a flattened copy and try again.',
  },
  'page-too-large': {
    title: 'One page is too heavy on its own.',
    body: 'Even by itself, it won’t fit the limit you picked. Try a bigger limit, or replace that page’s artwork with a lighter image.',
  },
  engine: {
    title: 'Something in the engine tripped.',
    body: 'Your file is fine and still on your device. Reload the page and try again, or try Chrome or Brave. If it keeps happening, tell us at hello@pitch.dog.',
  },
  read: {
    title: 'We couldn’t open that file.',
    body: 'This browser couldn’t read it. Check it opens in a PDF viewer, then try again.',
  },
  unknown: {
    title: 'We couldn’t make a version we’d send.',
    body: 'Your original is untouched and still on your device. If it keeps happening, tell us at hello@pitch.dog.',
  },
}

// When the engine says what kind of protection it found.
export const protectedCopy: Record<string, string> = {
  forms: 'It has form fields, and rewriting the file could quietly break them. Export a flattened copy and try again.',
  signature: 'It carries a digital signature, and any change to the file would break it. Send the signed original as it is, or export an unsigned copy.',
  attachments: 'It has other files tucked inside it, and rewriting it could lose them. Export a copy without attachments and try again.',
  javascript: 'It has scripts inside it, and we don’t rewrite those. Export a plain copy and try again.',
}

export const pageTooLargeTitle = (page: number) => `Slide ${page} is too heavy on its own.`

export function errorKindFor(message: string, code?: unknown): ErrorKind {
  if (typeof code === 'string' && code in errorCopy) return code as ErrorKind
  const text = message.toLowerCase()
  if (/does not look like a pdf|not a pdf|choose a pdf/.test(text)) return 'not-pdf'
  if (/password/.test(text)) return 'password'
  if (/restrict|permission/.test(text)) return 'restricted'
  if (/protected|flatten/.test(text)) return 'protected'
  if (/page \d+ is too large/.test(text)) return 'page-too-large'
  if (/too long|timed out|timeout/.test(text)) return 'timeout'
  if (/memory budget|too large for/.test(text)) return 'too-big'
  if (/could not be read|couldn.t read/.test(text)) return 'read'
  if (/engine|worker/.test(text)) return 'engine'
  return 'unknown'
}

export const unsupportedCopy = {
  title: 'This browser can’t run the engine.',
  body: 'Email My Deck needs a recent browser. Open this page in Chrome or Brave, or in Safari on your phone. Your deck stays on whichever device you use.',
  copyLink: 'Copy this page’s link',
  copied: 'Link copied',
}

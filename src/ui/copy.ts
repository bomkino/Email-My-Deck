import type { TargetProfileId } from '../lib/profiles'

// Every word the tool says lives here, so voice edits never touch logic.

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

export type StageKey = 'read' | 'tidy' | 'photos' | 'resize' | 'verify' | 'split' | 'work'

export const stageCopy: Record<StageKey, string> = {
  read: 'Opening your deck. Nobody else is invited.',
  tidy: 'Tidying the file’s insides. Your slides won’t notice.',
  photos: 'Asking the photos to pack lighter',
  resize: 'Shrinking photos that were dressed for a billboard',
  verify: 'Counting every slide back in',
  split: 'Splitting it into parts. Nobody gets left behind.',
  work: 'Trying on versions until one fits',
}

// Map whatever the engine reports onto plain words. Unknown labels fall
// back to the engine's own text, so a new stage never shows a blank line.
export function stageFor(label: string, stage?: unknown): StageKey | null {
  if (typeof stage === 'string' && stage in stageCopy) return stage as StageKey
  if (typeof stage === 'string') {
    if (/inspect|read/i.test(stage)) return 'read'
    if (/ghost|strong|resample|downsample/i.test(stage)) return 'resize'
  }
  const text = label.toLowerCase()
  if (!text) return null
  if (/split|part/.test(text)) return 'split'
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
export type CommentaryKey = 'read' | 'tidy' | 'photos' | 'verify' | 'split' | 'any'

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
    'One email can’t carry all of this without squashing it, so your deck is getting a travel companion or two.',
    'Splitting between slides, never through one. Nobody gets cut in half.',
    'Two emails with sharp slides beat one email that makes someone squint. It wasn’t a close vote.',
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

export const dogFact = 'Dog fact: no two dogs have the same nose print. It works like a fingerprint. (Nothing to do with decks. You looked like you needed a break.)'

export const commentaryKeyFor = (stage: StageKey | null): CommentaryKey =>
  stage === 'read' || stage === 'tidy' || stage === 'photos' || stage === 'verify' || stage === 'split' ? stage : stage === 'resize' ? 'photos' : 'any'

export const readyCopy = {
  eyebrow: 'Checked on this device',
  title: 'Ready to attach.',
  fitsTitle: 'Good news: it already fits.',
  fitsBody: 'Attach your original exactly as it is. We didn’t change a byte.',
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
  receipt?: { lossless: boolean; longEdgePx?: number; images: { resized: number; resaved: number } }
}

// The ready screen's "what we did" lines, from what the engine measured.
export function whatWeDid({ candidate, receipt }: ReceiptLike): string[] {
  if (!receipt) return candidate.notes
  if (receipt.lossless) return ['Tidied the file’s insides. Nothing you can see changed.']
  const { resized, resaved } = receipt.images
  const lines: string[] = []
  if (resized && receipt.longEdgePx) lines.push(`Shrank ${count(resized, 'photo', 'photos')} that were bigger than they needed to be, to ${receipt.longEdgePx.toLocaleString('en')} pixels across the slide.`)
  if (resaved) lines.push(`Re-saved ${count(resaved, 'photo', 'photos')} a little lighter.`)
  lines.push('Text, fonts and links weren’t touched.')
  return lines
}

export const splitCopy = {
  eyebrow: 'Split, not smudged',
  title: (count: number) => `This one goes in ${count} emails.`,
  body: (count: number, reason?: string) => `${reason === 'browser-cannot-resize'
    ? 'This browser can’t resize photos, so we split the deck rather than squash it. Chrome or Brave on a laptop may fit it in one.'
    : 'Squeezing it into one file would have made your slides blurry, so we split it instead.'} ${count === 2 ? 'Both parts stay' : `All ${count} parts stay`} sharp, and each one fits the limit you picked.`,
  downloadAll: (count: number) => `Download all ${count}`,
  download: 'Download',
  planTitle: 'Your email plan',
  planIntro: 'Send them in order. Here’s everything to paste:',
  copy: 'Copy the plan',
  copied: 'Copied',
  copyFailed: 'Your browser blocked copying. Select the text and copy it yourself.',
  subject: (deck: string, index: number, total: number) => `${deck} (part ${index} of ${total})`,
  emailBody: (deck: string, index: number, total: number, start: number, end: number) =>
    `Hi,\n\nI’m sending ${deck} in ${total} parts so every slide stays sharp. This is part ${index} of ${total} (${start === end ? `page ${start}` : `pages ${start}–${end}`}).\n\n`,
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
    body: 'Your file is fine and still on your device. Reload the page and try again, or try Chrome or Brave.',
  },
  read: {
    title: 'We couldn’t open that file.',
    body: 'This browser couldn’t read it. Check it opens in a PDF viewer, then try again.',
  },
  unknown: {
    title: 'We couldn’t make a version we’d send.',
    body: 'Your original is untouched and still on your device.',
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

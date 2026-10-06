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
  read: 'Opening your deck, on this device only',
  tidy: 'Tidying the file’s insides. Slides untouched.',
  photos: 'Re-saving photos at screen quality',
  resize: 'Shrinking photos that are bigger than any screen',
  verify: 'Counting every slide back in',
  split: 'Dealing the slides into parts that fit',
  work: 'Working out the best-looking version that fits',
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
  splittingTitle: 'Packing it into parts',
  workingTitle: 'Making it fit',
  cancel: 'Cancel',
  tipsEyebrow: 'While you wait',
  dogFactEyebrow: 'A short break',
  anotherTip: 'Another tip',
  // The line under the bar changes as the wait gets longer. Each one is true:
  // the device does the work, and the watchdog stops a stalled job and says so.
  waits: [
    { after: 0, text: 'Nothing is being uploaded. Your device is doing the heavy lifting, so a big deck can take a minute or two.' },
    { after: 25_000, text: 'Still going. Big photos take a while to repack, and your device is doing every one of them itself.' },
    { after: 75_000, text: 'Still at it. A deck this size can take a few minutes, especially on a phone. The upside: nobody else ever gets a copy.' },
    { after: 150_000, text: 'A long one, but it’s still working. If it ever stalls, we’ll stop and say so. Good moment for a glass of water.' },
  ],
}

export const waitFor = (elapsed: number) => [...busyCopy.waits].reverse().find((wait) => elapsed >= wait.after)?.text ?? busyCopy.waits[0].text

// Loading-screen tips. Useful first, then the turn. One dog fact, because
// someone has to keep the dogs in the conversation.
export const tips: string[] = [
  'This deck is about to be read without you in the room. Nobody will be there to say “so what this slide is saying is…”, so the slide has to say it.',
  'Name the file like someone will search for it at midnight. “Acme-Series-A-2026.pdf” beats “FINAL_final_v7 (2).pdf”.',
  'Put the ask on a slide, with a number in it. “We’d love your support” is a mood. “2 million for 18 months” is a question someone can say yes to.',
  'If you have to apologise for a slide (“sorry, this one’s busy”), you already know what to do with it.',
  'Squint at each slide. Whatever you can still make out is what it’s about. Hopefully on purpose.',
  'Decks get forwarded. Put your name and email on the last slide so yours can find its way home.',
  'A number needs company. “40%” of what, since when, compared to whom?',
  'Give every chart a headline that says what to see. “Revenue doubled” beats “Revenue, 2024–2026”. Nobody has ever been moved by an axis label.',
  'Your deck doesn’t have to explain everything. It has to earn the meeting where you do.',
  'Heavy decks are usually heavy because of three enormous photos. A 6,000-pixel image on a slide is a poster in disguise.',
  'Video rarely survives the trip into a PDF. Put in your best frame and a link. People click a good still. Nobody clicks a mysterious grey rectangle.',
  'Light grey text on white looks elegant on your screen and invisible on everyone else’s.',
  'Page numbers, please. Somebody will want to say “about slide 12…” in the reply.',
  'One idea per slide. Two if they’re small and get along.',
  'Read it out loud once. The slide you rush through is the one to cut.',
  'The appendix is where good slides go to be optional. Let them.',
  'A bullet point with its own bullet points is a document wearing a slide costume.',
  'Do the maths for your reader. Nobody opens a calculator to fall for a business. Show the working in the appendix.',
  'Fonts tend to go missing when you send the slides file itself. A PDF keeps them. Which, look at you, you already knew.',
  'Typos are tiny and somehow the only thing anyone remembers. One more read before you send.',
  'Save the mystery for the film. The first slide should say what this is in one line.',
  'Write the email like it’s slide zero. It gets read first.',
  'Plenty of decks get opened on a phone first, between two other things. Check that your smallest text survives that.',
  'Logos of companies you’ve talked to are not traction. Logos of companies that paid you are.',
  'If the team slide is the best slide, either the team is great or the rest needs work. Possibly both.',
  'Dog fact: no two dogs have the same nose print. It works like a fingerprint. (Nothing to do with decks. You looked like you needed a break.)',
]

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

export const whatWeDid: Record<string, string> = {
  original: 'Nothing. It was already small enough.',
  'qpdf:preserved': 'Tidied the file’s insides. Nothing you can see changed.',
  'qpdf:optimized': 'Re-saved the photos a little lighter. Text stayed text.',
  'ghostscript:strong': 'Shrank oversized photos to screen size. Text stayed text.',
}

export const splitCopy = {
  eyebrow: 'Split, not smudged',
  title: (count: number) => `This one goes in ${count} emails.`,
  body: (count: number) => `Squeezing it into one file would have made your slides blurry, so we split it instead. ${count === 2 ? 'Both parts stay' : `All ${count} parts stay`} sharp, and each one fits the limit you picked.`,
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

export type ErrorKind = 'not-pdf' | 'too-big' | 'timeout' | 'password' | 'restricted' | 'protected' | 'page-too-large' | 'engine' | 'read' | 'unknown'

export const errorCopy: Record<ErrorKind, { title: string; body: string }> = {
  'not-pdf': {
    title: 'That’s not a PDF.',
    body: 'Export your deck as a PDF first. In most apps it’s under File, then Export or Download. Then drop it here.',
  },
  'too-big': {
    title: 'That’s a lot of deck.',
    body: 'It’s more than this browser can safely hold in one go. Try a laptop, or export the deck with smaller images and drop it in again.',
  },
  timeout: {
    title: 'This one’s too heavy for this device.',
    body: 'It went two minutes without getting anywhere, so we stopped rather than leave you waiting. Try Chrome or Brave on a laptop, or export the deck with smaller images.',
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

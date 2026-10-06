import { describe, expect, it } from 'vitest'
import { busyCopy, cantFitCopy, commentary, curveBalls, dogFact, mailboxName, stageFor, waitFor, whatWeDid, type Weights } from '../src/ui/copy'

const MB = 1_000_000
const weights = (limitMB: number): Weights => ({ deck: 24 * MB, email: 33 * MB, limit: limitMB * MB, budget: 5.5 * MB, mailbox: mailboxName('custom', limitMB * MB), conditional: false })

describe('page copy', () => {
  it('says "an" before sizes that are said with a vowel', () => {
    expect(mailboxName('custom', 8 * MB)).toBe('an 8 MB limit')
    expect(mailboxName('custom', 11 * MB)).toBe('an 11 MB limit')
    expect(mailboxName('common-25', 25 * MB)).toBe('a 25 MB mailbox')
    expect(mailboxName('strict-20', 20 * MB)).toBe('a 20 MB mailbox')
    expect(mailboxName('custom', 15 * MB)).toBe('a 15 MB limit')
  })

  it('treats the photo size as a floor and owns up to trimmed drawings', () => {
    const lines = whatWeDid({ candidate: { notes: [] }, receipt: { lossless: false, longEdgePx: 1920, images: { resized: 3, resaved: 0, untouched: 1 }, paths: { drawings: 12 } } })
    expect(lines[0]).toContain('to at least 1,920 pixels')
    expect(lines).toContain('Trimmed the drawings’ coordinates to finer than any screen can show.')
    expect(lines.at(-1)).toBe('Text, fonts and links weren’t touched.')
  })

  it('names how much of a deck we can only trim, when the engine says', () => {
    const line = cantFitCopy.reason('not-photos', '10.2 MB', weights(8), { keptImagesBytes: 0, otherBytes: 5.4 * MB })
    expect(line).toContain('About 5.4 MB of it is drawings')
    expect(line).toContain('An 8 MB limit takes decks up to 5.5 MB.')
    expect(cantFitCopy.reason('kept-images', '10.2 MB', weights(8), { keptImagesBytes: 7 * MB, otherBytes: 0 })).toMatch(/^About 7 MB of this deck is images we leave exactly as they are/)
    expect(cantFitCopy.reason('kept-images', '10.2 MB', weights(8))).toMatch(/^Most of its weight is in images/)
  })

  it('gives the last sharpening pass its own words', () => {
    expect(stageFor('Using the room left for sharper photos', 'resize')).toBe('sharpen')
    expect(stageFor('Resizing photos to screen size', 'resize')).toBe('resize')
  })

  it('keeps talking through a long wait, with one dog fact in all', () => {
    const afters = busyCopy.waits.map((wait) => wait.after)
    expect(afters).toEqual([...afters].sort((a, b) => a - b))
    expect(waitFor(0)).toBe(busyCopy.waits[0].text)
    expect(waitFor(11 * 60_000)).toBe(busyCopy.waits.at(-1)!.text)
    const lines = [...Object.values(commentary).flat(), ...Object.values(curveBalls).flat(), ...busyCopy.waits.map((wait) => wait.text), dogFact]
    expect(lines.filter((line) => /\bdogs?\b/i.test(line))).toEqual([dogFact])
    expect(new Set(lines).size).toBe(lines.length)
  })
})

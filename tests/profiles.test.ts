import { describe, expect, it } from 'vitest'
import { emailVersionName } from '../src/lib/filename'
import { estimatedMessageBytes, getTargetProfile, rawBudgetBytes } from '../src/lib/profiles'

describe('target profiles', () => {
  it('leaves wire headroom for the common profile', () => {
    const profile = getTargetProfile('common-25')
    expect(rawBudgetBytes(profile)).toBeGreaterThan(17 * 1024 * 1024)
    expect(estimatedMessageBytes(rawBudgetBytes(profile), profile)).toBeLessThanOrEqual(profile.maxMessageBytes)
  })

  it('keeps the Gmail option explicitly conditional', () => {
    expect(getTargetProfile('gmail-advanced').conditional).toBe(true)
  })
})

describe('email filenames', () => {
  it('adds a deterministic suffix and sanitizes unsafe characters', () => {
    expect(emailVersionName('Board / Q4: plan.pdf')).toBe('Board - Q4- plan-email-version.pdf')
    expect(emailVersionName('Board.pdf', { index: 2, total: 3 })).toBe('Board-email-version-part-02-of-03.pdf')
  })
})

import { describe, expect, it } from 'vitest'
import { emailVersionName } from '../src/lib/filename'
import { CUSTOM_MAX_MB, CUSTOM_MIN_MB, estimatedMessageBytes, getTargetProfile, MB, rawBudgetBytes, TARGET_PROFILES } from '../src/lib/profiles'

describe('target profiles', () => {
  it('keeps every unconditional profile’s whole message under its stated cap', () => {
    const profiles = [...Object.values(TARGET_PROFILES), ...[5, 10, 20, 25, 35, 50, 70].map((mb) => getTargetProfile('custom', mb))]
    for (const profile of profiles.filter((profile) => !profile.conditional)) {
      expect(estimatedMessageBytes(rawBudgetBytes(profile), profile), profile.label).toBeLessThanOrEqual(profile.maxMessageBytes)
    }
  })

  it('reads a custom limit as decimal megabytes, like the presets', () => {
    const custom = getTargetProfile('custom', 25)
    expect(custom.maxMessageBytes).toBe(25 * MB)
    const estimate = estimatedMessageBytes(rawBudgetBytes(custom), custom)
    expect(estimate).toBeLessThanOrEqual(25_000_000)
    expect(estimate).toBeGreaterThan(24_900_000)
    // A custom 25 MB limit is never looser than the "Common 25 MB" preset.
    expect(rawBudgetBytes(custom)).toBeLessThanOrEqual(rawBudgetBytes(getTargetProfile('common-25')) + 100_000)
  })

  it('clamps custom limits to the supported range', () => {
    expect(getTargetProfile('custom', 1).maxMessageBytes).toBe(CUSTOM_MIN_MB * MB)
    expect(getTargetProfile('custom', 500).maxMessageBytes).toBe(CUSTOM_MAX_MB * MB)
    expect(getTargetProfile('custom', Number.NaN).maxMessageBytes).toBe(25 * MB)
  })

  it('keeps the Gmail option explicitly conditional, with the file itself under 25 MB', () => {
    const gmail = getTargetProfile('gmail-advanced')
    expect(gmail.conditional).toBe(true)
    expect(rawBudgetBytes(gmail)).toBeLessThanOrEqual(25 * MB)
  })
})

describe('email filenames', () => {
  it('adds a deterministic suffix and sanitizes unsafe characters', () => {
    expect(emailVersionName('Board / Q4: plan.pdf')).toBe('Board - Q4- plan-email-version.pdf')
    expect(emailVersionName('Board.pdf', { index: 2, total: 3 })).toBe('Board-email-version-part-02-of-03.pdf')
  })
})

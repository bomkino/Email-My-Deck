export type TargetProfileId = 'common-25' | 'strict-20' | 'gmail-advanced' | 'custom'

export type TargetProfile = {
  id: TargetProfileId
  label: string
  detail: string
  maxMessageBytes: number
  bodyReserveBytes: number
  recommendedRawBytes: number
  conditional?: boolean
}

export const MIB = 1024 * 1024

export const TARGET_PROFILES: Record<Exclude<TargetProfileId, 'custom'>, TargetProfile> = {
  'common-25': {
    id: 'common-25',
    label: 'Common 25 MB mail systems',
    detail: 'Many 25 MB mailboxes; provider limits vary',
    maxMessageBytes: 25_000_000,
    bodyReserveBytes: 512 * 1024,
    recommendedRawBytes: 17 * MIB,
  },
  'strict-20': {
    id: 'strict-20',
    label: 'Strict 20 MB message limits',
    detail: 'More headroom for older or stricter systems',
    maxMessageBytes: 20_000_000,
    bodyReserveBytes: 512 * 1024,
    recommendedRawBytes: 13.5 * MIB,
  },
  'gmail-advanced': {
    id: 'gmail-advanced',
    label: 'Gmail sender → Gmail / Workspace',
    detail: 'Advanced: only when both sides support Gmail limits',
    maxMessageBytes: 25_000_000,
    bodyReserveBytes: 512 * 1024,
    recommendedRawBytes: 23 * MIB,
    conditional: true,
  },
}

export function getTargetProfile(id: TargetProfileId, customMessageMiB = 25): TargetProfile {
  if (id !== 'custom') return TARGET_PROFILES[id]
  const normalizedMiB = Math.min(70, Math.max(5, Number.isFinite(customMessageMiB) ? customMessageMiB : 25))
  const maxMessageBytes = normalizedMiB * MIB
  return {
    id,
    label: `Custom ${normalizedMiB} MB message limit`,
    detail: 'A measured ceiling you choose',
    maxMessageBytes,
    bodyReserveBytes: 512 * 1024,
    recommendedRawBytes: Math.max(1, (maxMessageBytes - 512 * 1024) / 1.3684 / MIB) * MIB,
  }
}

export function estimatedMessageBytes(rawPdfBytes: number, profile: TargetProfile): number {
  // RFC 2045 base64 plus line wrapping is approximately 1.3684x, with a small body reserve.
  return Math.ceil(rawPdfBytes * 1.3684 + profile.bodyReserveBytes)
}

export function rawBudgetBytes(profile: TargetProfile): number {
  // Keep the named presets stable and deliberately conservative. Custom
  // profiles calculate their own raw budget in getTargetProfile().
  return Math.max(1, Math.floor(profile.recommendedRawBytes))
}

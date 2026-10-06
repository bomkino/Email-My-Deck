export type TargetProfileId = 'common-25' | 'strict-20' | 'gmail-advanced' | 'custom'

export type TargetProfile = {
  id: TargetProfileId
  label: string
  detail: string
  /** Mailbox limit for the whole message, in bytes (decimal: 1 MB = 1,000,000 bytes). */
  maxMessageBytes: number
  bodyReserveBytes: number
  recommendedRawBytes: number
  conditional?: boolean
}

/** Decimal megabyte, as mail providers and Finder count it. */
export const MB = 1_000_000
export const MIB = 1024 * 1024
/** Base64 with MIME line breaks grows an attachment by about 1.3684×. */
export const MIME_OVERHEAD = 1.3684
export const BODY_RESERVE_BYTES = 512 * 1024

export const TARGET_PROFILES: Record<Exclude<TargetProfileId, 'custom'>, TargetProfile> = {
  'common-25': {
    id: 'common-25',
    label: 'Common 25 MB mail systems',
    detail: 'Many 25 MB mailboxes; provider limits vary',
    maxMessageBytes: 25 * MB,
    bodyReserveBytes: BODY_RESERVE_BYTES,
    recommendedRawBytes: 17 * MIB,
  },
  'strict-20': {
    id: 'strict-20',
    label: 'Strict 20 MB message limits',
    detail: 'More headroom for older or stricter systems',
    maxMessageBytes: 20 * MB,
    bodyReserveBytes: BODY_RESERVE_BYTES,
    recommendedRawBytes: 13.5 * MIB,
  },
  'gmail-advanced': {
    id: 'gmail-advanced',
    label: 'Gmail sender → Gmail / Workspace',
    detail: 'Advanced: only when both sides support Gmail limits',
    maxMessageBytes: 25 * MB,
    bodyReserveBytes: BODY_RESERVE_BYTES,
    recommendedRawBytes: 23 * MIB,
    conditional: true,
  },
}

export const CUSTOM_MIN_MB = 5
export const CUSTOM_MAX_MB = 70

/**
 * `customMessageMB` is a decimal megabyte limit for the whole message, the
 * same unit as the presets ("25 MB" means 25,000,000 bytes).
 */
export function getTargetProfile(id: TargetProfileId, customMessageMB = 25): TargetProfile {
  if (id !== 'custom') return TARGET_PROFILES[id]
  const normalized = Math.min(CUSTOM_MAX_MB, Math.max(CUSTOM_MIN_MB, Number.isFinite(customMessageMB) ? customMessageMB : 25))
  const maxMessageBytes = Math.round(normalized * MB)
  return {
    id,
    label: `Custom ${normalized} MB message limit`,
    detail: 'A measured ceiling you choose',
    maxMessageBytes,
    bodyReserveBytes: BODY_RESERVE_BYTES,
    recommendedRawBytes: Math.max(1, Math.floor((maxMessageBytes - BODY_RESERVE_BYTES) / MIME_OVERHEAD)),
  }
}

export function estimatedMessageBytes(rawPdfBytes: number, profile: TargetProfile): number {
  // RFC 2045 base64 plus line wrapping is approximately 1.3684x, with a small body reserve.
  return Math.ceil(rawPdfBytes * MIME_OVERHEAD + profile.bodyReserveBytes)
}

export function rawBudgetBytes(profile: TargetProfile): number {
  return Math.max(1, Math.floor(profile.recommendedRawBytes))
}

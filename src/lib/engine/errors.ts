/**
 * Error codes the worker sends to the UI. The UI writes its own headline per
 * code and shows `message` as the body, so every message here must be a plain,
 * accurate instruction for a non-technical person.
 */
export type EngineErrorCode =
  | 'not-pdf'
  | 'damaged'
  | 'password'
  | 'restricted'
  | 'protected'
  | 'timeout'
  | 'too-big'
  | 'page-too-large'
  | 'engine'

export type ProtectedReason = 'forms' | 'signature' | 'attachments' | 'javascript'

export class EngineError extends Error {
  readonly code: EngineErrorCode
  readonly reason?: ProtectedReason
  readonly page?: number

  constructor(code: EngineErrorCode, message: string, extra: { reason?: ProtectedReason; page?: number } = {}) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.reason = extra.reason
    this.page = extra.page
  }
}

const PROTECTED_MESSAGES: Record<ProtectedReason, string> = {
  forms: 'This PDF has fillable form fields. Export a flattened copy without form fields, then try again.',
  signature: 'This PDF is digitally signed, and any change would break the signature. Send the signed original, or export an unsigned copy and try again.',
  attachments: 'This PDF carries attached files. Export a copy without attachments, then try again.',
  javascript: 'This PDF contains scripts. Export a plain copy without scripts, then try again.',
}

export function protectedError(reason: ProtectedReason): EngineError {
  return new EngineError('protected', PROTECTED_MESSAGES[reason], { reason })
}

export const MESSAGES = {
  notPdf: 'This file does not look like a PDF. Export your deck as a PDF and try again.',
  damaged: 'This PDF looks damaged, so we could not read it safely. Export a fresh copy from your presentation app and try again.',
  password: 'This PDF needs a password to open. Export a copy without a password, then try again.',
  restricted: 'This PDF has security settings that limit changes, and we won’t quietly remove them. Export a fresh copy without restrictions, then try again.',
  tooBig: 'This PDF is too large for this browser to process safely. Try a computer with more memory, or export the deck with smaller images.',
  engine: 'The PDF engine in this browser stopped unexpectedly. Try again, or try a different browser.',
} as const

/** Map anything thrown inside the engine to a coded error. */
export function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return error
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (/RangeError|out of memory|\bOOM\b|Array buffer allocation|Cannot enlarge memory/i.test(text)) return new EngineError('too-big', MESSAGES.tooBig)
  return new EngineError('engine', MESSAGES.engine)
}

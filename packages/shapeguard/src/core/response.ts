// ─────────────────────────────────────────────
// core/response.ts — shapeguard
// Envelope builders with deepFreeze and circular detection.
// ─────────────────────────────────────────────

import type {
  SuccessEnvelope,
  ErrorEnvelope,
  ValidationIssue,
  PaginatedData,
  ResponseConfig,
} from '../types/index.js'

// ── deepFreeze (exported for unit tests) ──────
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const val of Object.values(obj as object)) deepFreeze(val)
  return obj
}

// ── detectCircular (exported for unit tests) ──
export function detectCircular(obj: unknown, seen = new WeakSet()): void {
  if (obj === null || typeof obj !== 'object') return
  if (seen.has(obj as object)) throw new Error('Circular reference detected in response data')
  seen.add(obj as object)
  for (const val of Object.values(obj as object)) detectCircular(val, seen)
}

// ── shallowFreeze — freeze only the envelope, not the data inside ────────
// deepFreeze was freezing the caller's data object too, which meant code like:
//   const user = { name: 'Alice' }
//   res.created({ data: user })
//   user.name = 'Bob'  // ← would throw in strict mode silently fail otherwise
// Callers should be able to mutate their own objects after sending a response.
function shallowFreezeEnvelope<T extends object>(obj: T): T {
  return Object.freeze(obj)
}

// ── Build success envelope ────────────────────
export function buildSuccess<T>(data: T, message: string, config?: ResponseConfig): SuccessEnvelope<T> {
  const envelope = { success: true as const, message, data }
  const shaped   = applyShape(envelope as unknown as Record<string, unknown>, config?.shape)
  return shallowFreezeEnvelope(shaped) as unknown as SuccessEnvelope<T>
}

// ── Build paginated envelope ──────────────────
export function buildPaginated<T>(
  data: T[], total: number, page: number, limit: number, message: string, config?: ResponseConfig,
): SuccessEnvelope<PaginatedData<T>> {
  const safeLimit = limit > 0 ? limit : 1
  return buildSuccess(
    { items: data, total, page, limit, pages: Math.ceil(total / safeLimit) },
    message,
    config,
  )
}

// ── Build error envelope ──────────────────────
export function buildError(
  code:    string,
  message: string,
  details: ValidationIssue | Record<string, unknown> | string | null,
  sanitize:  boolean,
  config?:   ResponseConfig,
): ErrorEnvelope {
  const envelope: ErrorEnvelope = {
    success: false,
    message,
    error: { code, message, details: sanitize && typeof details !== 'string' ? null : details },
  }
  const shaped = applyShape(envelope as unknown as Record<string, unknown>, config?.shape)
  return shallowFreezeEnvelope(shaped) as unknown as ErrorEnvelope
}

// ── Apply global shape mapping ────────────────
function applyShape(envelope: Record<string, unknown>, shape?: Record<string, string>): Record<string, unknown> {
  if (!shape) return envelope
  const result: Record<string, unknown> = {}
  for (const [newKey, token] of Object.entries(shape)) {
    result[newKey] = envelope[token.replace(/^\{(.+)\}$/, '$1')]
  }
  return result
}

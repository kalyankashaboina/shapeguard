import type {
  SuccessEnvelope,
  ErrorEnvelope,
  ValidationIssue,
  PaginatedData,
  ResponseConfig,
} from '../types/index.js'

export function detectCircular(obj: unknown, seen = new WeakSet()): void {
  if (obj === null || typeof obj !== 'object') return
  if (seen.has(obj as object)) throw new Error('Circular reference detected in response data')
  seen.add(obj as object)
  for (const val of Object.values(obj as object)) detectCircular(val, seen)
}

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const val of Object.values(obj as object)) deepFreeze(val)
  return obj
}

function freezeEnvelope<T extends object>(obj: T): T {
  return Object.freeze(obj)
}

export function buildSuccess<T>(data: T, message: string, config?: ResponseConfig): SuccessEnvelope<T> {
  const envelope = { success: true as const, message, data }
  const shaped   = applyShape(envelope as unknown as Record<string, unknown>, config?.shape)
  return freezeEnvelope(shaped) as unknown as SuccessEnvelope<T>
}

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
  return freezeEnvelope(shaped) as unknown as ErrorEnvelope
}

function applyShape(envelope: Record<string, unknown>, shape?: Record<string, string>): Record<string, unknown> {
  if (!shape) return envelope
  const result: Record<string, unknown> = {}
  for (const [newKey, token] of Object.entries(shape)) {
    result[newKey] = envelope[token.replace(/^\{(.+)\}$/, '$1')]
  }
  return result
}

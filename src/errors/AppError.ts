// ─────────────────────────────────────────────
// errors/AppError.ts — shapeguard
// Single error class. Throw anywhere. errorHandler catches everything.
// ─────────────────────────────────────────────

import type { ValidationIssue } from '../types/index.js'
import { ErrorCode } from '../types/index.js'

// HTTP status for pre-parse guard errors — they are client errors, never 500
const PP: Record<string, number> = {
  [ErrorCode.BODY_TOO_DEEP]:        400,
  [ErrorCode.BODY_ARRAY_TOO_LARGE]: 400,
  [ErrorCode.STRING_TOO_LONG]:      400,
  [ErrorCode.INVALID_CONTENT_TYPE]: 415,
  [ErrorCode.PARAM_POLLUTION]:      400,
  [ErrorCode.PROTO_POLLUTION]:      400,
}

export class AppError extends Error {
  readonly code:          string
  readonly statusCode:    number
  readonly details:       ValidationIssue | ValidationIssue[] | Record<string, unknown> | string | null
  readonly isAppError:    true = true
  readonly isOperational: boolean

  constructor(
    code:         string,
    message:      string,
    statusCode:   number,
    details:      ValidationIssue | ValidationIssue[] | Record<string, unknown> | string | null = null,
    isOperational = true,
  ) {
    super(message)
    this.name          = 'AppError'
    this.code          = code
    this.statusCode    = statusCode
    this.details       = details
    this.isOperational = isOperational
    Object.setPrototypeOf(this, AppError.prototype)
    const E = Error as unknown as { captureStackTrace?: (t: object, c: unknown) => void }
    E.captureStackTrace?.(this, this.constructor)
  }

  static notFound(resource?: string): AppError {
    return new AppError(ErrorCode.NOT_FOUND, resource ? `${resource} not found` : 'Resource not found', 404)
  }
  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, message, 401)
  }
  static forbidden(message = 'Access denied'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, message, 403)
  }
  static conflict(resource?: string): AppError {
    return new AppError(ErrorCode.CONFLICT, resource ? `${resource} already exists` : 'Resource already exists', 409)
  }
  static validation(details: ValidationIssue | ValidationIssue[]): AppError {
    // Store first issue only — keeps the error shape consistent (single object, not array)
    const single = Array.isArray(details) ? details[0]! : details
    return new AppError(ErrorCode.VALIDATION_ERROR, 'Validation failed', 422, single)
  }
  static internal(message = 'Internal server error'): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, message, 500)
  }
  static custom(code: string, message: string, status: number, details?: Record<string, unknown>): AppError {
    return new AppError(code, message, status, details ?? null)
  }
  static fromUnknown(err: unknown): AppError {
    if (isAppError(err)) return err
    if (err instanceof Error) {
      const p = err as Error & { code?: string; isPreParse?: boolean }
      if (p.isPreParse && p.code) return new AppError(p.code, err.message, PP[p.code] ?? 400, null, true)
      return new AppError(ErrorCode.INTERNAL_ERROR, err.message, 500, null, false)
    }
    return new AppError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred', 500, null, false)
  }
  static fromLegacy(opts: { code: string; message: string; statusCode: number; details?: Record<string, unknown> }): AppError {
    return new AppError(opts.code, opts.message, opts.statusCode, opts.details ?? null)
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (
    typeof err === 'object' && err !== null &&
    (err as Record<string, unknown>)['isAppError'] === true
  )
}

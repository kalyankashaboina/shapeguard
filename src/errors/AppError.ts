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
  static badRequest(message = 'Bad request', details?: Record<string, unknown>): AppError {
    return new AppError('BAD_REQUEST', message, 400, details ?? null)
  }
  static conflict(resource?: string): AppError {
    return new AppError(ErrorCode.CONFLICT, resource ? `${resource} already exists` : 'Resource already exists', 409)
  }
  static tooManyRequests(message = 'Too many requests', retryAfter?: number): AppError {
    return new AppError(ErrorCode.RATE_LIMIT_EXCEEDED, message, 429, retryAfter ? { retryAfter } : null)
  }
  static serviceUnavailable(message = 'Service temporarily unavailable'): AppError {
    return new AppError('SERVICE_UNAVAILABLE', message, 503)
  }
  static validation(details: ValidationIssue | ValidationIssue[]): AppError {
    // Store the full array when multiple issues are provided (allErrors:true),
    // or the single issue when only one is given.
    const stored = Array.isArray(details) && details.length === 1 ? details[0]! : details
    return new AppError(ErrorCode.VALIDATION_ERROR, 'Validation failed', 422, stored)
  }
  static internal(message = 'Internal server error'): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, message, 500)
  }
  static custom(code: string, message: string, status: number, details?: Record<string, unknown>): AppError {
    return new AppError(code, message, status, details ?? null)
  }

  /**
   * Create an AppError directly from an HTTP status code.
   * Picks the most appropriate code and default message for the status.
   *
   * @example
   * throw AppError.httpStatus(422, 'Email already in use')
   * throw AppError.httpStatus(503)
   */
  static httpStatus(status: number, message?: string): AppError {
    const HTTP_DEFAULTS: Record<number, [string, string]> = {
      400: ['BAD_REQUEST',           'Bad request'],
      401: [ErrorCode.UNAUTHORIZED,  'Authentication required'],
      403: [ErrorCode.FORBIDDEN,     'Access denied'],
      404: [ErrorCode.NOT_FOUND,     'Resource not found'],
      405: [ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed'],
      409: [ErrorCode.CONFLICT,      'Resource already exists'],
      415: [ErrorCode.INVALID_CONTENT_TYPE, 'Unsupported media type'],
      422: [ErrorCode.VALIDATION_ERROR, 'Validation failed'],
      429: [ErrorCode.RATE_LIMIT_EXCEEDED, 'Too many requests'],
      500: [ErrorCode.INTERNAL_ERROR, 'Internal server error'],
      503: ['SERVICE_UNAVAILABLE',   'Service temporarily unavailable'],
    }
    const [code, defaultMsg] = HTTP_DEFAULTS[status] ?? [`HTTP_${status}`, `HTTP error ${status}`]
    return new AppError(code, message ?? defaultMsg, status)
  }

  /**
   * Type-narrowing guard for specific error codes.
   * Use in catch blocks to handle errors by code without casting.
   *
   * @example
   * try {
   *   await UserService.create(body)
   * } catch (err) {
   *   if (AppError.is(err, 'CONFLICT')) {
   *     return res.fail({ code: 'EMAIL_TAKEN', message: 'That email is already registered', status: 409 })
   *   }
   *   throw err  // re-throw everything else
   * }
   */
  static is(err: unknown, code: string): err is AppError {
    return isAppError(err) && (err as AppError).code === code
  }

  /**
   * Check if an error has a specific HTTP status code.
   *
   * @example
   * if (AppError.hasStatus(err, 404)) { ... }
   */
  static hasStatus(err: unknown, status: number): err is AppError {
    return isAppError(err) && (err as AppError).statusCode === status
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

  // ── Typed error factory ─────────────────────────────────────────────────────
  // Define a reusable, typed error constructor once. Throw it anywhere with full
  // TypeScript safety on the details payload — no more Record<string, unknown> guessing.
  //
  // Usage:
  //   const RateLimitError = AppError.define('RATE_LIMIT_EXCEEDED', 429)
  //   throw RateLimitError({ retryAfter: 30, limit: 100 })
  //
  //   const PaymentError = AppError.define<{ amount: number; currency: string }>('PAYMENT_FAILED', 402)
  //   throw PaymentError({ amount: 9.99, currency: 'USD' })
  //
  static define<TDetails extends Record<string, unknown> = Record<string, unknown>>(
    code:     string,
    status:   number,
    message?: string,
  ): (details?: TDetails, overrideMessage?: string) => AppError {
    return (details?: TDetails, overrideMessage?: string) =>
      new AppError(code, overrideMessage ?? message ?? code, status, details ?? null)
  }

  /**
   * Wrap a failed downstream fetch() response as an AppError.
   * Preserves the upstream status code so your API returns a meaningful error.
   *
   * @example
   * const resp = await fetch('https://payments.api/charge', { ... })
   * if (!resp.ok) throw await AppError.fromFetch(resp)
   */
  static async fromFetch(response: { status: number; statusText: string; text?: () => Promise<string> }): Promise<AppError> {
    let body = ''
    try { body = response.text ? await response.text() : '' } catch { /* ignore */ }
    const HTTP_CODES: Record<number, string> = {
      400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'VALIDATION_ERROR',
      429: 'RATE_LIMIT_EXCEEDED', 500: 'INTERNAL_ERROR', 503: 'SERVICE_UNAVAILABLE',
    }
    const code = HTTP_CODES[response.status] ?? `HTTP_${response.status}`
    return new AppError(code, body || response.statusText || `HTTP ${response.status}`, response.status, null, response.status < 500)
  }

  /**
   * Attach extra context to this error — returns a new AppError with merged details.
   * Useful when catching and re-throwing with additional information.
   *
   * @example
   * throw AppError.notFound('User').withContext({ userId: req.params.id, requestedBy: req.user?.id })
   */
  withContext(extra: Record<string, unknown>): AppError {
    const merged = this.details && typeof this.details === 'object' && !Array.isArray(this.details)
      ? { ...(this.details as Record<string, unknown>), ...extra }
      : extra
    return new AppError(this.code, this.message, this.statusCode, merged, this.isOperational)
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (
    typeof err === 'object' && err !== null &&
    (err as Record<string, unknown>)['isAppError'] === true
  )
}

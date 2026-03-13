// src/__tests__/errors/AppError.test.ts
import { describe, it, expect } from 'vitest'
import { AppError, isAppError } from '../../errors/AppError.js'
import { ErrorCode } from '../../types/index.js'

describe('AppError', () => {
  // ── Constructor ─────────────────────────────
  describe('constructor', () => {
    it('sets all properties correctly', () => {
      const err = new AppError('MY_CODE', 'my message', 400, { field: 'x' })
      expect(err.code).toBe('MY_CODE')
      expect(err.message).toBe('my message')
      expect(err.statusCode).toBe(400)
      expect(err.details).toEqual({ field: 'x' })
      expect(err.isAppError).toBe(true)
      expect(err.isOperational).toBe(true)
    })

    it('is instanceof Error', () => {
      const err = new AppError('CODE', 'msg', 400)
      expect(err).toBeInstanceOf(Error)
    })

    it('is instanceof AppError', () => {
      const err = new AppError('CODE', 'msg', 400)
      expect(err).toBeInstanceOf(AppError)
    })

    it('has a stack trace', () => {
      const err = new AppError('CODE', 'msg', 400)
      expect(err.stack).toBeDefined()
    })

    it('defaults details to null', () => {
      const err = new AppError('CODE', 'msg', 400)
      expect(err.details).toBeNull()
    })

    it('defaults isOperational to true', () => {
      const err = new AppError('CODE', 'msg', 400)
      expect(err.isOperational).toBe(true)
    })
  })

  // ── Factories ───────────────────────────────
  describe('notFound', () => {
    it('creates 404 with resource name', () => {
      const err = AppError.notFound('User')
      expect(err.statusCode).toBe(404)
      expect(err.code).toBe(ErrorCode.NOT_FOUND)
      expect(err.message).toBe('User not found')
    })

    it('creates 404 without resource name', () => {
      const err = AppError.notFound()
      expect(err.message).toBe('Resource not found')
    })
  })

  describe('unauthorized', () => {
    it('creates 401 with default message', () => {
      const err = AppError.unauthorized()
      expect(err.statusCode).toBe(401)
      expect(err.code).toBe(ErrorCode.UNAUTHORIZED)
      expect(err.message).toBe('Authentication required')
    })

    it('creates 401 with custom message', () => {
      const err = AppError.unauthorized('Token expired')
      expect(err.message).toBe('Token expired')
    })
  })

  describe('forbidden', () => {
    it('creates 403 with default message', () => {
      const err = AppError.forbidden()
      expect(err.statusCode).toBe(403)
      expect(err.code).toBe(ErrorCode.FORBIDDEN)
    })

    it('creates 403 with custom message', () => {
      const err = AppError.forbidden('Admin only')
      expect(err.message).toBe('Admin only')
    })
  })

  describe('conflict', () => {
    it('creates 409 with resource name', () => {
      const err = AppError.conflict('Email')
      expect(err.statusCode).toBe(409)
      expect(err.code).toBe(ErrorCode.CONFLICT)
      expect(err.message).toBe('Email already exists')
    })

    it('creates 409 without resource name', () => {
      const err = AppError.conflict()
      expect(err.message).toBe('Resource already exists')
    })
  })

  describe('validation', () => {
    it('creates 422 with single issue', () => {
      const issue = { field: 'email', message: 'Invalid email', code: 'invalid_string' }
      const err = AppError.validation(issue)
      expect(err.statusCode).toBe(422)
      expect(err.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(err.details).toEqual(issue)
    })

    it('creates 422 with array of issues — uses first', () => {
      const issues = [
        { field: 'email', message: 'Invalid email', code: 'invalid_string' },
        { field: 'name',  message: 'Required',      code: 'invalid_type'   },
      ]
      const err = AppError.validation(issues)
      expect(err.details).toEqual(issues[0])
    })
  })

  describe('internal', () => {
    it('creates 500 with custom message', () => {
      const err = AppError.internal('DB down')
      expect(err.statusCode).toBe(500)
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(err.message).toBe('DB down')
    })
  })

  describe('custom', () => {
    it('creates error with any code and status', () => {
      const err = AppError.custom('INVALID_COUPON', 'Coupon expired', 400)
      expect(err.code).toBe('INVALID_COUPON')
      expect(err.message).toBe('Coupon expired')
      expect(err.statusCode).toBe(400)
    })

    it('supports custom details', () => {
      const err = AppError.custom('QUOTA_EXCEEDED', 'Limit reached', 429, { resetAt: '2024-02-01' })
      expect(err.details).toEqual({ resetAt: '2024-02-01' })
    })
  })

  describe('fromUnknown', () => {
    it('returns AppError unchanged', () => {
      const original = AppError.notFound('User')
      const result   = AppError.fromUnknown(original)
      expect(result).toBe(original)
    })

    it('wraps plain Error as programmer error', () => {
      const original = new Error('db crashed')
      const result   = AppError.fromUnknown(original)
      expect(result.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(result.message).toBe('db crashed')
      expect(result.isOperational).toBe(false)
    })

    it('wraps null', () => {
      const result = AppError.fromUnknown(null)
      expect(result.statusCode).toBe(500)
      expect(result.isOperational).toBe(false)
    })

    it('wraps thrown string', () => {
      const result = AppError.fromUnknown('something went wrong')
      expect(result.statusCode).toBe(500)
    })
  })

  describe('fromLegacy', () => {
    it('wraps legacy error object', () => {
      const err = AppError.fromLegacy({
        code:       'PAYMENT_FAILED',
        message:    'Card declined',
        statusCode: 402,
      })
      expect(err.code).toBe('PAYMENT_FAILED')
      expect(err.message).toBe('Card declined')
      expect(err.statusCode).toBe(402)
      expect(err.isAppError).toBe(true)
    })
  })
})

// ── isAppError ───────────────────────────────
describe('isAppError', () => {
  it('returns true for AppError instance', () => {
    expect(isAppError(AppError.notFound())).toBe(true)
  })

  it('returns true for object with isAppError:true flag', () => {
    // simulates dual-package hazard — different AppError class, same flag
    const fake = { isAppError: true, code: 'X', message: 'X', statusCode: 400 }
    expect(isAppError(fake)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isAppError(new Error('x'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAppError(null)).toBe(false)
  })

  it('returns false for string', () => {
    expect(isAppError('error')).toBe(false)
  })

  describe('name property', () => {
    it('is set to AppError', () => {
      const err = new AppError('CODE', 'msg', 400)
      expect(err.name).toBe('AppError')
    })
  })

  describe('isOperational flag', () => {
    it('can be set to false via constructor', () => {
      const err = new AppError('CODE', 'msg', 500, null, false)
      expect(err.isOperational).toBe(false)
    })
  })

  describe('internal — default message', () => {
    it('uses default message when none provided', () => {
      const err = AppError.internal()
      expect(err.message).toBe('Internal server error')
      expect(err.statusCode).toBe(500)
    })
  })

  describe('validation — edge cases', () => {
    it('does not crash with single-element array', () => {
      const issue = { field: 'x', message: 'bad', code: 'invalid' }
      const err = AppError.validation([issue])
      expect(err.statusCode).toBe(422)
      expect((err.details as any).field).toBe('x')
    })
  })

  describe('fromUnknown — pre-parse error status codes', () => {
    it('maps BODY_TOO_DEEP → 400', () => {
      const raw = Object.assign(new Error('too deep'), { code: 'BODY_TOO_DEEP', isPreParse: true })
      const err = AppError.fromUnknown(raw)
      expect(err.statusCode).toBe(400)
      expect(err.code).toBe('BODY_TOO_DEEP')
      expect(err.isOperational).toBe(true)
    })

    it('maps INVALID_CONTENT_TYPE → 415', () => {
      const raw = Object.assign(new Error('bad ct'), { code: 'INVALID_CONTENT_TYPE', isPreParse: true })
      const err = AppError.fromUnknown(raw)
      expect(err.statusCode).toBe(415)
    })

    it('maps PARAM_POLLUTION → 400', () => {
      const raw = Object.assign(new Error('pollution'), { code: 'PARAM_POLLUTION', isPreParse: true })
      const err = AppError.fromUnknown(raw)
      expect(err.statusCode).toBe(400)
    })

    it('maps STRING_TOO_LONG → 400', () => {
      const raw = Object.assign(new Error('too long'), { code: 'STRING_TOO_LONG', isPreParse: true })
      const err = AppError.fromUnknown(raw)
      expect(err.statusCode).toBe(400)
    })

    it('maps BODY_ARRAY_TOO_LARGE → 400', () => {
      const raw = Object.assign(new Error('too large'), { code: 'BODY_ARRAY_TOO_LARGE', isPreParse: true })
      const err = AppError.fromUnknown(raw)
      expect(err.statusCode).toBe(400)
    })

    it('unknown pre-parse code defaults to 400', () => {
      const raw = Object.assign(new Error('unknown'), { code: 'UNKNOWN_GUARD', isPreParse: true })
      const err = AppError.fromUnknown(raw)
      expect(err.statusCode).toBe(400)
    })
  })

})
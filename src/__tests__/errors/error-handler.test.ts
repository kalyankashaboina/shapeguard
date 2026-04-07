// src/__tests__/errors/error-handler.test.ts
import { describe, it, expect, vi } from 'vitest'
import { errorHandler } from '../../errors/error-handler.js'
import { AppError } from '../../errors/AppError.js'
import { ErrorCode } from '../../types/index.js'
import type { Request, Response, NextFunction } from 'express'

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    id:     'req_test123',
    method: 'GET',
    path:   '/api/users',
    route:  { path: '/api/users/:id' },
    ...overrides,
  } as unknown as Request
}

function makeRes() {
  let statusCode = 200
  let body: unknown = null
  const res = {
    headersSent: false,
    status(code: number) { statusCode = code; return this },
    json(b: unknown)     { body = b; return this },
    get statusCode()     { return statusCode },
    get body()           { return body },
    // Express internals used by errorHandler
    once(_evt: string, _fn: () => void) { return this },
    on(_evt: string, _fn: () => void)   { return this },
    removeListener(_evt: string, _fn: () => void) { return this },
  }
  return res as unknown as Response & { statusCode: number; body: unknown }
}

const next = vi.fn() as unknown as NextFunction

describe('errorHandler', () => {
  describe('operational errors (AppError)', () => {
    it('sends correct status code', () => {
      const handler = errorHandler({ debug: false })
      const err = AppError.notFound('User')
      const res = makeRes()
      handler(err, makeReq(), res, next)
      expect(res.statusCode).toBe(404)
    })

    it('sends error message to client', () => {
      const handler = errorHandler({ debug: false })
      const err = AppError.notFound('User')
      const res = makeRes()
      handler(err, makeReq(), res, next)
      const body = res.body as Record<string, unknown>
      expect(body['success']).toBe(false)
      expect((body['error'] as any)['code']).toBe(ErrorCode.NOT_FOUND)
      expect((body['error'] as any)['message']).toBe('User not found')
    })

    it('sends conflict error correctly', () => {
      const handler = errorHandler({ debug: false })
      const err = AppError.conflict('Email')
      const res = makeRes()
      handler(err, makeReq(), res, next)
      expect(res.statusCode).toBe(409)
      expect((res.body as any).error.code).toBe(ErrorCode.CONFLICT)
    })
  })

  describe('programmer errors (non-AppError)', () => {
    it('hides message in prod (debug: false)', () => {
      const handler = errorHandler({
        debug:  false,
        errors: { fallbackMessage: 'Something went wrong' },
      })
      const err = new Error('secret db internals')
      const res = makeRes()
      handler(err, makeReq(), res, next)
      const body = res.body as any
      expect(body.success).toBe(false)
      expect(body.error.message).toBe('Something went wrong')
      expect(body.error.message).not.toContain('secret')
    })

    it('shows message in dev (debug: true)', () => {
      const handler = errorHandler({ debug: true })
      const err = new Error('secret db internals')
      const res = makeRes()
      handler(err, makeReq(), res, next)
      const body = res.body as any
      expect(body.error.message).toContain('secret db internals')
    })

    it('sends 500 status', () => {
      const handler = errorHandler({ debug: false })
      const err = new Error('boom')
      const res = makeRes()
      handler(err, makeReq(), res, next)
      expect(res.statusCode).toBe(500)
    })
  })

  describe('headersSent guard', () => {
    it('does nothing if headers already sent', () => {
      const handler = errorHandler({ debug: false })
      const err = AppError.notFound()
      const res = { ...makeRes(), headersSent: true }
      handler(err, makeReq(), res as unknown as Response, next)
      expect((res as any).body).toBeNull()
    })
  })

  describe('onError hook', () => {
    it('calls onError hook', () => {
      const onError = vi.fn()
      const handler = errorHandler({ debug: false, errors: { onError } })
      const err = AppError.notFound()
      const res = makeRes()
      handler(err, makeReq(), res, next)
      expect(onError).toHaveBeenCalledWith(expect.any(AppError), expect.anything())
    })

    it('does not crash if onError throws', () => {
      const onError = vi.fn(() => { throw new Error('hook crashed') })
      const handler = errorHandler({ debug: false, errors: { onError } })
      const err = AppError.notFound()
      const res = makeRes()
      expect(() => handler(err, makeReq(), res, next)).not.toThrow()
    })
  })

  describe('logger', () => {
    it('calls logger.warn for 4xx errors', () => {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      const handler = errorHandler({ debug: false, logger })
      const err = AppError.notFound()
      const res = makeRes()
      handler(err, makeReq(), res, next)
      expect(logger.warn).toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('calls logger.error for 5xx errors', () => {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
      const handler = errorHandler({ debug: false, logger })
      const err = new Error('boom')
      const res = makeRes()
      handler(err, makeReq(), res, next)
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('pre-parse errors (correct status codes)', () => {
    it('sends 400 for BODY_TOO_DEEP', () => {
      const handler = errorHandler({ debug: false })
      const res = makeRes()
      const preParse = Object.assign(new Error('too deep'), { code: 'BODY_TOO_DEEP', isPreParse: true })
      const appErr = AppError.fromUnknown(preParse)
      handler(appErr, makeReq(), res, next)
      expect(res.statusCode).toBe(400)
      expect((res.body as any).error.code).toBe('BODY_TOO_DEEP')
    })

    it('sends 415 for INVALID_CONTENT_TYPE', () => {
      const handler = errorHandler({ debug: false })
      const res = makeRes()
      const preParse = Object.assign(new Error('bad ct'), { code: 'INVALID_CONTENT_TYPE', isPreParse: true })
      const appErr = AppError.fromUnknown(preParse)
      handler(appErr, makeReq(), res, next)
      expect(res.statusCode).toBe(415)
    })

    it('sends 400 for STRING_TOO_LONG', () => {
      const handler = errorHandler({ debug: false })
      const res = makeRes()
      const preParse = Object.assign(new Error('too long'), { code: 'STRING_TOO_LONG', isPreParse: true })
      const appErr = AppError.fromUnknown(preParse)
      handler(appErr, makeReq(), res, next)
      expect(res.statusCode).toBe(400)
      expect((res.body as any).error.code).toBe('STRING_TOO_LONG')
    })
  })

  describe('validation details exposure', () => {
    it('exposes validation details in prod (VALIDATION_ERROR is operational)', () => {
      const handler = errorHandler({ debug: false })
      const res = makeRes()
      const err = AppError.validation({ field: 'email', message: 'Invalid', code: 'invalid' })
      handler(err, makeReq(), res, next)
      expect((res.body as any).error.details).not.toBeNull()
    })

    it('hides non-validation details in prod for 5xx', () => {
      const handler = errorHandler({ debug: false, errors: { fallbackMessage: 'Something went wrong' } })
      const res = makeRes()
      const err = new Error('db crashed with secrets')
      handler(err, makeReq(), res, next)
      expect((res.body as any).error.message).toBe('Something went wrong')
      expect((res.body as any).error.details).toBeNull()
    })
  })

  describe('programmer error details in prod vs dev', () => {
    it('isOperational=false: statusCode still sent correctly', () => {
      const handler = errorHandler({ debug: false })
      const res = makeRes()
      const err = new AppError('CODE', 'msg', 503, null, false)
      handler(err, makeReq(), res, next)
      expect(res.statusCode).toBe(503)
    })

    it('fallbackMessage replaces message for non-operational errors in prod', () => {
      const handler = errorHandler({ debug: false, errors: { fallbackMessage: 'Custom fallback' } })
      const res = makeRes()
      const err = new Error('internal secrets leaked')
      handler(err, makeReq(), res, next)
      expect((res.body as any).error.message).toBe('Custom fallback')
    })

    it('debug:true shows real message even for programmer errors', () => {
      const handler = errorHandler({ debug: true })
      const res = makeRes()
      const err = new Error('real internal error')
      handler(err, makeReq(), res, next)
      expect((res.body as any).error.message).toContain('real internal error')
    })
  })

  describe('success envelope shape', () => {
    it('always sends success:false', () => {
      const handler = errorHandler({ debug: false })
      const res = makeRes()
      handler(AppError.notFound(), makeReq(), res, next)
      expect((res.body as any).success).toBe(false)
    })
  })

})
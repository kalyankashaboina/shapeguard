// src/__tests__/validation/res-helpers.test.ts
import { describe, it, expect, vi } from 'vitest'
import { injectResHelpers } from '../../validation/res-helpers.js'
import type { Request, Response, NextFunction } from 'express'

function makeReq(method = 'POST'): Request {
  return { method } as unknown as Request
}

function makeRes() {
  let statusCode = 200
  let body: unknown = null
  const res = {
    headersSent: false,
    status(code: number) { statusCode = code; return this },
    json(b: unknown) { body = b; return this },
    end() { return this },
    get statusCode() { return statusCode },
    get body() { return body },
  }
  return res as unknown as Response & { statusCode: number; body: unknown }
}

function setup(method = 'POST', config = {}) {
  const mw   = injectResHelpers(config)
  const req  = makeReq(method)
  const res  = makeRes()
  const next = vi.fn()
  mw(req, res, next as NextFunction)
  return { req, res, next }
}

describe('injectResHelpers', () => {
  describe('res.ok()', () => {
    it('sends 200 for GET by default', () => {
      const { res } = setup('GET')
      res.ok({ data: { id: '1' }, message: 'OK' })
      expect(res.statusCode).toBe(200)
    })

    it('sends 201 for POST by default', () => {
      const { res } = setup('POST')
      res.ok({ data: { id: '1' }, message: 'Created' })
      expect(res.statusCode).toBe(201)
    })

    it('respects explicit status override', () => {
      const { res } = setup('POST')
      res.ok({ data: {}, message: '', status: 200 })
      expect(res.statusCode).toBe(200)
    })

    it('builds correct success envelope', () => {
      const { res } = setup('GET')
      res.ok({ data: { id: '1' }, message: 'Found' })
      const body = res.body as any
      expect(body.success).toBe(true)
      expect(body.message).toBe('Found')
      expect(body.data).toEqual({ id: '1' })
    })

    it('does nothing if headersSent', () => {
      const { res } = setup('GET')
      ;(res as any).headersSent = true
      res.ok({ data: {} })
      expect(res.body).toBeNull()
    })
  })

  describe('res.created()', () => {
    it('always sends 201', () => {
      const { res } = setup('GET')  // even GET
      res.created({ data: { id: '1' }, message: 'Created' })
      expect(res.statusCode).toBe(201)
    })

    it('builds correct envelope', () => {
      const { res } = setup('POST')
      res.created({ data: { id: '1' }, message: 'User created' })
      const body = res.body as any
      expect(body.success).toBe(true)
      expect(body.message).toBe('User created')
    })
  })

  describe('res.accepted()', () => {
    it('always sends 202', () => {
      const { res } = setup('POST')
      res.accepted({ data: { jobId: 'job_1' }, message: 'Started' })
      expect(res.statusCode).toBe(202)
    })
  })

  describe('res.noContent()', () => {
    it('sends 204 with no body', () => {
      const { res } = setup('DELETE')
      res.noContent()
      expect(res.statusCode).toBe(204)
      expect(res.body).toBeNull()  // json was never called
    })
  })

  describe('res.paginated()', () => {
    it('sends 200 with paginated data', () => {
      const { res } = setup('GET')
      res.paginated({ data: [{ id: '1' }], total: 45, page: 2, limit: 20 })

      const body = res.body as any
      expect(res.statusCode).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.items).toEqual([{ id: '1' }])
      expect(body.data.total).toBe(45)
      expect(body.data.page).toBe(2)
      expect(body.data.limit).toBe(20)
      expect(body.data.pages).toBe(3)  // Math.ceil(45/20)
    })
  })

  describe('res.fail()', () => {
    it('sends 400 by default', () => {
      const { res } = setup('POST')
      res.fail({ code: 'INVALID_COUPON', message: 'Coupon expired' })
      expect(res.statusCode).toBe(400)
    })

    it('builds correct error envelope', () => {
      const { res } = setup('POST')
      res.fail({ code: 'INVALID_COUPON', message: 'Coupon expired' })
      const body = res.body as any
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('INVALID_COUPON')
      expect(body.error.message).toBe('Coupon expired')
    })

    it('respects custom status', () => {
      const { res } = setup('POST')
      res.fail({ code: 'QUOTA_EXCEEDED', message: 'Limit hit', status: 429 })
      expect(res.statusCode).toBe(429)
    })
  })

  describe('calls next', () => {
    it('calls next after injecting helpers', () => {
      const { next } = setup()
      expect(next).toHaveBeenCalled()
    })
  })

  describe('custom status codes config', () => {
    it('respects configured POST status', () => {
      const { res } = setup('POST', { statusCodes: { POST: 200 } })
      res.ok({ data: {} })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('res.paginated() edge cases', () => {
    it('handles limit=0 without Infinity pages (div-by-zero guard)', () => {
      const { res } = setup('GET')
      res.paginated({ data: [], total: 0, page: 1, limit: 0 })
      const body = res.body as any
      expect(isFinite(body.data.pages)).toBe(true)
      expect(body.data.pages).toBe(0) // Math.ceil(0/1) = 0 with safeLimit=1
    })

    it('calculates pages correctly for partial last page', () => {
      const { res } = setup('GET')
      res.paginated({ data: [], total: 21, page: 1, limit: 20 })
      expect((res.body as any).data.pages).toBe(2) // Math.ceil(21/20)
    })

    it('returns 0 pages when total is 0', () => {
      const { res } = setup('GET')
      res.paginated({ data: [], total: 0, page: 1, limit: 20 })
      expect((res.body as any).data.pages).toBe(0)
    })
  })
})

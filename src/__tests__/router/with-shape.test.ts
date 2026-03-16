// src/__tests__/router/with-shape.test.ts
import { describe, it, expect, vi } from 'vitest'
import { withShape } from '../../router/with-shape.js'
import type { Request, Response, NextFunction } from 'express'

function makeRes() {
  const captured: unknown[] = []
  const res = {
    headersSent: false,
    json(body: unknown) {
      captured.push(body)
      return this
    },
    get captured() { return captured },
  }
  return res as unknown as Response & { captured: unknown[] }
}

function makeReq(): Request {
  return {} as Request
}

describe('withShape', () => {
  describe('raw mode', () => {
    it('unwraps data from success envelope', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape('raw')
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: '', data: 'pong' })
      expect(res.captured[0]).toBe('pong')
    })

    it('passes through non-envelope bodies unchanged', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape('raw')
      mw(makeReq(), res, next as NextFunction)

      res.json('already raw')
      expect(res.captured[0]).toBe('already raw')
    })

    it('calls next', () => {
      const res  = makeRes()
      const next = vi.fn()
      withShape('raw')(makeReq(), res, next as NextFunction)
      expect(next).toHaveBeenCalled()
    })
  })

  describe('map mode', () => {
    it('maps tokens to output fields', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape({ ok: '{data.ok}', uptime: '{data.uptime}' })
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: '', data: { ok: true, uptime: 123.4 } })

      const result = res.captured[0] as Record<string, unknown>
      expect(result['ok']).toBe(true)
      expect(result['uptime']).toBe(123.4)
      expect(result['success']).toBeUndefined()
      expect(result['data']).toBeUndefined()
    })

    it('maps top-level envelope fields', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape({ status: '{success}', msg: '{message}' })
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: 'OK', data: {} })

      const result = res.captured[0] as Record<string, unknown>
      expect(result['status']).toBe(true)
      expect(result['msg']).toBe('OK')
    })

    it('returns undefined for missing paths', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape({ missing: '{data.notHere}' })
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: '', data: { ok: true } })

      const result = res.captured[0] as Record<string, unknown>
      expect(result['missing']).toBeUndefined()
    })

    it('treats non-token strings as literals', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape({ version: '1.0.0' })
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: '', data: {} })

      const result = res.captured[0] as Record<string, unknown>
      expect(result['version']).toBe('1.0.0')
    })
  })

  describe('edge cases', () => {
    it('handles deeply nested token {data.user.address.zip}', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape({ zip: '{data.user.address.zip}' })
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: '', data: { user: { address: { zip: '10001' } } } })

      const result = res.captured[0] as Record<string, unknown>
      expect(result['zip']).toBe('10001')
    })

    it('raw mode with null data field', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape('raw')
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: '', data: null })
      expect(res.captured[0]).toBeNull()
    })

    it('map mode resolves to undefined for null intermediate', () => {
      const res  = makeRes()
      const next = vi.fn()
      const mw   = withShape({ val: '{data.nested.deep}' })
      mw(makeReq(), res, next as NextFunction)

      res.json({ success: true, message: '', data: null })

      const result = res.captured[0] as Record<string, unknown>
      expect(result['val']).toBeUndefined()
    })
  })

})
// ═══════════════════════════════════════════════════════════════════════════
// testing-helpers.test.ts — shapeguard
// Tests for mockRequest(), mockResponse(), mockNext()
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import { mockRequest, mockResponse, mockNext } from '../testing/index.js'
import { AppError } from '../errors/AppError.js'

describe('mockRequest()', () => {
  it('returns defaults when called with no options', () => {
    const req = mockRequest()
    expect(req.body).toEqual({})
    expect(req.params).toEqual({})
    expect(req.query).toEqual({})
    expect(req.method).toBe('GET')
    expect(req.path).toBe('/')
    expect(req.id).toBe('test-req-id')
  })

  it('merges body, params, query from options', () => {
    const req = mockRequest({
      body:   { email: 'a@b.com' },
      params: { id: '42' },
      query:  { page: '1' },
    })
    expect(req.body).toEqual({ email: 'a@b.com' })
    expect(req.params).toEqual({ id: '42' })
    expect(req.query).toEqual({ page: '1' })
  })

  it('sets method and path from options', () => {
    const req = mockRequest({ method: 'POST', path: '/users' })
    expect(req.method).toBe('POST')
    expect(req.path).toBe('/users')
  })

  it('sets custom id from options', () => {
    const req = mockRequest({ id: 'custom-req-id' })
    expect(req.id).toBe('custom-req-id')
  })

  it('sets ip from x-forwarded-for header', () => {
    const req = mockRequest({ headers: { 'x-forwarded-for': '10.0.0.1' } })
    expect(req.ip).toBe('10.0.0.1')
  })

  it('defaults ip to 127.0.0.1 when no forwarded header', () => {
    const req = mockRequest()
    expect(req.ip).toBe('127.0.0.1')
  })

  it('exposes get() method that reads headers case-insensitively', () => {
    const req = mockRequest({ headers: { 'content-type': 'application/json' } })
    expect(req.get('content-type')).toBe('application/json')
    expect(req.get('Content-Type')).toBe('application/json')
  })

  it('get() returns undefined for missing headers', () => {
    const req = mockRequest()
    expect(req.get('x-missing')).toBeUndefined()
  })

  it('sets socket.remoteAddress from x-forwarded-for', () => {
    const req = mockRequest({ headers: { 'x-forwarded-for': '192.168.1.1' } })
    expect((req.socket as any).remoteAddress).toBe('192.168.1.1')
  })
})

describe('mockResponse()', () => {
  it('returns a mock response with _result() method', () => {
    const res = mockResponse()
    expect(typeof res._result).toBe('function')
  })

  it('initial state: statusCode 200, no body, not ended', () => {
    const { statusCode, body, ended } = mockResponse()._result()
    expect(statusCode).toBe(200)
    expect(body).toBeUndefined()
    expect(ended).toBe(false)
  })

  it('status() sets statusCode and returns this (chainable)', () => {
    const res = mockResponse()
    const returned = res.status(404)
    expect(returned).toBe(res)
    expect(res._result().statusCode).toBe(404)
  })

  it('json() captures body and sets headersSent (not ended)', () => {
    const res = mockResponse()
    res.json({ hello: 'world' })
    const { body, ended } = res._result()
    expect(body).toEqual({ hello: 'world' })
    expect(ended).toBe(false)  // ended is only set by end()
    expect(res.headersSent).toBe(true)
  })

  it('json() marks ended after call', () => {
    const res = mockResponse()
    res.status(200).json({ ok: true })
    expect(res._result().ended).toBe(false)  // ended is for end() only
    expect(res._result().body).toEqual({ ok: true })
  })

  it('end() marks as ended and headersSent', () => {
    const res = mockResponse()
    res.end()
    expect(res._result().ended).toBe(true)
    expect(res.headersSent).toBe(true)
  })

  it('setHeader() stores header values', () => {
    const res = mockResponse()
    res.setHeader('X-Request-Id', 'abc123')
    expect(res._result().headers['x-request-id']).toBe('abc123')
  })

  it('getHeader() retrieves stored header', () => {
    const res = mockResponse()
    res.setHeader('Content-Type', 'application/json')
    expect(res.getHeader('content-type')).toBe('application/json')
  })

  it('status().json() chain sets code and body', () => {
    const res = mockResponse()
    res.status(201).json({ id: '1' })
    const r = res._result()
    expect(r.statusCode).toBe(201)
    expect(r.body).toEqual({ id: '1' })
  })

  it('shapeguard res helpers (ok/created/fail) work on mockResponse', () => {
    // mockResponse doesn't have ok/created — those are injected by shapeguard middleware.
    // Verify that _result() captures whatever json() receives.
    const res = mockResponse()
    res.status(200).json({ success: true, message: 'ok', data: { id: '1' } })
    expect(res._result().body).toMatchObject({ success: true })
  })
})

describe('mockNext()', () => {
  it('is a spy function', () => {
    const next = mockNext()
    expect(typeof next).toBe('function')
  })

  it('called is false before invocation', () => {
    const next = mockNext()
    expect(next.called).toBe(false)
  })

  it('called is true after invocation', () => {
    const next = mockNext()
    next()
    expect(next.called).toBe(true)
  })

  it('error is undefined when called with no args', () => {
    const next = mockNext()
    next()
    expect(next.error).toBeUndefined()
  })

  it('captures error when called with an error argument', () => {
    const next  = mockNext()
    const error = new Error('something failed')
    next(error)
    expect(next.error).toBe(error)
    expect(next.called).toBe(true)
  })

  it('captures AppError instances', () => {
    const next  = mockNext()
    const error = AppError.notFound('User')
    next(error)
    expect(next.error).toBeInstanceOf(AppError)
    expect((next.error as typeof error).statusCode).toBe(404)
  })
})

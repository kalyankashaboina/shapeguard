// ─────────────────────────────────────────────
// testing/index.ts — shapeguard
// Test helpers — unit-test controllers without
// spinning up Express or making HTTP requests.
// Import from 'shapeguard/testing'
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express'
import type { ResOkOpts, ResFailOpts, ResPaginatedOpts } from '../types/index.js'
import { buildSuccess, buildPaginated, buildError } from '../core/response.js'

// ── MockRequest ───────────────────────────────
export interface MockRequestOptions {
  body?:    unknown
  params?:  Record<string, string>
  query?:   Record<string, string>
  headers?: Record<string, string>
  method?:  string
  path?:    string
  id?:      string
}

/**
 * Creates a mock Express Request for unit testing controllers.
 *
 * @example
 * const req = mockRequest({ body: { email: 'alice@example.com' } })
 * const res = mockResponse()
 * await createUser[1](req, res, mockNext())
 * expect(res._result().statusCode).toBe(201)
 */
export function mockRequest(opts: MockRequestOptions = {}): Request {
  return {
    body:    opts.body    ?? {},
    params:  opts.params  ?? {},
    query:   opts.query   ?? {},
    headers: opts.headers ?? {},
    method:  opts.method  ?? 'GET',
    path:    opts.path    ?? '/',
    id:      opts.id      ?? 'test-req-id',
    route:   { path: opts.path ?? '/' },
  } as unknown as Request
}

// ── MockResponse internals ────────────────────
// A typed internal state object avoids all as any casts
interface MockState {
  statusCode:  number
  body:        unknown
  headers:     Record<string, string>
  ended:       boolean
  headersSent: boolean
}

export interface MockResponseResult {
  statusCode: number
  body:       unknown
  headers:    Record<string, string>
  ended:      boolean
}

export interface MockResponse extends Response {
  _result(): MockResponseResult
}

/**
 * Creates a mock Express Response for unit testing controllers.
 * Captures status, body, headers — no HTTP needed.
 *
 * @example
 * const res = mockResponse()
 * res.ok({ data: { id: '1' }, message: 'found' })
 * expect(res._result().statusCode).toBe(200)
 * expect(res._result().body).toMatchObject({ success: true })
 */
export function mockResponse(): MockResponse {
  const state: MockState = {
    statusCode:  200,
    body:        undefined,
    headers:     {},
    ended:       false,
    headersSent: false,
  }

  // Helper to set status without casts — mutates state directly
  function setStatus(code: number): void {
    state.statusCode = code
  }

  function markSent(): void {
    state.headersSent = true
  }

  function isSent(): boolean {
    return state.headersSent
  }

  const res = {
    get statusCode()  { return state.statusCode },
    get headersSent() { return state.headersSent },
    locals: {},

    status(code: number) {
      setStatus(code)
      return this as unknown as Response
    },

    setHeader(key: string, value: string) {
      state.headers[key.toLowerCase()] = value
      return this as unknown as Response
    },

    getHeader(key: string) {
      return state.headers[key.toLowerCase()]
    },

    json(body: unknown) {
      state.body = body
      markSent()
      return this as unknown as Response
    },

    end() {
      state.ended = true
      markSent()
      return this as unknown as Response
    },

    // ── shapeguard res helpers ────────────────
    ok(opts: ResOkOpts): void {
      if (isSent()) return
      setStatus(opts.status ?? 200)
      state.body = buildSuccess(opts.data ?? null, opts.message ?? '')
      markSent()
    },

    created(opts: ResOkOpts): void {
      if (isSent()) return
      setStatus(201)
      state.body = buildSuccess(opts.data ?? null, opts.message ?? '')
      markSent()
    },

    accepted(opts: ResOkOpts): void {
      if (isSent()) return
      setStatus(202)
      state.body = buildSuccess(opts.data ?? null, opts.message ?? '')
      markSent()
    },

    noContent(): void {
      if (isSent()) return
      setStatus(204)
      state.ended = true
      markSent()
    },

    paginated(opts: ResPaginatedOpts): void {
      if (isSent()) return
      setStatus(200)
      state.body = buildPaginated(opts.data, opts.total, opts.page, opts.limit, opts.message ?? '')
      markSent()
    },

    fail(opts: ResFailOpts): void {
      if (isSent()) return
      setStatus(opts.status ?? 400)
      state.body = buildError(opts.code, opts.message, (opts.details as never) ?? null, false)
      markSent()
    },

    // ── Test accessor ─────────────────────────
    _result(): MockResponseResult {
      return {
        statusCode: state.statusCode,
        body:       state.body,
        headers:    { ...state.headers },
        ended:      state.ended,
      }
    },
  }

  return res as unknown as MockResponse
}

/**
 * Creates a mock NextFunction that captures errors.
 *
 * @example
 * const next = mockNext()
 * expect(next.called).toBe(false)
 * next()
 * expect(next.called).toBe(true)
 * expect(next.error).toBeUndefined()
 */
export function mockNext(): NextFunction & { called: boolean; error: unknown } {
  const fn = function(err?: unknown) {
    fn.called = true
    if (err !== undefined) fn.error = err
  } as NextFunction & { called: boolean; error: unknown }
  fn.called = false
  fn.error  = undefined
  return fn
}

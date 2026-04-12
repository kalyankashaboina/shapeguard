// ─────────────────────────────────────────────
// testing/index.ts — shapeguard
// Test helpers — unit-test controllers without
// spinning up Express or making HTTP requests.
// Import from 'shapeguard/testing'
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express'
import type { ResOkOpts, ResFailOpts, ResPaginatedOpts, ResCursorPaginatedOpts, ResponseConfig } from '../types/index.js'
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
  const ip      = opts.headers?.['x-forwarded-for'] ?? '127.0.0.1'
  const headers = opts.headers ?? {}
  return {
    body:    opts.body    ?? {},
    params:  opts.params  ?? {},
    query:   opts.query   ?? {},
    headers,
    method:  opts.method  ?? 'GET',
    path:    opts.path    ?? '/',
    id:      opts.id      ?? 'test-req-id',
    route:   { path: opts.path ?? '/' },
    ip,
    socket:  { remoteAddress: ip },
    get(name: string): string | undefined {
      return (headers as Record<string, string>)[name.toLowerCase()]
    },
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
 * All shapeguard res helpers (ok, created, accepted, noContent, paginated,
 * cursorPaginated, fail) are available out of the box — no middleware required.
 *
 * Pass a ResponseConfig to test custom envelope shapes:
 *   mockResponse({ shape: { result: '{data}' } })
 *
 * @example
 * const req = mockRequest({ body: { email: 'alice@example.com' } })
 * const res = mockResponse()
 * await createUser[1](req, res, mockNext())
 * expect(res._result().statusCode).toBe(201)
 * expect(res._result().body).toMatchObject({ success: true })
 */
export function mockResponse(config: ResponseConfig = {}): MockResponse {
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
    // DOC-D2 FIX: all helpers now pass the ResponseConfig so custom envelope
    // shapes (response.shape) work correctly in tests, matching production behaviour.
    // cursorPaginated added — was missing from the original mockResponse.
    ok(opts: ResOkOpts): void {
      if (isSent()) return
      setStatus(opts.status ?? 200)
      state.body = buildSuccess(opts.data ?? null, opts.message ?? '', config)
      markSent()
    },

    created(opts: ResOkOpts): void {
      if (isSent()) return
      setStatus(201)
      state.body = buildSuccess(opts.data ?? null, opts.message ?? '', config)
      markSent()
    },

    accepted(opts: ResOkOpts): void {
      if (isSent()) return
      setStatus(202)
      state.body = buildSuccess(opts.data ?? null, opts.message ?? '', config)
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
      state.body = buildPaginated(opts.data, opts.total, opts.page, opts.limit, opts.message ?? '', config)
      markSent()
    },

    cursorPaginated(opts: ResCursorPaginatedOpts): void {
      if (isSent()) return
      setStatus(200)
      const payload = {
        items:      opts.data,
        nextCursor: opts.nextCursor,
        prevCursor: opts.prevCursor ?? null,
        hasMore:    opts.hasMore,
        ...(opts.total !== undefined && { total: opts.total }),
      }
      state.body = buildSuccess(payload, opts.message ?? '', config)
      markSent()
    },

    fail(opts: ResFailOpts): void {
      if (isSent()) return
      setStatus(opts.status ?? 400)
      state.body = buildError(opts.code, opts.message, (opts.details as never) ?? null, false, config)
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

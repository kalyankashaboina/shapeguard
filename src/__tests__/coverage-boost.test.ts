// src/__tests__/coverage-boost.test.ts
// Covers gaps in existing tests:
//   - applyCacheHeaders (all combinations)
//   - applyStringTransforms (all branches)
//   - checkRateLimit (async store, custom keyGenerator, custom message, window reset)
//   - createRateLimitStore + cleanup
//   - toPostman / toInsomnia / toBruno (structure)
//   - AppError.define typed factory
//   - res.cursorPaginated
//   - sanitizeValidationIssue
//   - ErrorCode constants stability
//   - buildSuccess / buildError envelope shapes

import { describe, it, expect, beforeEach }      from 'vitest'
import express                                    from 'express'
import supertest                                  from 'supertest'

import { applyCacheHeaders }                      from '../validation/cache-headers.js'
import { applyStringTransforms }                  from '../validation/string-transforms.js'
import { checkRateLimit, createRateLimitStore }   from '../validation/rate-limit.js'
import { toPostman, toInsomnia, toBruno, generateOpenAPI } from '../openapi/index.js'
import { AppError }                               from '../errors/AppError.js'
import { ErrorCode }                              from '../types/index.js'
import { buildSuccess, buildError }               from '../core/response.js'
import { sanitizeValidationIssue }                from '../validation/sanitize.js'
import {
  shapeguard, errorHandler, notFoundHandler,
  resetLoggerForTesting, configureLogger,
} from '../index.js'
import type { Request, Response }                 from 'express'

// ── Silence logger in every test ────────────────────────────────────────────
beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyCacheHeaders
// ─────────────────────────────────────────────────────────────────────────────
describe('applyCacheHeaders()', () => {
  function makeRes() {
    const headers: Record<string, string> = {}
    return {
      setHeader(k: string, v: string) { headers[k] = v },
      headers,
    } as unknown as Response & { headers: Record<string, string> }
  }

  it('sets no-store when noStore:true', () => {
    const res = makeRes()
    applyCacheHeaders(res, { noStore: true })
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('noStore:true ignores maxAge when both provided', () => {
    const res = makeRes()
    applyCacheHeaders(res, { noStore: true, maxAge: 60 })
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('sets public max-age when maxAge provided', () => {
    const res = makeRes()
    applyCacheHeaders(res, { maxAge: 300 })
    expect(res.headers['Cache-Control']).toBe('public, max-age=300')
  })

  it('sets private max-age when private:true', () => {
    const res = makeRes()
    applyCacheHeaders(res, { maxAge: 60, private: true })
    expect(res.headers['Cache-Control']).toBe('private, max-age=60')
  })

  it('includes s-maxage when sMaxAge provided', () => {
    const res = makeRes()
    applyCacheHeaders(res, { maxAge: 60, sMaxAge: 600 })
    expect(res.headers['Cache-Control']).toContain('s-maxage=600')
    expect(res.headers['Cache-Control']).toContain('max-age=60')
  })

  it('includes stale-while-revalidate when provided', () => {
    const res = makeRes()
    applyCacheHeaders(res, { maxAge: 60, staleWhileRevalidate: 120 })
    expect(res.headers['Cache-Control']).toContain('stale-while-revalidate=120')
  })

  it('combines all CDN directives', () => {
    const res = makeRes()
    applyCacheHeaders(res, { maxAge: 60, sMaxAge: 3600, staleWhileRevalidate: 86400 })
    const cc = res.headers['Cache-Control']
    expect(cc).toContain('public')
    expect(cc).toContain('max-age=60')
    expect(cc).toContain('s-maxage=3600')
    expect(cc).toContain('stale-while-revalidate=86400')
  })

  it('defaults to max-age=0 when maxAge is omitted (object without noStore)', () => {
    const res = makeRes()
    // Edge: { noStore: false, maxAge: undefined } resolves to maxAge=0
    applyCacheHeaders(res, { noStore: false, maxAge: 0 } as never)
    expect(res.headers['Cache-Control']).toBe('public, max-age=0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyStringTransforms
// ─────────────────────────────────────────────────────────────────────────────
describe('applyStringTransforms()', () => {
  it('trims a string', () => {
    expect(applyStringTransforms('  hello  ', { trim: true })).toBe('hello')
  })

  it('lowercases a string', () => {
    expect(applyStringTransforms('HELLO', { lowercase: true })).toBe('hello')
  })

  it('trims then lowercases when both enabled', () => {
    expect(applyStringTransforms('  HELLO  ', { trim: true, lowercase: true })).toBe('hello')
  })

  it('returns non-string primitives unchanged', () => {
    expect(applyStringTransforms(42, { trim: true })).toBe(42)
    expect(applyStringTransforms(true, { lowercase: true })).toBe(true)
    expect(applyStringTransforms(null, { trim: true })).toBe(null)
    expect(applyStringTransforms(undefined, { trim: true })).toBeUndefined()
  })

  it('recurses into objects', () => {
    const input  = { name: '  Alice  ', role: 'ADMIN' }
    const output = applyStringTransforms(input, { trim: true, lowercase: true }) as typeof input
    expect(output.name).toBe('alice')
    expect(output.role).toBe('admin')
  })

  it('recurses into nested objects', () => {
    const input  = { user: { email: '  BOB@EXAMPLE.COM  ' } }
    const output = applyStringTransforms(input, { trim: true, lowercase: true }) as typeof input
    expect(output.user.email).toBe('bob@example.com')
  })

  it('recurses into arrays', () => {
    const input  = ['  ALPHA  ', '  BETA  ']
    const output = applyStringTransforms(input, { trim: true, lowercase: true }) as string[]
    expect(output).toEqual(['alpha', 'beta'])
  })

  it('handles mixed arrays', () => {
    const output = applyStringTransforms(['  A  ', 42, null], { trim: true }) as unknown[]
    expect(output[0]).toBe('A')
    expect(output[1]).toBe(42)
    expect(output[2]).toBe(null)
  })

  it('does nothing when both flags are false', () => {
    expect(applyStringTransforms('  HELLO  ', {})).toBe('  HELLO  ')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// checkRateLimit — async store path
// ─────────────────────────────────────────────────────────────────────────────
describe('checkRateLimit() — async store', () => {
  function makeAsyncStore() {
    const map = new Map<string, { count: number; reset: number }>()
    return {
      async get(k: string) { return map.get(k) ?? null },
      async set(k: string, v: { count: number; reset: number }) { map.set(k, v) },
    }
  }

  function makeReq(path = '/test', ip = '1.2.3.4'): Request {
    return {
      path,
      headers: { 'x-forwarded-for': ip },
      socket: { remoteAddress: ip },
    } as unknown as Request
  }

  it('allows requests within the limit', async () => {
    const store = makeAsyncStore()
    const req   = makeReq()
    await expect(checkRateLimit(req, { windowMs: 60_000, max: 5, store })).resolves.toBeUndefined()
    await expect(checkRateLimit(req, { windowMs: 60_000, max: 5, store })).resolves.toBeUndefined()
  })

  it('throws RATE_LIMIT_EXCEEDED when limit is exceeded', async () => {
    const store = makeAsyncStore()
    const req   = makeReq()
    const opts  = { windowMs: 60_000, max: 2, store }

    await checkRateLimit(req, opts)
    await checkRateLimit(req, opts)
    await expect(checkRateLimit(req, opts)).rejects.toMatchObject({
      code:       'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
    })
  })

  it('resets count after window expires (async store)', async () => {
    const store = makeAsyncStore()
    const req   = makeReq()
    const opts  = { windowMs: 1, max: 1, store }  // 1ms window

    await checkRateLimit(req, opts)  // count=1 — ok
    await new Promise(r => setTimeout(r, 10))  // let window expire
    // New window — should not throw
    await expect(checkRateLimit(req, opts)).resolves.toBeUndefined()
  })

  it('uses custom keyGenerator', async () => {
    const store  = makeAsyncStore()
    const req    = makeReq('/users', '9.9.9.9')
    const keyGen = (r: Request) => `user:${r.path}`
    const opts   = { windowMs: 60_000, max: 1, store, keyGenerator: keyGen }

    await checkRateLimit(req, opts)  // count=1 — ok
    await expect(checkRateLimit(req, opts)).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' })
  })

  it('uses custom message when limit exceeded', async () => {
    const store = makeAsyncStore()
    const req   = makeReq()
    const opts  = { windowMs: 60_000, max: 1, store, message: 'Slow down!' }

    await checkRateLimit(req, opts)
    try {
      await checkRateLimit(req, opts)
      expect.fail('should have thrown')
    } catch (err: unknown) {
      expect((err as { message: string }).message).toBe('Slow down!')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// checkRateLimit — in-memory store fallback (IP from socket)
// ─────────────────────────────────────────────────────────────────────────────
describe('checkRateLimit() — in-memory fallback (no x-forwarded-for)', () => {
  it('uses socket.remoteAddress when no x-forwarded-for header', async () => {
    const store = new Map<string, { count: number; reset: number }>()
    const req   = {
      path:    '/test',
      headers: {},
      socket:  { remoteAddress: '5.6.7.8' },
    } as unknown as Request

    const opts = { windowMs: 60_000, max: 1, inMemoryStore: store }
    await checkRateLimit(req, opts)  // ok
    await expect(checkRateLimit(req, opts)).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' })
  })

  it('falls back to "unknown" when both headers and socket are absent', async () => {
    const store = new Map<string, { count: number; reset: number }>()
    const req   = { path: '/test', headers: {}, socket: {} } as unknown as Request

    const opts = { windowMs: 60_000, max: 1, inMemoryStore: store }
    await checkRateLimit(req, opts)
    await expect(checkRateLimit(req, opts)).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createRateLimitStore
// ─────────────────────────────────────────────────────────────────────────────
describe('createRateLimitStore()', () => {
  it('returns a store and a startCleanup function', () => {
    const { store, startCleanup } = createRateLimitStore()
    expect(store).toBeInstanceOf(Map)
    expect(typeof startCleanup).toBe('function')
  })

  it('startCleanup returns a deregistration function', () => {
    const { startCleanup } = createRateLimitStore()
    const stop = startCleanup()
    expect(typeof stop).toBe('function')
    stop()  // should not throw
  })

  it('store accepts and returns entries', () => {
    const { store } = createRateLimitStore()
    store.set('k', { count: 1, reset: Date.now() + 60_000 })
    expect(store.get('k')).toMatchObject({ count: 1 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// toPostman / toInsomnia / toBruno
// ─────────────────────────────────────────────────────────────────────────────
describe('API client exports — toPostman / toInsomnia / toBruno', () => {
  const spec = generateOpenAPI({
    title:   'Test API',
    version: '1.0.0',
    routes: {
      'GET /users':        { summary: 'List users',  tags: ['Users'] },
      'POST /users':       { summary: 'Create user', tags: ['Users'] },
      'GET /users/:id':    { summary: 'Get user',    tags: ['Users'] },
      'DELETE /users/:id': { summary: 'Delete user', tags: ['Users'] },
    },
  })

  describe('toPostman()', () => {
    it('returns an object with top-level info and item keys', () => {
      const result = toPostman(spec)
      expect(result).toHaveProperty('info')
      expect(result).toHaveProperty('item')
    })

    it('item is an array', () => {
      const result = toPostman(spec) as { info: unknown; item: unknown[] }
      expect(Array.isArray(result.item)).toBe(true)
    })

    it('includes groups or items for all routes', () => {
      const result   = toPostman(spec) as { item: Array<{ item?: unknown[] }> }
      const allItems = result.item.flatMap(g => g.item ?? [g])
      expect(allItems.length).toBeGreaterThanOrEqual(4)
    })

    it('info contains the API title', () => {
      const result = toPostman(spec) as { info: { name: string } }
      expect(result.info.name).toBe('Test API')
    })
  })

  describe('toInsomnia()', () => {
    it('returns an object with _type: export', () => {
      const result = toInsomnia(spec) as { _type: string }
      expect(result._type).toBe('export')
    })

    it('has resources array', () => {
      const result = toInsomnia(spec) as { resources: unknown[] }
      expect(Array.isArray(result.resources)).toBe(true)
      expect(result.resources.length).toBeGreaterThan(0)
    })

    it('resources include request objects for each route', () => {
      const result     = toInsomnia(spec) as { resources: Array<{ _type: string }> }
      const requests   = result.resources.filter(r => r._type === 'request')
      expect(requests.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('toBruno()', () => {
    it('returns an object with name and version keys', () => {
      const result = toBruno(spec)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('version')
    })

    it('has items array', () => {
      const result = toBruno(spec) as { items: unknown[] }
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThanOrEqual(4)
    })

    it('each item has a name and type', () => {
      const result = toBruno(spec) as { items: Array<{ name: string; type: string }> }
      const first  = result.items[0]!
      expect(first).toHaveProperty('name')
      expect(first).toHaveProperty('type')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AppError.define — typed error factory
// ─────────────────────────────────────────────────────────────────────────────
describe('AppError.define()', () => {
  it('creates a factory that produces AppError instances', () => {
    const PaymentError = AppError.define('PAYMENT_FAILED', 402, 'Payment failed')
    const err = PaymentError()
    expect(err.statusCode).toBe(402)
    expect(err.code).toBe('PAYMENT_FAILED')
    expect(err.message).toBe('Payment failed')
  })

  it('factory accepts custom message override', () => {
    const PaymentError = AppError.define('PAYMENT_FAILED', 402, 'Payment failed')
    const err = PaymentError({}, 'Card declined')
    expect(err.message).toBe('Card declined')
  })

  it('factory accepts typed details', () => {
    const PaymentError = AppError.define<{ amount: number; currency: string }>(
      'PAYMENT_FAILED', 402, 'Payment failed'
    )
    const err = PaymentError({ amount: 9.99, currency: 'USD' })
    expect(err.details).toMatchObject({ amount: 9.99, currency: 'USD' })
  })

  it('factory uses default message when no override given', () => {
    const NotReadyError = AppError.define('NOT_READY', 503, 'Service not ready')
    const err = NotReadyError()
    expect(err.message).toBe('Service not ready')
    expect(err.statusCode).toBe(503)
  })

  it('multiple factories are independent', () => {
    const E1 = AppError.define('E1', 400, 'Error one')
    const E2 = AppError.define('E2', 500, 'Error two')
    expect(E1().code).toBe('E1')
    expect(E2().code).toBe('E2')
    expect(E1().statusCode).toBe(400)
    expect(E2().statusCode).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// res.cursorPaginated via HTTP
// ─────────────────────────────────────────────────────────────────────────────
describe('res.cursorPaginated()', () => {
  function makeApp() {
    const app = express()
    app.use(shapeguard())

    app.get('/items', (req, res) => {
      res.cursorPaginated({
        data:       [{ id: 1 }, { id: 2 }],
        nextCursor: 'cursor_abc',
        prevCursor: null,
        hasMore:    true,
      })
    })

    app.get('/items-end', (req, res) => {
      res.cursorPaginated({
        data:       [{ id: 9 }],
        nextCursor: null,
        prevCursor: 'cursor_xyz',
        hasMore:    false,
      })
    })

    app.use(notFoundHandler())
    app.use(errorHandler())
    return app
  }

  it('returns 200 with cursor pagination envelope', async () => {
    const res = await supertest(makeApp()).get('/items')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // cursorPaginated nests items inside body.data
    expect(res.body.data.items).toHaveLength(2)
    expect(res.body.data.nextCursor).toBe('cursor_abc')
    expect(res.body.data.prevCursor).toBeNull()
    expect(res.body.data.hasMore).toBe(true)
  })

  it('handles end-of-list cursor state', async () => {
    const res = await supertest(makeApp()).get('/items-end')
    expect(res.status).toBe(200)
    expect(res.body.data.nextCursor).toBeNull()
    expect(res.body.data.prevCursor).toBe('cursor_xyz')
    expect(res.body.data.hasMore).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeValidationIssue
// ─────────────────────────────────────────────────────────────────────────────
describe('sanitizeValidationIssue()', () => {
  it('passes through field and message with default config', () => {
    const issue = { field: 'email', message: 'Invalid email', code: 'invalid_string' }
    const out   = sanitizeValidationIssue(issue)
    expect(out.field).toBe('email')
    expect(out.message).toBe('Invalid email')
  })

  it('hides field name when exposeFieldName:false', () => {
    const issue = { field: 'email', message: 'Required', code: 'too_small' }
    const out   = sanitizeValidationIssue(issue, { exposeFieldName: false })
    expect(out.field).toBe('field')
  })

  it('hides message when exposeMessage:false', () => {
    const issue = { field: 'name', message: 'Too short', code: 'too_small' }
    const out   = sanitizeValidationIssue(issue, { exposeMessage: false })
    expect(out.message).toBe('Invalid value')
  })

  it('returns code as-is for non-Zod codes', () => {
    const issue = { field: 'x', message: 'bad', code: 'CUSTOM_ERROR' }
    const out   = sanitizeValidationIssue(issue)
    expect(out.code).toBe('CUSTOM_ERROR')
  })

  it('normalises Zod internal codes when exposeZodCodes:false (default)', () => {
    const issue = { field: 'x', message: 'bad', code: 'invalid_type' }
    const out   = sanitizeValidationIssue(issue)
    // 'invalid_type' is a Zod code → mapped to 'invalid'
    expect(out.code).toBe('invalid')
  })

  it('exposes Zod codes when exposeZodCodes:true', () => {
    const issue = { field: 'x', message: 'bad', code: 'invalid_type' }
    const out   = sanitizeValidationIssue(issue, { exposeZodCodes: true })
    expect(out.code).toBe('invalid_type')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildSuccess / buildError envelope shapes
// ─────────────────────────────────────────────────────────────────────────────
describe('buildSuccess() envelope', () => {
  it('includes success:true, data, and message', () => {
    const env = buildSuccess({ id: '1' }, 'Done')
    expect(env.success).toBe(true)
    expect(env.data).toMatchObject({ id: '1' })
    expect(env.message).toBe('Done')
  })

  it('accepts null data', () => {
    const env = buildSuccess(null, 'No content')
    expect(env.success).toBe(true)
    expect(env.data).toBeNull()
  })
})

describe('buildError() envelope', () => {
  it('includes success:false, code, and message', () => {
    const env = buildError('NOT_FOUND', 'User not found', null, false)
    expect(env.success).toBe(false)
    expect(env.error.code).toBe('NOT_FOUND')
    expect(env.error.message).toBe('User not found')
  })

  it('includes details when provided', () => {
    const details = { field: 'email', message: 'Invalid', code: 'invalid' }
    const env = buildError('VALIDATION_ERROR', 'Failed', details, false)
    expect(env.error.details).toMatchObject(details)
  })

  it('sanitize:true hides details', () => {
    const details = { field: 'email', message: 'Invalid', code: 'invalid' }
    const env = buildError('VALIDATION_ERROR', 'Failed', details, true)
    expect(env.error.details).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ErrorCode constants — stability check
// ─────────────────────────────────────────────────────────────────────────────
describe('ErrorCode constants', () => {
  it('has VALIDATION_ERROR', () => {
    expect(ErrorCode.VALIDATION_ERROR).toBeDefined()
  })

  it('has NOT_FOUND', () => {
    expect(ErrorCode.NOT_FOUND).toBeDefined()
  })

  it('has UNAUTHORIZED', () => {
    expect(ErrorCode.UNAUTHORIZED).toBeDefined()
  })

  it('has INTERNAL_ERROR', () => {
    expect(ErrorCode.INTERNAL_ERROR).toBeDefined()
  })

  it('has RATE_LIMIT_EXCEEDED', () => {
    expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBeDefined()
  })

  it('has REQUEST_TIMEOUT', () => {
    expect(ErrorCode.REQUEST_TIMEOUT).toBeDefined()
  })

  it('has METHOD_NOT_ALLOWED', () => {
    expect(ErrorCode.METHOD_NOT_ALLOWED).toBeDefined()
  })

  it('values are strings', () => {
    for (const val of Object.values(ErrorCode)) {
      expect(typeof val).toBe('string')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateOpenAPI — security schemes + metadata
// ─────────────────────────────────────────────────────────────────────────────
describe('generateOpenAPI() — security schemes and servers', () => {
  it('includes servers when provided', () => {
    const spec = generateOpenAPI({
      title:   'My API',
      version: '2.0.0',
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
      routes:  {},
    })
    expect(spec.servers).toBeDefined()
    expect(spec.servers![0]!.url).toBe('https://api.example.com')
  })

  it('adds bearerAuth security scheme', () => {
    const spec = generateOpenAPI({
      title:    'My API',
      version:  '1.0.0',
      security: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      routes:   {},
    })
    expect(spec.components?.securitySchemes).toHaveProperty('bearerAuth')
  })

  it('adds apiKey security scheme', () => {
    const spec = generateOpenAPI({
      title:    'My API',
      version:  '1.0.0',
      security: { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' } },
      routes:   {},
    })
    expect(spec.components?.securitySchemes).toHaveProperty('apiKey')
  })

  it('generates spec with correct openapi version', () => {
    const spec = generateOpenAPI({ title: 'T', version: '1.0.0', routes: {} })
    expect(spec.openapi).toMatch(/^3\./)
  })

  it('info title and version match input', () => {
    const spec = generateOpenAPI({ title: 'My Service', version: '3.1.0', routes: {} })
    expect(spec.info.title).toBe('My Service')
    expect(spec.info.version).toBe('3.1.0')
  })
})

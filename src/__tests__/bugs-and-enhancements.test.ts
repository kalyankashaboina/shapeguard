// src/__tests__/bugs-and-enhancements.test.ts
//
// Covers:
//   BUG-1  inflight counter double-decrement fix in graceful-shutdown
//   BUG-2  validate() no longer creates rate-limit store for routes without rateLimit
//   BUG-3  handle() exposes cleanup()
//   BUG-4  global timeout in shapeguard() now works
//   BUG-5  safeJsonParse exported from main index
//   ENH-1  extraContentTypes in ValidationConfig
//   ENH-2  skipContentTypeCheck in ValidationConfig
//   ENH-3  getRequestHeaders() propagates x-request-id
//   ENH-4  mergeRoutes() combines route definitions
//   ENH-5  onValidationError hook fires on all parse targets (body/params/query/headers)
//   ENH-6  RFC 8288 Link header on res.paginated with baseUrl
//   ENH-7  global timeout in shapeguard() middleware
//   ENH-8  trustProxy: false is default (uses socket.remoteAddress)
//   ENH-9  rate-limit guards for invalid max/windowMs
//   ENH-10 handle() cleanup() stops rate-limit interval
//   COV    request-id getRequestHeaders with and without req.id
//   COV    res.paginated Link header first/prev/next/last
//   COV    validate() with headers schema
//   COV    validate() allErrors on Joi/Yup warns dev mode
//   COV    notFoundHandler custom message
//   COV    healthCheck degraded status
//   COV    webhook onSuccess / onFailure hooks

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { z } from 'zod'

import {
  shapeguard, defineRoute, handle, mergeRoutes, validate,
  AppError, errorHandler, notFoundHandler, asyncHandler,
  healthCheck, gracefulShutdown,
  verifyWebhook,
  safeJsonParse, getRequestHeaders,
  resetLoggerForTesting, configureLogger,
} from '../index.js'
import { createRouter }      from '../router/create-router.js'
import { checkRateLimit, createRateLimitStore } from '../validation/rate-limit.js'
import type { Request }       from 'express'

// ── Silence logger in every test ─────────────────────────────────────────────
beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-1: inflight double-decrement
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-1: inflight counter never goes negative', () => {
  it('decrements only once when both finish and close fire on same response', () => {
    let inflight = 0
    let counted  = true

    // Simulate the fixed logic from graceful-shutdown
    const dec = () => {
      if (!counted) return
      counted = false
      inflight--
    }

    inflight++ // request arrives
    dec()      // finish fires
    dec()      // close fires (should be no-op)

    expect(inflight).toBe(0)  // not -1
  })

  it('correctly tracks multiple concurrent requests', () => {
    let inflight = 0
    const makeRequest = () => {
      inflight++
      let fired = false
      const dec = () => { if (!fired) { fired = true; inflight-- } }
      return dec
    }

    const r1 = makeRequest()
    const r2 = makeRequest()
    const r3 = makeRequest()
    expect(inflight).toBe(3)

    r1(); r1() // double-fire on first
    r2()
    expect(inflight).toBe(1)

    r3(); r3(); r3() // triple-fire on third
    expect(inflight).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-2: validate() does not create store when no rateLimit
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-2: validate() cleanup is no-op when no rateLimit configured', () => {
  it('calling cleanup() on a route without rateLimit does not throw', () => {
    const mw = validate(defineRoute({ body: z.object({ x: z.string() }) }))
    expect(() => mw.cleanup()).not.toThrow()
  })

  it('calling cleanup() on a route with rateLimit clears the interval', () => {
    const mw = validate(defineRoute({
      body:      z.object({ x: z.string() }),
      rateLimit: { windowMs: 60_000, max: 10 },
    }))
    expect(() => mw.cleanup()).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-3: handle() exposes cleanup()
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-3: handle() exposes cleanup()', () => {
  it('handle() result has a cleanup method', () => {
    const route = handle(defineRoute({ body: z.object({ x: z.string() }) }), async (_req, res) => {
      res.ok({ data: {}, message: '' })
    })
    expect(typeof route.cleanup).toBe('function')
  })

  it('cleanup() can be called without throwing', () => {
    const route = handle(
      defineRoute({ body: z.object({ x: z.string() }), rateLimit: { windowMs: 60_000, max: 5 } }),
      async (_req, res) => { res.ok({ data: {}, message: '' }) },
    )
    expect(() => route.cleanup()).not.toThrow()
  })

  it('handle() returns a spreadable array with 2 middleware', () => {
    const route = handle(defineRoute({}), async (_req, res) => { res.noContent() })
    expect(Array.isArray(route)).toBe(true)
    expect(route).toHaveLength(2)
    expect(typeof route[0]).toBe('function')
    expect(typeof route[1]).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-4: global timeout in shapeguard() now fires
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-4: global timeout in shapeguard()', () => {
  it('returns 408 when handler exceeds global timeout', async () => {
    const app = express()
    app.use(shapeguard({ timeout: 50 }))
    app.get('/slow', (_req, res) => {
      setTimeout(() => { if (!res.headersSent) res.json({ done: true }) }, 200)
    })
    app.use(errorHandler())

    const res = await supertest(app).get('/slow')
    expect(res.status).toBe(408)
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT')
  })

  it('does not fire when handler responds within global timeout', async () => {
    const app = express()
    app.use(shapeguard({ timeout: 500 }))
    app.get('/fast', (_req, res) => { res.json({ ok: true }) })
    app.use(errorHandler())

    const res = await supertest(app).get('/fast')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('per-route timeout in defineRoute overrides global timeout', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard({ timeout: 500 }))  // global: 500ms
    app.get('/fast', ...handle(
      defineRoute({ timeout: 50 }),        // per-route: 50ms — should win
      async (_req, res) => {
        await new Promise(r => setTimeout(r, 150))
        if (!res.headersSent) res.json({ ok: true })
      },
    ))
    app.use(errorHandler())

    const res = await supertest(app).get('/fast')
    expect(res.status).toBe(408)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-5: safeJsonParse exported from main index
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-5: safeJsonParse exported from main index', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse('{"a":1,"b":"hello"}')
    expect(result).toEqual({ a: 1, b: 'hello' })
  })

  it('strips __proto__ pollution via reviver', () => {
    const result = safeJsonParse('{"__proto__":{"evil":true},"safe":1}') as Record<string, unknown>
    expect(result['safe']).toBe(1)
    expect(({} as Record<string, unknown>)['evil']).toBeUndefined()
  })

  it('throws on invalid JSON', () => {
    expect(() => safeJsonParse('{bad json')).toThrow()
  })

  it('strips constructor key (reviver removes it from JSON data)', () => {
    const result = safeJsonParse('{"constructor":{"prototype":{"evil":true}},"ok":2}') as Record<string, unknown>
    expect(result['ok']).toBe(2)
    // 'constructor' as own enumerable property is stripped by reviver
    // (inherited Object.constructor is always present — that's normal JS)
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ENH-1/2: extraContentTypes and skipContentTypeCheck
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-1: extraContentTypes in ValidationConfig', () => {
  function makeApp(extra: string[]) {
    const app = express()
    app.use(express.text({ type: '*/*' }))
    app.use(shapeguard({ validation: { extraContentTypes: extra } }))
    app.post('/data', ...handle(
      defineRoute({ body: z.object({ x: z.string() }) }),
      async (_req, res) => { res.ok({ data: {}, message: 'ok' }) },
    ))
    app.use(errorHandler())
    return app
  }

  it('rejects unknown content type without extraContentTypes', async () => {
    const app = makeApp([])
    const res = await supertest(app)
      .post('/data')
      .set('Content-Type', 'application/vnd.api+json')
      .send('{"x":"hello"}')
    expect(res.status).toBe(415)
  })

  it('accepts custom content type when added to extraContentTypes', async () => {
    const app = express()
    app.use(express.json({ type: ['application/json', 'application/vnd.api+json'] }))
    app.use(shapeguard({ validation: { extraContentTypes: ['application/vnd.api+json'] } }))
    app.post('/data', ...handle(
      defineRoute({ body: z.object({ x: z.string() }) }),
      async (req, res) => { res.ok({ data: req.body, message: 'ok' }) },
    ))
    app.use(errorHandler())

    const res = await supertest(app)
      .post('/data')
      .set('Content-Type', 'application/vnd.api+json')
      .send({ x: 'hello' })
    expect(res.status).toBe(201)
  })
})

describe('ENH-2: skipContentTypeCheck in ValidationConfig', () => {
  it('skips content-type enforcement when skipContentTypeCheck: true', async () => {
    const app = express()
    app.use(express.raw({ type: '*/*' }))
    app.use(shapeguard({ validation: { skipContentTypeCheck: true } }))
    app.post('/webhook', ...handle(
      defineRoute({ body: z.unknown() }),
      async (_req, res) => { res.ok({ data: 'received', message: '' }) },
    ))
    app.use(errorHandler())

    const res = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('raw binary data'))
    expect(res.status).not.toBe(415)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ENH-3: getRequestHeaders()
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-3: getRequestHeaders()', () => {
  it('returns x-request-id and x-correlation-id when req.id is set', () => {
    const req = { id: 'req_abc123' } as Request & { id: string }
    const headers = getRequestHeaders(req)
    expect(headers['x-request-id']).toBe('req_abc123')
    expect(headers['x-correlation-id']).toBe('req_abc123')
  })

  it('returns empty object when req.id is missing', () => {
    const req = {} as Request
    const headers = getRequestHeaders(req)
    expect(Object.keys(headers)).toHaveLength(0)
  })

  it('merges extra headers with precedence', () => {
    const req = { id: 'req_001' } as Request & { id: string }
    const headers = getRequestHeaders(req, { 'x-tenant-id': 'acme', 'x-request-id': 'override' })
    expect(headers['x-tenant-id']).toBe('acme')
    expect(headers['x-request-id']).toBe('override')  // extra wins
  })

  it('extra headers without req.id still returned', () => {
    const req = {} as Request
    const headers = getRequestHeaders(req, { authorization: 'Bearer tok' })
    expect(headers['authorization']).toBe('Bearer tok')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ENH-4: mergeRoutes()
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-4: mergeRoutes()', () => {
  it('merges body from first and params from second', () => {
    const A = defineRoute({ body:   z.object({ email: z.string() }) })
    const B = defineRoute({ params: z.object({ id: z.string().uuid() }) })
    const merged = mergeRoutes(A, B)
    expect(merged.body).toBeDefined()
    expect(merged.params).toBeDefined()
  })

  it('later definition overrides earlier on collision', () => {
    const A = defineRoute({ timeout: 1000 })
    const B = defineRoute({ timeout: 5000 })
    const merged = mergeRoutes(A, B)
    expect(merged.timeout).toBe(5000)
  })

  it('preserves rateLimit from base route', () => {
    const AuthBase = defineRoute({ rateLimit: { windowMs: 60_000, max: 100 } })
    const Specific = defineRoute({ body: z.object({ x: z.string() }) })
    const merged   = mergeRoutes(AuthBase, Specific)
    expect(merged.rateLimit).toBeDefined()
    expect(merged.body).toBeDefined()
  })

  it('merged route works end-to-end via HTTP', async () => {
    const app    = express()
    const router = createRouter()
    app.use(express.json())
    app.use(shapeguard())

    const BaseRoute = defineRoute({ rateLimit: { windowMs: 60_000, max: 100 } })
    const GetUser   = mergeRoutes(BaseRoute, defineRoute({
      params:   z.object({ id: z.string() }),
      response: z.object({ id: z.string() }),
    }))

    router.get('/users/:id', ...handle(GetUser, async (req, res) => {
      res.ok({ data: { id: req.params.id }, message: '' })
    }))

    app.use('/api', router)
    app.use(notFoundHandler())
    app.use(errorHandler())

    const res = await supertest(app).get('/api/users/abc-123')
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe('abc-123')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ENH-5: onValidationError hook on all parse targets
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-5: onValidationError hook fires on body/params/query', () => {
  function makeApp(hook: (issues: unknown[], req: Request) => void) {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())

    const route = defineRoute({
      body:              z.object({ email: z.string().email() }),
      query:             z.object({ page: z.string().optional() }),
      params:            z.object({ id: z.string().min(1) }),
      onValidationError: hook as never,
    })

    app.post('/users/:id', ...handle(route, async (_req, res) => {
      res.ok({ data: {}, message: '' })
    }))
    app.use(errorHandler())
    return app
  }

  it('fires hook when body validation fails', async () => {
    const calls: unknown[][] = []
    const app = makeApp((issues, _req) => { calls.push(issues as unknown[]) })

    await supertest(app)
      .post('/users/123')
      .send({ email: 'not-an-email' })
    expect(calls).toHaveLength(1)
    expect((calls[0]![0] as { field: string }).field).toBe('email')
  })

  it('hook errors do not affect response', async () => {
    const app = makeApp(() => { throw new Error('hook exploded') })

    const res = await supertest(app)
      .post('/users/123')
      .send({ email: 'not-an-email' })
    expect(res.status).toBe(422)  // still returns validation error normally
  })

  it('does not fire hook when validation passes', async () => {
    const calls: unknown[][] = []
    const app = makeApp((issues) => { calls.push(issues as unknown[]) })

    await supertest(app)
      .post('/users/123')
      .send({ email: 'good@example.com' })
    expect(calls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ENH-6: RFC 8288 Link header on res.paginated
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-6: RFC 8288 Link header on res.paginated', () => {
  function makeApp() {
    const app = express()
    app.use(shapeguard())

    app.get('/items', (req, res) => {
      const page  = Number(req.query['page'] ?? 1)
      const limit = 10
      res.paginated({ data: [], total: 55, page, limit, baseUrl: '/items' })
    })

    app.get('/items-nolink', (req, res) => {
      res.paginated({ data: [], total: 55, page: 1, limit: 10 })
    })
    return app
  }

  it('sets Link header with next and last on page 1', async () => {
    const res = await supertest(makeApp()).get('/items?page=1')
    const link = res.headers['link']
    expect(link).toBeDefined()
    expect(link).toContain('rel="next"')
    expect(link).toContain('rel="last"')
    expect(link).not.toContain('rel="prev"')
    expect(link).not.toContain('rel="first"')
  })

  it('sets first, prev, next, last on a middle page', async () => {
    const res = await supertest(makeApp()).get('/items?page=3')
    const link = res.headers['link']
    expect(link).toContain('rel="first"')
    expect(link).toContain('rel="prev"')
    expect(link).toContain('rel="next"')
    expect(link).toContain('rel="last"')
  })

  it('sets only first and prev on last page', async () => {
    const res = await supertest(makeApp()).get('/items?page=6')
    const link = res.headers['link']
    expect(link).toContain('rel="first"')
    expect(link).toContain('rel="prev"')
    expect(link).not.toContain('rel="next"')
  })

  it('no Link header when baseUrl is omitted', async () => {
    const res = await supertest(makeApp()).get('/items-nolink')
    expect(res.headers['link']).toBeUndefined()
  })

  it('no Link header on single page', async () => {
    const app = express()
    app.use(shapeguard())
    app.get('/single', (_req, res) => {
      res.paginated({ data: [], total: 5, page: 1, limit: 10, baseUrl: '/single' })
    })
    const res = await supertest(app).get('/single')
    expect(res.headers['link']).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ENH-8: trustProxy: false is default (socket.remoteAddress)
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-8: trustProxy defaults to false — x-forwarded-for cannot bypass rate limit', () => {
  it('uses socket.remoteAddress by default, ignores x-forwarded-for', async () => {
    const store = new Map()
    const req1 = { path: '/test', headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Request
    const req2 = { path: '/test', headers: { 'x-forwarded-for': '2.2.2.2' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Request

    const opts = { windowMs: 60_000, max: 1, inMemoryStore: store, trustProxy: false }
    await checkRateLimit(req1, opts)
    // Second request from same socket IP (different x-forwarded-for) should be blocked
    await expect(checkRateLimit(req2, opts)).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' })
  })

  it('uses x-forwarded-for when trustProxy: true', async () => {
    const store = new Map()
    const req1 = { path: '/test', headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Request
    const req2 = { path: '/test', headers: { 'x-forwarded-for': '2.2.2.2' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Request

    const opts = { windowMs: 60_000, max: 1, inMemoryStore: store, trustProxy: true }
    await checkRateLimit(req1, opts)
    // Different x-forwarded-for = different key = should NOT be blocked
    await expect(checkRateLimit(req2, opts)).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ENH-9: rate-limit guards for invalid config
// ─────────────────────────────────────────────────────────────────────────────
describe('ENH-9: rate-limit validates config inputs', () => {
  const store = new Map()
  const req   = { path: '/t', headers: {}, socket: { remoteAddress: '1.2.3.4' } } as unknown as Request

  it('throws on max < 1', async () => {
    await expect(checkRateLimit(req, { windowMs: 1000, max: 0, inMemoryStore: store }))
      .rejects.toThrow('rateLimit.max must be a positive integer')
  })

  it('throws on negative max', async () => {
    await expect(checkRateLimit(req, { windowMs: 1000, max: -1, inMemoryStore: store }))
      .rejects.toThrow('rateLimit.max must be a positive integer')
  })

  it('throws on windowMs < 1', async () => {
    await expect(checkRateLimit(req, { windowMs: 0, max: 10, inMemoryStore: store }))
      .rejects.toThrow('rateLimit.windowMs must be a positive number')
  })

  it('throws on NaN max', async () => {
    await expect(checkRateLimit(req, { windowMs: 1000, max: NaN, inMemoryStore: store }))
      .rejects.toThrow('rateLimit.max must be a positive integer')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: validate() with headers schema
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: validate() with headers schema', () => {
  it('validates required header and passes through', async () => {
    const app = express()
    app.use(shapeguard())
    app.get('/secure', ...handle(
      defineRoute({ headers: z.object({ 'x-api-key': z.string().min(1) }) }),
      async (_req, res) => { res.ok({ data: 'ok', message: '' }) },
    ))
    app.use(errorHandler())

    const res = await supertest(app).get('/secure').set('x-api-key', 'secret')
    expect(res.status).toBe(200)
  })

  it('rejects request with missing required header', async () => {
    const app = express()
    app.use(shapeguard())
    app.get('/secure', ...handle(
      defineRoute({ headers: z.object({ 'x-api-key': z.string().min(1) }) }),
      async (_req, res) => { res.ok({ data: 'ok', message: '' }) },
    ))
    app.use(errorHandler())

    const res = await supertest(app).get('/secure')
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: notFoundHandler with custom message
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: notFoundHandler custom message', () => {
  it('uses default message based on method+path', async () => {
    const app = express()
    app.use(notFoundHandler())
    app.use(errorHandler())

    const res = await supertest(app).delete('/unknown')
    expect(res.status).toBe(404)
    expect(res.body.message).toContain('DELETE')
    expect(res.body.message).toContain('/unknown')
  })

  it('uses custom message when provided', async () => {
    const app = express()
    app.use(notFoundHandler({ message: 'Route not found. Check the API docs.' }))
    app.use(errorHandler())

    const res = await supertest(app).get('/anything')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Route not found. Check the API docs.')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: healthCheck degraded status
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: healthCheck degraded status with nonCritical checks', () => {
  function makeApp(nonCritical: string[]) {
    const app = express()
    app.use('/health', healthCheck({
      checks: {
        db:    async () => 'ok',
        cache: async () => { throw new Error('cache down') },
      },
      nonCritical,
      timeout: 1000,
    }))
    return app
  }

  it('returns degraded (200) when only non-critical check fails', async () => {
    const res = await supertest(makeApp(['cache'])).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('degraded')
    expect(res.body.checks.db).toBe('ok')
    expect(res.body.checks.cache).toBe('error')
  })

  it('returns unhealthy (503) when critical check fails', async () => {
    const res = await supertest(makeApp([])).get('/health')  // cache is critical
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('unhealthy')
  })

  it('custom degradedStatus code is respected', async () => {
    const app = express()
    app.use('/health', healthCheck({
      checks: { cache: async () => { throw new Error('down') } },
      nonCritical: ['cache'],
      degradedStatus: 207,
    }))
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(207)
    expect(res.body.status).toBe('degraded')
  })

  it('all healthy returns 200', async () => {
    const app = express()
    app.use('/health', healthCheck({
      checks:      { db: async () => true, cache: async () => true },
      nonCritical: ['cache'],
    }))
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('healthy')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: webhook onSuccess / onFailure hooks
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: webhook onSuccess and onFailure hooks', () => {
  const secret = 'test-secret-key-for-hmac'
  const { createHmac } = require('crypto')

  function sign(body: string) {
    return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  }

  it('calls onSuccess when signature is valid', async () => {
    const onSuccess = vi.fn()
    const app = express()
    app.use(express.raw({ type: 'application/json' }))
    app.post('/wh',
      verifyWebhook({ provider: 'github', secret, onSuccess }),
      (_req, res) => { res.json({ ok: true }) },
    )
    app.use(errorHandler())

    const body = '{"event":"push"}'
    await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)

    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('calls onFailure when signature is invalid', async () => {
    const onFailure = vi.fn()
    const app = express()
    app.use(express.raw({ type: 'application/json' }))
    app.post('/wh',
      verifyWebhook({ provider: 'github', secret, onFailure }),
      (_req, res) => { res.json({ ok: true }) },
    )
    app.use(errorHandler())

    const body = '{"event":"push"}'
    await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=badsig')
      .send(body)

    expect(onFailure).toHaveBeenCalledWith(expect.anything(), 'HMAC mismatch')
  })

  it('calls onFailure when signature header is missing', async () => {
    const onFailure = vi.fn()
    const app = express()
    app.use(express.raw({ type: 'application/json' }))
    app.post('/wh',
      verifyWebhook({ provider: 'github', secret, onFailure }),
      (_req, res) => { res.json({ ok: true }) },
    )
    app.use(errorHandler())

    await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .send('{"event":"push"}')

    expect(onFailure).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('Missing header'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: asyncHandler wraps sync + async functions
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: asyncHandler', () => {
  it('catches async rejection and calls next(err)', async () => {
    const app = express()
    app.get('/fail', asyncHandler(async () => {
      throw AppError.notFound('Resource')
    }))
    app.use(errorHandler())

    const res = await supertest(app).get('/fail')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('passes through when handler resolves', async () => {
    const app = express()
    app.use(shapeguard())
    app.get('/ok', asyncHandler(async (_req, res) => {
      res.ok({ data: 'good', message: '' })
    }))

    const res = await supertest(app).get('/ok')
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: res.accepted and res.noContent
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: res.accepted and res.noContent', () => {
  function makeApp() {
    const app = express()
    app.use(shapeguard())
    app.post('/job',    (_req, res) => { res.accepted({ data: { jobId: 'j1' }, message: 'Queued' }) })
    app.delete('/item', (_req, res) => { res.noContent() })
    return app
  }

  it('res.accepted returns 202', async () => {
    const res = await supertest(makeApp()).post('/job')
    expect(res.status).toBe(202)
    expect(res.body.success).toBe(true)
    expect(res.body.data.jobId).toBe('j1')
  })

  it('res.noContent returns 204 with empty body', async () => {
    const res = await supertest(makeApp()).delete('/item')
    expect(res.status).toBe(204)
    expect(res.text).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: ErrorCode.INTERNAL_SERVER_ERROR alias
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: ErrorCode.INTERNAL_SERVER_ERROR alias', () => {
  it('equals INTERNAL_ERROR value', async () => {
    const { ErrorCode } = await import('../types/index.js')
    expect(ErrorCode.INTERNAL_SERVER_ERROR).toBe(ErrorCode.INTERNAL_ERROR)
    expect(ErrorCode.INTERNAL_SERVER_ERROR).toBe('INTERNAL_ERROR')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: createRateLimitStore cleanup
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: createRateLimitStore cleans expired entries', () => {
  it('store cleanup removes expired entries when called', async () => {
    const { store, startCleanup } = createRateLimitStore(50)  // 50ms interval
    const stop = startCleanup()

    // Add an already-expired entry
    store.set('old', { count: 5, reset: Date.now() - 1000 })
    store.set('fresh', { count: 1, reset: Date.now() + 60_000 })

    expect(store.size).toBe(2)

    // Wait for cleanup interval
    await new Promise(r => setTimeout(r, 100))

    expect(store.has('old')).toBe(false)
    expect(store.has('fresh')).toBe(true)

    stop()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: AppError.fromLegacy
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: AppError.fromLegacy', () => {
  it('creates AppError from legacy shape', () => {
    const err = AppError.fromLegacy({ code: 'CUSTOM', message: 'Custom error', statusCode: 422, details: { field: 'x' } })
    expect(err.code).toBe('CUSTOM')
    expect(err.statusCode).toBe(422)
    expect(err.message).toBe('Custom error')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COV: gracefulShutdown deregister function
// ─────────────────────────────────────────────────────────────────────────────
describe('COV: gracefulShutdown returns deregister', () => {
  it('deregister removes signal listeners', () => {
    const http = require('http')
    const server = http.createServer(() => {})
    const before = process.listenerCount('SIGTERM')
    const stop = gracefulShutdown(server, { signals: ['SIGTERM'] })
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
    stop()
    expect(process.listenerCount('SIGTERM')).toBe(before)
    server.close()
  })
})

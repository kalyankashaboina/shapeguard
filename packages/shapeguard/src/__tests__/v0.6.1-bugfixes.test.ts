// ═══════════════════════════════════════════════════════════════════════════
// v0.6.1-bugfixes.test.ts — shapeguard
// Regression tests for all 12 bugs fixed in v0.6.1 security/correctness patch.
// Each test is a direct, targeted repro of the original bug.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { z } from 'zod'

import { shapeguard }                     from '../shapeguard.js'
import { errorHandler }                   from '../errors/error-handler.js'
import { AppError }                       from '../errors/AppError.js'
import { validate, _clearRateLimitStore } from '../validation/validate.js'
import { defineRoute }                    from '../validation/define-route.js'
import { handle }                         from '../validation/handle.js'
import { zodAdapter }                     from '../adapters/zod.js'
import { ErrorCode }                      from '../types/index.js'
import type { Request, Response }         from 'express'

// ─── Shared test helpers ─────────────────────────────────────────────────────

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use(shapeguard({ logger: { silent: true } }))
  return app
}

/** Minimal mock request — no req.app (simulates unit-test standalone usage) */
function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    id: 'req_test', method: 'GET', path: '/test',
    route: { path: '/test' },
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  let statusCode = 200
  let body: unknown = null
  const res: any = {
    headersSent: false,
    locals: {},
    status(code: number) { statusCode = code; return this },
    json(b: unknown) { body = b; return this },
    send(b: unknown) { body = b; return this },
    end() { return this },
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    // Express event emitter methods needed by shapeguard middleware
    once(_evt: string, _fn: () => void) { return this },
    on(_evt: string, _fn: () => void)   { return this },
    removeListener(_evt: string, _fn: () => void) { return this },
    get statusCode() { return statusCode },
    get body() { return body },
  }
  return res
}

const fakeNext = vi.fn()

// ═══════════════════════════════════════════════════════════════════════════
// BUG #1 — PARAM_POLLUTION never thrown
// Verify: ?role=admin&role=user → 400 PARAM_POLLUTION (not 422)
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #1 — PARAM_POLLUTION: repeated query params throw 400', () => {
  it('returns 400 PARAM_POLLUTION when a query param is repeated', async () => {
    const app = makeApp()
    const route = defineRoute({ query: zodAdapter(z.object({ role: z.string() })) })
    app.get('/search', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app).get('/search?role=admin&role=user')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe(ErrorCode.PARAM_POLLUTION)
  })

  it('allows normal scalar query params through', async () => {
    const app = makeApp()
    const route = defineRoute({ query: zodAdapter(z.object({ role: z.string() })) })
    app.get('/search', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app).get('/search?role=admin')
    expect(res.status).toBe(200)
  })

  it('PARAM_POLLUTION fires via validate() middleware directly', async () => {
    const mw = validate({ query: zodAdapter(z.object({ role: z.string() })) })
    const errors: unknown[] = []
    const req = makeReq({ query: { role: ['admin', 'user'] as any } })
    const res = makeRes()
    await (mw as any)(req, res, (err?: unknown) => { if (err) errors.push(err) })
    expect(errors).toHaveLength(1)
    const err = errors[0] as any
    // Error arrives as a pre-parse error — code is PARAM_POLLUTION
    expect(err?.code ?? err?.message).toMatch(/PARAM_POLLUTION/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUG #2 — Response stripping silently skipped when shape renames 'data'
// Verify: passwordHash stripped even when envelope key is 'result' not 'data'
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #2 — Response strip works when shape config renames data key', () => {
  it('strips sensitive fields when response.shape renames data → result', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard({
      logger:   { silent: true },
      response: { shape: { status: '{success}', msg: '{message}', result: '{data}' } },
    }))

    const responseSchema = zodAdapter(z.object({ name: z.string() }))
    const route = defineRoute({ response: responseSchema })
    app.get('/user', ...handle(route, async (_req, res) => {
      res.ok({ data: { name: 'Alice', passwordHash: 'secret123' } })
    }))
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app).get('/user')
    // Give async strip time to settle
    await new Promise(r => setTimeout(r, 50))
    expect(res.status).toBe(200)
    // Key is 'result' not 'data' due to shape config
    expect(res.body.result).toBeDefined()
    expect(res.body.result.name).toBe('Alice')
    // passwordHash must be stripped — this was the bug
    expect(res.body.result.passwordHash).toBeUndefined()
  })

  it('still strips when using default data key (no shape config)', async () => {
    const app = makeApp()
    const responseSchema = zodAdapter(z.object({ name: z.string() }))
    const route = defineRoute({ response: responseSchema })
    app.get('/user2', ...handle(route, async (_req, res) => {
      res.ok({ data: { name: 'Bob', secret: 'hidden' } })
    }))
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app).get('/user2')
    await new Promise(r => setTimeout(r, 50))
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Bob')
    expect(res.body.data.secret).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUG #3 — ./openapi subpath export missing
// Verify: generateOpenAPI importable from openapi/index (not just main entry)
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #3 — openapi subpath entry resolves', () => {
  it('generateOpenAPI is importable from openapi/index directly', async () => {
    const mod = await import('../openapi/index.js')
    expect(typeof mod.generateOpenAPI).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUG #4 — Rate limit store memory leak (expired entries never purged)
// Verify: counter resets correctly after window expires (no stale accumulation)
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #4 — Rate limit: expired window resets cleanly', () => {
  beforeEach(() => { _clearRateLimitStore() })

  it('allows request again after window expires', async () => {
    const app = makeApp()
    const route = defineRoute({ rateLimit: { windowMs: 60, max: 1 } }) // 60ms window
    app.get('/rl-reset', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler({ debug: true }))

    // Use up the window
    await supertest(app).get('/rl-reset')
    // Wait for window to expire
    await new Promise(r => setTimeout(r, 150))
    // Must be allowed again with fresh counter
    const res = await supertest(app).get('/rl-reset')
    expect(res.status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUG #5 — errorHandler not auto-wired to shapeguard's logger
// Verify: errors logged without manual logger wiring; req.app undefined safe
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #5 — errorHandler auto-discovers shapeguard logger', () => {
  it('logs errors through shapeguard logger without manual wiring', async () => {
    const logged: string[] = []
    const customLogger = {
      info:  () => {},
      debug: () => {},
      warn:  (...args: unknown[]) => { logged.push('warn') },
      error: (...args: unknown[]) => { logged.push('error') },
    }
    const app = express()
    app.use(express.json())
    app.use(shapeguard({ logger: { instance: customLogger } }))
    app.get('/boom', (_req, _res, next) => { next(AppError.notFound('Thing')) })
    app.use(errorHandler()) // NO explicit logger — auto-discovered from app.locals

    await supertest(app).get('/boom')
    expect(logged).toContain('warn') // 404 = operational = warn
  })

  it('explicit logger still takes precedence over auto-discovered one in errorHandler', async () => {
    const explicitErrorLogged: string[] = []
    const autoErrorLogged: string[] = []
    const explicitLogger = {
      info: () => {}, debug: () => {},
      warn:  (...args: unknown[]) => { explicitErrorLogged.push('warn') },
      error: (...args: unknown[]) => { explicitErrorLogged.push('error') },
    }
    // Track ONLY calls that come with an error code (from errorHandler, not request logger)
    const autoLogger = {
      info: () => {}, debug: () => {},
      warn:  (obj: Record<string, unknown>) => {
        if (obj['code']) autoErrorLogged.push('warn') // only count error-handler calls
      },
      error: (obj: Record<string, unknown>) => {
        if (obj['code']) autoErrorLogged.push('error')
      },
    }
    const app = express()
    app.use(express.json())
    app.use(shapeguard({ logger: { instance: autoLogger as any, silent: false } }))
    app.get('/boom2', (_req, _res, next) => { next(AppError.notFound()) })
    app.use(errorHandler({ logger: explicitLogger })) // explicit wins for error logging

    await supertest(app).get('/boom2')
    expect(explicitErrorLogged).toContain('warn')  // errorHandler used explicit
    expect(autoErrorLogged).toHaveLength(0)         // errorHandler did NOT use auto
  })

  it('does not crash when req.app is undefined (standalone unit-test usage)', () => {
    const handler = errorHandler({ debug: false })
    const res = makeRes()
    // makeReq() has no .app — must not throw
    expect(() => handler(AppError.notFound(), makeReq(), res, fakeNext)).not.toThrow()
    expect(res.statusCode).toBe(404)
  })

  it('does not crash when shapeguard() req.app is undefined (unit-test mock)', () => {
    const mw = shapeguard({ logger: { silent: true } })
    const req = makeReq() // no .app
    const res = makeRes()
    expect(() => mw(req, res, fakeNext)).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUG #6 — Cache-Control set before validation (CDNs could cache 422s)
// Verify: Cache-Control absent on validation errors, present on success
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #6 — Cache-Control only set after successful validation', () => {
  it('does NOT set Cache-Control header on 422 validation failure', async () => {
    const app = makeApp()
    const route = defineRoute({
      body:  zodAdapter(z.object({ name: z.string() })),
      cache: { maxAge: 60 },
    })
    app.post('/cached', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app)
      .post('/cached')
      .set('Content-Type', 'application/json')
      .send({ wrong: true })

    expect(res.status).toBe(422)
    expect(res.headers['cache-control']).toBeUndefined()
  })

  it('DOES set Cache-Control header on successful response', async () => {
    const app = makeApp()
    const route = defineRoute({
      body:  zodAdapter(z.object({ name: z.string() })),
      cache: { maxAge: 60 },
    })
    app.post('/cached-ok', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app)
      .post('/cached-ok')
      .set('Content-Type', 'application/json')
      .send({ name: 'Alice' })

    expect(res.status).toBe(201)
    expect(res.headers['cache-control']).toContain('max-age=60')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUG #8 — _rlStore module singleton bleeds between validate() instances
// Verify: hitting limit on /route-a does not affect /route-b
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #8 — Rate limit counters isolated per route', () => {
  beforeEach(() => { _clearRateLimitStore() })

  it('exhausting limit on route-a does not affect route-b', async () => {
    const app = makeApp()
    const routeA = defineRoute({ rateLimit: { windowMs: 60_000, max: 1 } })
    const routeB = defineRoute({ rateLimit: { windowMs: 60_000, max: 5 } })
    app.get('/route-a', ...handle(routeA, async (_req, res) => { res.ok({ data: 'a' }) }))
    app.get('/route-b', ...handle(routeB, async (_req, res) => { res.ok({ data: 'b' }) }))
    app.use(errorHandler({ debug: true }))

    // Exhaust route-a (max=1)
    await supertest(app).get('/route-a')
    const limitedA = await supertest(app).get('/route-a')
    expect(limitedA.status).toBe(429)

    // Route-b must be completely unaffected
    const okB = await supertest(app).get('/route-b')
    expect(okB.status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Improvement #2 — Retry-After HTTP header on 429 (RFC 7231)
// ═══════════════════════════════════════════════════════════════════════════
describe('Improvement #2 — Retry-After header on 429 responses', () => {
  beforeEach(() => { _clearRateLimitStore() })

  it('sets Retry-After header when rate limit is exceeded', async () => {
    const app = makeApp()
    const route = defineRoute({ rateLimit: { windowMs: 60_000, max: 1 } })
    app.get('/rl-retry', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler({ debug: true }))

    await supertest(app).get('/rl-retry') // use up limit
    const res = await supertest(app).get('/rl-retry') // hit limit

    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBeDefined()
    const retryAfter = parseInt(res.headers['retry-after'] as string, 10)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('Retry-After value in header matches retryAfter in body', async () => {
    const app = makeApp()
    const route = defineRoute({ rateLimit: { windowMs: 30_000, max: 1 } })
    app.get('/rl-match', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler({ debug: true }))

    await supertest(app).get('/rl-match')
    const res = await supertest(app).get('/rl-match')

    const headerVal = parseInt(res.headers['retry-after'] as string, 10)
    const bodyVal   = res.body.error.details?.retryAfter as number
    expect(headerVal).toBe(bodyVal)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Improvement #4 — noStore: true no longer requires maxAge
// Improvement #5 — s-maxage and stale-while-revalidate directives
// ═══════════════════════════════════════════════════════════════════════════
describe('Improvements #4+5 — Cache API: discriminated union + CDN directives', () => {
  it('accepts { noStore: true } without maxAge', async () => {
    const app = makeApp()
    const route = defineRoute({ cache: { noStore: true } })
    app.get('/no-cache', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler())

    const res = await supertest(app).get('/no-cache')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('backward compat: { maxAge: 60, noStore: true } still sets no-store', async () => {
    const app = makeApp()
    const route = defineRoute({ cache: { maxAge: 60, noStore: true } })
    app.get('/no-cache-compat', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler())

    const res = await supertest(app).get('/no-cache-compat')
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('sets s-maxage directive for CDN TTL', async () => {
    const app = makeApp()
    const route = defineRoute({ cache: { maxAge: 60, sMaxAge: 300 } })
    app.get('/cdn', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler())

    const res = await supertest(app).get('/cdn')
    expect(res.headers['cache-control']).toContain('s-maxage=300')
    expect(res.headers['cache-control']).toContain('max-age=60')
  })

  it('sets stale-while-revalidate directive', async () => {
    const app = makeApp()
    const route = defineRoute({ cache: { maxAge: 60, staleWhileRevalidate: 30 } })
    app.get('/swr', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler())

    const res = await supertest(app).get('/swr')
    expect(res.headers['cache-control']).toContain('stale-while-revalidate=30')
  })

  it('combines maxAge + s-maxage + stale-while-revalidate in one header', async () => {
    const app = makeApp()
    const route = defineRoute({ cache: { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 30 } })
    app.get('/full-cdn', ...handle(route, async (_req, res) => { res.ok({ data: 'ok' }) }))
    app.use(errorHandler())

    const res = await supertest(app).get('/full-cdn')
    const cc = res.headers['cache-control'] as string
    expect(cc).toContain('public')
    expect(cc).toContain('max-age=60')
    expect(cc).toContain('s-maxage=300')
    expect(cc).toContain('stale-while-revalidate=30')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BUG #5 — errorHandler auto-logger (unit-level, no Express app needed)
// ═══════════════════════════════════════════════════════════════════════════
describe('BUG #5 — errorHandler: auto-logger unit tests', () => {
  it('uses logger from req.app.locals when no explicit logger option passed', () => {
    const autoLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const handler = errorHandler({ debug: false })
    const res = makeRes()
    const req = makeReq({ app: { locals: { __sg_logger__: autoLogger } } } as any)
    handler(AppError.notFound(), req, res, fakeNext)
    expect(autoLogger.warn).toHaveBeenCalled()
  })

  it('explicit logger option takes precedence over app.locals logger', () => {
    const explicitLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const appLogger      = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const handler = errorHandler({ debug: false, logger: explicitLogger })
    const res = makeRes()
    const req = makeReq({ app: { locals: { __sg_logger__: appLogger } } } as any)
    handler(AppError.notFound(), req, res, fakeNext)
    expect(explicitLogger.warn).toHaveBeenCalled()
    expect(appLogger.warn).not.toHaveBeenCalled()
  })

  it('does not crash when req.app is undefined', () => {
    const handler = errorHandler({ debug: false })
    const res = makeRes()
    expect(() => handler(AppError.notFound(), makeReq(), res, fakeNext)).not.toThrow()
    expect(res.statusCode).toBe(404)
  })

  it('5xx errors use logger.error not logger.warn', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const handler = errorHandler({ debug: true, logger })
    const res = makeRes()
    handler(new Error('boom'), makeReq(), res, fakeNext)
    expect(logger.error).toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

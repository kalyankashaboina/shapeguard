// src/__tests__/v0.10.0-features.test.ts
// Real integration tests for v0.10.0 features:
//   healthCheck, gracefulShutdown, request timeout,
//   GitHub webhook deduplication, inMemoryDeduplicator,
//   resetLoggerForTesting, res.created/accepted opts.status,
//   router.use() 405 tracking, operationId dedup.
//
// These tests hit a real Express server with real HTTP requests via supertest.
// No mocking of the features under test.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { createHmac } from 'crypto'
import {
  shapeguard, defineRoute, handle,
  errorHandler, notFoundHandler,
  healthCheck, gracefulShutdown,
  verifyWebhook, inMemoryDeduplicator,
  resetLoggerForTesting, configureLogger,
  validate,
} from '../index.js'
import { createRouter } from '../router/create-router.js'
import { generateOpenAPI } from '../openapi/index.js'

// ── Shared: silence logger in tests ─────────────────────────────────────────
beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// healthCheck()
// ─────────────────────────────────────────────────────────────────────────────
describe('healthCheck()', () => {
  function makeApp(checks: Parameters<typeof healthCheck>[0]['checks']) {
    const app = express()
    app.use('/health', healthCheck({ checks, timeout: 2_000 }))
    return app
  }

  it('returns 200 and healthy status when all checks pass', async () => {
    const app = makeApp({
      pass1: async () => 'ok',
      pass2: async () => 42,
    })
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('healthy')
    expect(res.body.checks.pass1).toBe('ok')
    expect(res.body.checks.pass2).toBe('ok')
  })

  it('returns 503 and unhealthy status when any check throws', async () => {
    const app = makeApp({
      good: async () => 'fine',
      bad:  async () => { throw new Error('DB connection refused') },
    })
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('unhealthy')
    expect(res.body.checks.good).toBe('ok')
    expect(res.body.checks.bad).toBe('error')
  })

  it('returns 503 when a check times out', async () => {
    const app = express()
    app.use('/health', healthCheck({
      checks: {
        slow: () => new Promise(r => setTimeout(r, 5_000)),  // never resolves in time
      },
      timeout: 50,  // 50ms timeout
    }))
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body.checks.slow).toBe('timeout')
  })

  it('runs all checks in parallel — slow check does not block fast check', async () => {
    const order: string[] = []
    const app = makeApp({
      slow: async () => { await new Promise(r => setTimeout(r, 100)); order.push('slow') },
      fast: async () => { order.push('fast') },
    })
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(200)
    // fast should complete before slow since they run in parallel
    expect(order[0]).toBe('fast')
  })

  it('includes uptime, version and time in response', async () => {
    const app = makeApp({ ping: async () => 'pong' })
    const res = await supertest(app).get('/health')
    expect(typeof res.body.uptime).toBe('number')
    expect(res.body.uptime).toBeGreaterThanOrEqual(0)
    expect(res.body.version).toMatch(/^v\d+\.\d+/)
    expect(new Date(res.body.time)).toBeInstanceOf(Date)
  })

  it('healthCheck.memory() passes under normal conditions', async () => {
    const app = makeApp({ mem: healthCheck.memory({ maxPercent: 99 }) })
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.checks.mem).toBe('ok')
  })

  it('healthCheck.env() passes when env vars exist', async () => {
    process.env['TEST_VAR_EXISTS'] = 'yes'
    const app = makeApp({ env: healthCheck.env(['TEST_VAR_EXISTS']) })
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(200)
    delete process.env['TEST_VAR_EXISTS']
  })

  it('healthCheck.env() fails when env vars are missing', async () => {
    const app = makeApp({ env: healthCheck.env(['MISSING_VAR_XYZ_123']) })
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body.checks.env).toBe('error')
  })

  it('is standalone — works without shapeguard() mounted', async () => {
    const app = express()
    // No shapeguard() middleware at all
    app.get('/health', healthCheck({ checks: { up: healthCheck.uptime() } }) as express.RequestHandler)
    const res = await supertest(app).get('/health')
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Per-route request timeout
// ─────────────────────────────────────────────────────────────────────────────
describe('request timeout', () => {
  function makeApp(timeoutMs: number, handlerDelayMs: number) {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())
    const router = express.Router()

    router.get('/slow', ...handle(
      defineRoute({ timeout: timeoutMs }),
      async (_req, res) => {
        await new Promise(r => setTimeout(r, handlerDelayMs))
        res.ok({ data: { done: true } })
      }
    ))

    app.use(router)
    app.use(errorHandler())
    return app
  }

  it('returns 408 when handler exceeds timeout', async () => {
    const app = makeApp(50, 500)   // 50ms timeout, 500ms handler
    const res = await supertest(app).get('/slow')
    expect(res.status).toBe(408)
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT')
  })

  it('completes normally when handler finishes within timeout', async () => {
    const app = makeApp(500, 10)   // 500ms timeout, 10ms handler
    const res = await supertest(app).get('/slow')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('timeout does not fire after response is sent', async () => {
    // Handler responds immediately — timer must be cleared
    const app = express()
    app.use(express.json())
    app.use(shapeguard())
    const nextSpy = vi.fn()
    app.get('/fast', validate(defineRoute({ timeout: 200 })), (_req, res) => {
      res.json({ ok: true })
    })
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      nextSpy()
      res.status(500).json({ error: true })
    })

    const res = await supertest(app).get('/fast')
    // Wait longer than the timeout to ensure the timer would have fired
    await new Promise(r => setTimeout(r, 300))
    expect(res.status).toBe(200)
    expect(nextSpy).not.toHaveBeenCalled()
  }, 1000)
})

// ─────────────────────────────────────────────────────────────────────────────
// inMemoryDeduplicator + GitHub webhook deduplication
// ─────────────────────────────────────────────────────────────────────────────
describe('inMemoryDeduplicator', () => {
  it('has() returns false for unseen IDs', () => {
    const dedup = inMemoryDeduplicator()
    expect(dedup.has('abc')).toBe(false)
  })

  it('has() returns true after add()', () => {
    const dedup = inMemoryDeduplicator()
    dedup.add('abc', 60)
    expect(dedup.has('abc')).toBe(true)
  })

  it('has() returns false after TTL expires', async () => {
    const dedup = inMemoryDeduplicator()
    dedup.add('abc', 0)  // 0-second TTL — expires immediately
    await new Promise(r => setTimeout(r, 10))
    expect(dedup.has('abc')).toBe(false)
  })

  it('tracks multiple IDs independently', () => {
    const dedup = inMemoryDeduplicator()
    dedup.add('id1', 60)
    dedup.add('id2', 60)
    expect(dedup.has('id1')).toBe(true)
    expect(dedup.has('id2')).toBe(true)
    expect(dedup.has('id3')).toBe(false)
  })
})

describe('GitHub webhook deduplication', () => {
  const SECRET = 'test-github-secret'

  function sign(body: string) {
    return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')
  }

  function makeApp(dedup?: ReturnType<typeof inMemoryDeduplicator>) {
    const app = express()
    app.post('/webhook',
      express.raw({ type: 'application/json' }),
      verifyWebhook({ provider: 'github', secret: SECRET, dedup }),
      (_req, res) => res.json({ received: true })
    )
    app.use(errorHandler())
    return app
  }

  it('accepts a valid webhook with correct signature', async () => {
    const body = JSON.stringify({ action: 'push' })
    const sig  = sign(body)
    const res  = await supertest(makeApp())
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .set('x-github-delivery', 'delivery-001')
      .send(body)
    expect(res.status).toBe(200)
  })

  it('rejects a webhook with wrong signature', async () => {
    const body = JSON.stringify({ action: 'push' })
    const res  = await supertest(makeApp())
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', 'sha256=wrong')
      .set('x-github-delivery', 'delivery-002')
      .send(body)
    expect(res.status).toBe(401)
  })

  it('accepts same delivery ID without dedup configured', async () => {
    const body = JSON.stringify({ action: 'push' })
    const sig  = sign(body)
    const app  = makeApp()  // no dedup

    const res1 = await supertest(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .set('x-github-delivery', 'dup-delivery')
      .send(body)
    const res2 = await supertest(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .set('x-github-delivery', 'dup-delivery')
      .send(body)
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)  // no dedup — both accepted
  })

  it('rejects duplicate delivery ID when dedup is configured', async () => {
    const body  = JSON.stringify({ action: 'push' })
    const sig   = sign(body)
    const dedup = inMemoryDeduplicator()
    const app   = makeApp(dedup)

    const res1 = await supertest(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .set('x-github-delivery', 'unique-delivery-xyz')
      .send(body)
    expect(res1.status).toBe(200)

    const res2 = await supertest(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .set('x-github-delivery', 'unique-delivery-xyz')
      .send(body)
    expect(res2.status).toBe(400)
    expect(res2.body.error.code).toBe('WEBHOOK_DELIVERY_DUPLICATE')
  })

  it('accepts different delivery IDs with dedup configured', async () => {
    const body  = JSON.stringify({ action: 'push' })
    const sig   = sign(body)
    const dedup = inMemoryDeduplicator()
    const app   = makeApp(dedup)

    const r1 = await supertest(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .set('x-github-delivery', 'delivery-A')
      .send(body)
    const r2 = await supertest(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .set('x-github-delivery', 'delivery-B')
      .send(body)
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resetLoggerForTesting
// ─────────────────────────────────────────────────────────────────────────────
describe('resetLoggerForTesting', () => {
  it('allows reconfiguring the logger after reset', () => {
    resetLoggerForTesting()
    // Should not throw when configuring after reset
    expect(() => configureLogger({ silent: true, level: 'error' })).not.toThrow()
  })

  it('new logger instance is created after reset + configure', () => {
    resetLoggerForTesting()
    const l1 = configureLogger({ silent: true })
    resetLoggerForTesting()
    const l2 = configureLogger({ silent: true })
    // Both are valid logger objects
    expect(typeof l1.info).toBe('function')
    expect(typeof l2.info).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// res.created / res.accepted opts.status override
// ─────────────────────────────────────────────────────────────────────────────
describe('res.created and res.accepted opts.status override', () => {
  function makeApp() {
    const app = express()
    app.use(shapeguard())
    app.get('/created-default', (_req, res) => res.created({ data: 'x' }))
    app.get('/created-200',     (_req, res) => res.created({ data: 'x', status: 200 }))
    app.get('/accepted-default',(_req, res) => res.accepted({ data: 'x' }))
    app.get('/accepted-200',    (_req, res) => res.accepted({ data: 'x', status: 200 }))
    return app
  }

  const app = makeApp()

  it('res.created() defaults to 201', async () => {
    const res = await supertest(app).get('/created-default')
    expect(res.status).toBe(201)
  })

  it('res.created() respects opts.status override', async () => {
    const res = await supertest(app).get('/created-200')
    expect(res.status).toBe(200)
  })

  it('res.accepted() defaults to 202', async () => {
    const res = await supertest(app).get('/accepted-default')
    expect(res.status).toBe(202)
  })

  it('res.accepted() respects opts.status override', async () => {
    const res = await supertest(app).get('/accepted-200')
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createRouter router.use() 405 tracking for sub-routers
// ─────────────────────────────────────────────────────────────────────────────
describe('createRouter router.use() 405 tracking', () => {
  it('returns 405 for unregistered method on sub-router path', async () => {
    const app         = express()
    const parentRouter = createRouter()
    const subRouter   = express.Router()

    subRouter.get('/items',  (_req, res) => res.json({ ok: true }))
    subRouter.post('/items', (_req, res) => res.json({ ok: true }))

    parentRouter.use('/api', subRouter)
    app.use(parentRouter)
    app.use(notFoundHandler())
    app.use(errorHandler())

    const res = await supertest(app).delete('/api/items')
    expect(res.status).toBe(405)
    expect(res.headers['allow']).toContain('GET')
    expect(res.headers['allow']).toContain('POST')
  })

  it('still returns 404 for completely unknown paths', async () => {
    const app    = express()
    const router = createRouter()
    router.get('/known', (_req, res) => res.json({ ok: true }))
    app.use(router)
    app.use(notFoundHandler())
    app.use(errorHandler())

    const res = await supertest(app).get('/unknown-path')
    expect(res.status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateOpenAPI operationId deduplication
// ─────────────────────────────────────────────────────────────────────────────
describe('generateOpenAPI operationId deduplication', () => {
  it('generates unique operationIds for duplicate-named routes', () => {
    const spec = generateOpenAPI({
      title:   'Test',
      version: '1.0.0',
      routes: {
        'GET /api/v1/users': { summary: 'v1 users' },
        'GET /api/v2/users': { summary: 'v2 users' },
      },
    })

    const ops = Object.values(spec.paths).flatMap(p => Object.values(p)).map(o => o.operationId)
    const unique = new Set(ops)
    expect(unique.size).toBe(ops.length)  // all operationIds are unique
  })

  it('keeps simple non-conflicting operationIds as-is', () => {
    const spec = generateOpenAPI({
      title:   'Test',
      version: '1.0.0',
      routes: {
        'GET  /users':    {},
        'POST /users':    {},
        'GET  /products': {},
      },
    })

    const ops = Object.values(spec.paths).flatMap(p => Object.values(p)).map(o => o.operationId)
    // All should be non-empty strings
    ops.forEach(id => expect(typeof id).toBe('string'))
    // All unique
    expect(new Set(ops).size).toBe(ops.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// gracefulShutdown — deregistration (no SIGTERM actually sent in tests)
// ─────────────────────────────────────────────────────────────────────────────
describe('gracefulShutdown deregistration', () => {
  it('returns a deregister function that removes signal listeners', () => {
    const app    = express()
    const server = app.listen(0)  // random port

    const listenersBefore = process.listenerCount('SIGTERM')
    const deregister = gracefulShutdown(server, { signals: ['SIGTERM'] })
    const listenersAfter = process.listenerCount('SIGTERM')

    expect(listenersAfter).toBe(listenersBefore + 1)

    deregister()
    const listenersAfterDeregister = process.listenerCount('SIGTERM')
    expect(listenersAfterDeregister).toBe(listenersBefore)

    server.close()
  })
})

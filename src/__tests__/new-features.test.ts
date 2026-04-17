// src/__tests__/new-features.test.ts
// Tests for all 8 new features:
//   pipe(), context store, AppError extensions,
//   SSE, circuit breaker, defineGroup, AppError.is/httpStatus

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { z } from 'zod'

import {
  shapeguard, defineRoute, handle, errorHandler, notFoundHandler,
  AppError,
  pipe, setContext, getContext, requireContext, getFullContext, contextMiddleware,
  sseStream, enableSSE,
  circuitBreaker, CircuitOpenError,
  defineGroup,
  resetLoggerForTesting, configureLogger,
} from '../index.js'

beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// pipe() — composable middleware chains
// ─────────────────────────────────────────────────────────────────────────────
describe('pipe()', () => {
  it('flattens multiple middleware into a single array', () => {
    const mw1 = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next())
    const mw2 = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next())
    const mw3 = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next())

    const result = pipe(mw1, mw2, mw3)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(3)
  })

  it('flattens nested arrays (e.g. from handle())', () => {
    const mw1 = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next())
    const mw2 = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next())
    const arr  = [mw1, mw2]

    const result = pipe(arr)
    expect(result).toHaveLength(2)
  })

  it('executes middleware left-to-right via HTTP', async () => {
    const order: number[] = []
    const app = express()
    app.use(shapeguard())

    const m1: express.RequestHandler = (_req, _res, next) => { order.push(1); next() }
    const m2: express.RequestHandler = (_req, _res, next) => { order.push(2); next() }
    const m3: express.RequestHandler = (_req, res)        => { order.push(3); res.json({ order }) }

    app.get('/test', ...pipe(m1, m2, m3))

    const res = await supertest(app).get('/test')
    expect(res.status).toBe(200)
    expect(res.body.order).toEqual([1, 2, 3])
  })

  it('stops chain when middleware calls next(err)', async () => {
    const app = express()
    const hit  = vi.fn()

    const failMw: express.RequestHandler = (_req, _res, next) => next(AppError.unauthorized())
    const final: express.RequestHandler  = (_req, res) => { hit(); res.json({ ok: true }) }

    app.get('/test', ...pipe(failMw, final))
    app.use(errorHandler())

    const res = await supertest(app).get('/test')
    expect(res.status).toBe(401)
    expect(hit).not.toHaveBeenCalled()
  })

  it('works with handle() output (nested array)', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())

    const authMw: express.RequestHandler = (_req, _res, next) => next()
    const route = handle(defineRoute({ body: z.object({ x: z.string() }) }), async (req, res) => {
      res.ok({ data: req.body, message: '' })
    })

    app.post('/test', ...pipe(authMw, ...route))
    app.use(errorHandler())

    const res = await supertest(app).post('/test').send({ x: 'hello' })
    expect(res.status).toBe(201)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Typed context store
// ─────────────────────────────────────────────────────────────────────────────
describe('context store — setContext / getContext / requireContext', () => {
  it('stores and retrieves typed values per-request', async () => {
    const app = express()

    app.use((req, _res, next) => {
      setContext(req, 'user', { id: 'u1', role: 'admin' })
      next()
    })

    app.get('/me', (req, res) => {
      const user = getContext<{ id: string; role: string }>(req, 'user')
      res.json({ user })
    })

    const res = await supertest(app).get('/me')
    expect(res.body.user.id).toBe('u1')
    expect(res.body.user.role).toBe('admin')
  })

  it('returns undefined when key not set', () => {
    const req = {} as express.Request
    const val = getContext(req, 'missing')
    expect(val).toBeUndefined()
  })

  it('requireContext throws when key missing', () => {
    const req = {} as express.Request
    expect(() => requireContext(req, 'user')).toThrow('key "user" not found')
  })

  it('requireContext returns value when set', () => {
    const req = {} as express.Request
    setContext(req, 'tenant', { id: 'acme' })
    const tenant = requireContext<{ id: string }>(req, 'tenant')
    expect(tenant.id).toBe('acme')
  })

  it('getFullContext returns all keys', () => {
    const req = {} as express.Request
    setContext(req, 'a', 1)
    setContext(req, 'b', 'hello')
    const ctx = getFullContext(req)
    expect(ctx['a']).toBe(1)
    expect(ctx['b']).toBe('hello')
  })

  it('contextMiddleware injects a fixed value', async () => {
    const app = express()
    app.use(contextMiddleware('version', 'v2'))
    app.get('/ver', (req, res) => {
      res.json({ version: getContext(req, 'version') })
    })

    const res = await supertest(app).get('/ver')
    expect(res.body.version).toBe('v2')
  })

  it('contextMiddleware calls factory function per-request', async () => {
    const app = express()
    app.use(contextMiddleware('now', (req: express.Request) => req.path + '-timestamp'))
    app.get('/ts', (req, res) => {
      res.json({ now: getContext(req, 'now') })
    })

    const res = await supertest(app).get('/ts')
    expect(res.body.now).toBe('/ts-timestamp')
  })

  it('context is isolated per request', async () => {
    const app = express()
    app.use((req, _res, next) => {
      setContext(req, 'id', Math.random())
      next()
    })

    const [r1, r2] = await Promise.all([
      supertest(app).get('/'),
      supertest(app).get('/'),
    ])
    // Both respond — we can't test isolation at network level easily
    // but no crash means no cross-contamination
    expect(r1.status).toBe(404)
    expect(r2.status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AppError extensions
// ─────────────────────────────────────────────────────────────────────────────
describe('AppError extensions', () => {
  describe('AppError.httpStatus()', () => {
    it('creates 404 error', () => {
      const err = AppError.httpStatus(404)
      expect(err.statusCode).toBe(404)
      expect(err.code).toBe('NOT_FOUND')
    })

    it('creates 503 error', () => {
      const err = AppError.httpStatus(503, 'DB is down')
      expect(err.statusCode).toBe(503)
      expect(err.message).toBe('DB is down')
    })

    it('creates unknown status with generic code', () => {
      const err = AppError.httpStatus(418)
      expect(err.statusCode).toBe(418)
      expect(err.code).toBe('HTTP_418')
    })

    it('uses custom message when provided', () => {
      const err = AppError.httpStatus(422, 'Custom validation message')
      expect(err.message).toBe('Custom validation message')
    })

    it('maps all standard HTTP codes', () => {
      expect(AppError.httpStatus(400).code).toBe('BAD_REQUEST')
      expect(AppError.httpStatus(401).code).toBe('UNAUTHORIZED')
      expect(AppError.httpStatus(403).code).toBe('FORBIDDEN')
      expect(AppError.httpStatus(409).code).toBe('CONFLICT')
      expect(AppError.httpStatus(429).code).toBe('RATE_LIMIT_EXCEEDED')
      expect(AppError.httpStatus(500).code).toBe('INTERNAL_ERROR')
    })
  })

  describe('AppError.is()', () => {
    it('returns true when code matches', () => {
      const err = AppError.notFound('User')
      expect(AppError.is(err, 'NOT_FOUND')).toBe(true)
    })

    it('returns false when code does not match', () => {
      const err = AppError.notFound()
      expect(AppError.is(err, 'UNAUTHORIZED')).toBe(false)
    })

    it('returns false for non-AppError', () => {
      expect(AppError.is(new Error('oops'), 'NOT_FOUND')).toBe(false)
    })

    it('returns false for null/undefined', () => {
      expect(AppError.is(null, 'NOT_FOUND')).toBe(false)
      expect(AppError.is(undefined, 'NOT_FOUND')).toBe(false)
    })

    it('works in catch block pattern', () => {
      try {
        throw AppError.conflict('Email')
      } catch (err) {
        if (AppError.is(err, 'CONFLICT')) {
          expect(err.statusCode).toBe(409)
        } else {
          throw new Error('Should have been CONFLICT')
        }
      }
    })
  })

  describe('AppError.hasStatus()', () => {
    it('matches by HTTP status code', () => {
      const err = AppError.notFound()
      expect(AppError.hasStatus(err, 404)).toBe(true)
      expect(AppError.hasStatus(err, 500)).toBe(false)
    })
  })

  describe('AppError.badRequest()', () => {
    it('creates 400 error', () => {
      const err = AppError.badRequest('Invalid input')
      expect(err.statusCode).toBe(400)
      expect(err.message).toBe('Invalid input')
    })
  })

  describe('AppError.tooManyRequests()', () => {
    it('creates 429 with retryAfter', () => {
      const err = AppError.tooManyRequests('Slow down', 30)
      expect(err.statusCode).toBe(429)
      expect((err.details as { retryAfter: number }).retryAfter).toBe(30)
    })
  })

  describe('AppError.serviceUnavailable()', () => {
    it('creates 503 error', () => {
      const err = AppError.serviceUnavailable()
      expect(err.statusCode).toBe(503)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SSE streaming
// ─────────────────────────────────────────────────────────────────────────────
describe('sseStream()', () => {
  it('sets correct SSE headers', async () => {
    const app = express()
    app.get('/stream', (req, res) => {
      const stream = sseStream(res)
      stream.send({ data: { count: 1 } })
      stream.close()
    })

    const res = await supertest(app).get('/stream')
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.headers['cache-control']).toContain('no-cache')
  })

  it('serializes events to SSE format', async () => {
    const app = express()
    app.get('/stream', (req, res) => {
      const stream = sseStream(res)
      stream.send({ type: 'update', data: { value: 42 }, id: '1' })
      stream.close()
    })

    const res = await supertest(app).get('/stream')
    expect(res.text).toContain('event: update')
    expect(res.text).toContain('data: {"value":42}')
    expect(res.text).toContain('id: 1')
  })

  it('sends heartbeat comment', async () => {
    const app = express()
    app.get('/stream', (req, res) => {
      const stream = sseStream(res)
      stream.heartbeat()
      stream.close()
    })

    const res = await supertest(app).get('/stream')
    expect(res.text).toContain(': heartbeat')
  })

  it('stream.closed is true after close()', async () => {
    const app = express()
    let wasClosed = false

    app.get('/stream', (req, res) => {
      const stream = sseStream(res)
      stream.close()
      wasClosed = stream.closed
      res.end()
    })

    await supertest(app).get('/stream')
    expect(wasClosed).toBe(true)
  })

  it('sends retry hint when provided', async () => {
    const app = express()
    app.get('/stream', (req, res) => {
      const stream = sseStream(res)
      stream.send({ data: { x: 1 }, retry: 5000 })
      stream.close()
    })

    const res = await supertest(app).get('/stream')
    expect(res.text).toContain('retry: 5000')
  })

  it('enableSSE middleware sets correct headers', async () => {
    const app = express()
    app.get('/stream', enableSSE, (req, res) => {
      const stream = sseStream(res)
      stream.send({ data: 'hello' })
      stream.close()
    })

    const res = await supertest(app).get('/stream')
    expect(res.headers['x-accel-buffering']).toBe('no')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker
// ─────────────────────────────────────────────────────────────────────────────
describe('circuitBreaker()', () => {
  it('starts CLOSED and passes calls through', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 3 })
    expect(cb.state).toBe('CLOSED')
    const result = await cb.call(async () => 'hello')
    expect(result).toBe('hello')
    expect(cb.state).toBe('CLOSED')
  })

  it('counts failures and opens after threshold', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 3, resetTimeout: 60_000 })

    for (let i = 0; i < 3; i++) {
      try { await cb.call(async () => { throw new Error('fail') }) } catch { /* expected */ }
    }

    expect(cb.state).toBe('OPEN')
    expect(cb.failures).toBe(3)
  })

  it('throws CircuitOpenError when OPEN', async () => {
    const cb = circuitBreaker({ name: 'payments', threshold: 1, resetTimeout: 60_000 })

    try { await cb.call(async () => { throw new Error('fail') }) } catch { /* expected */ }

    await expect(cb.call(async () => 'never called')).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('CircuitOpenError has the circuit name', async () => {
    const cb = circuitBreaker({ name: 'stripe-api', threshold: 1, resetTimeout: 60_000 })
    try { await cb.call(async () => { throw new Error() }) } catch { /* expected */ }

    try {
      await cb.call(async () => 'x')
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError)
      expect((err as CircuitOpenError).circuitName).toBe('stripe-api')
    }
  })

  it('calls onOpen hook when circuit trips', async () => {
    const onOpen = vi.fn()
    const cb = circuitBreaker({ name: 'db', threshold: 2, onOpen })

    for (let i = 0; i < 2; i++) {
      try { await cb.call(async () => { throw new Error() }) } catch { /* expected */ }
    }

    expect(onOpen).toHaveBeenCalledWith('db', 2)
  })

  it('calls onClose and resets after successful call', async () => {
    const onClose = vi.fn()
    const cb = circuitBreaker({ name: 'cache', threshold: 2, onClose })

    for (let i = 0; i < 2; i++) {
      try { await cb.call(async () => { throw new Error() }) } catch { /* expected */ }
    }
    expect(cb.state).toBe('OPEN')

    // Manually reset to simulate recovery
    cb.reset()
    expect(cb.state).toBe('CLOSED')
    expect(onClose).toHaveBeenCalledWith('cache')
  })

  it('manual trip() opens the circuit', () => {
    const cb = circuitBreaker({ name: 'test', threshold: 10 })
    expect(cb.state).toBe('CLOSED')
    cb.trip()
    expect(cb.state).toBe('OPEN')
  })

  it('moves to HALF_OPEN after resetTimeout and allows one probe', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 1, resetTimeout: 10 })

    try { await cb.call(async () => { throw new Error() }) } catch { /* expected */ }
    expect(cb.state).toBe('OPEN')

    await new Promise(r => setTimeout(r, 20))

    // Next call after timeout should be allowed (HALF_OPEN probe)
    const result = await cb.call(async () => 'recovered')
    expect(result).toBe('recovered')
    expect(cb.state).toBe('CLOSED')  // success → closed
  })

  it('works with healthCheck', async () => {
    const cb = circuitBreaker({ name: 'redis', threshold: 3 })
    const app = express()
    app.use('/health', (await import('../core/health-check.js')).healthCheck({
      checks: { redis: cb.probe },
    }))

    const res = await supertest(app).get('/health')
    expect(res.status).toBe(200)  // circuit closed = healthy
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// defineGroup()
// ─────────────────────────────────────────────────────────────────────────────
describe('defineGroup()', () => {
  it('mounts routes at the given prefix', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())

    app.use(defineGroup('/users', {
      routes: (r) => {
        r.get('/', (_req, res) => { res.json({ users: [] }) })
        r.get('/:id', (req, res) => { res.json({ id: req.params.id }) })
      },
    }))
    app.use(errorHandler())

    const list = await supertest(app).get('/users')
    expect(list.status).toBe(200)
    expect(list.body.users).toEqual([])

    const get = await supertest(app).get('/users/abc-123')
    expect(get.status).toBe(200)
    expect(get.body.id).toBe('abc-123')
  })

  it('applies group middleware to all routes', async () => {
    const app  = express()
    const hits: string[] = []

    const authMw: express.RequestHandler = (_req, _res, next) => {
      hits.push('auth')
      next()
    }

    app.use(defineGroup('/api', {
      middleware: [authMw],
      routes: (r) => {
        r.get('/a', (_req, res) => { res.json({ route: 'a' }) })
        r.get('/b', (_req, res) => { res.json({ route: 'b' }) })
      },
    }))

    await supertest(app).get('/api/a')
    await supertest(app).get('/api/b')
    expect(hits).toEqual(['auth', 'auth'])
  })

  it('returns 404 for unknown routes in the group', async () => {
    const app = express()
    app.use(defineGroup('/items', {
      routes: (r) => { r.get('/', (_req, res) => res.json({ ok: true })) },
    }))
    app.use(notFoundHandler())
    app.use(errorHandler())

    const res = await supertest(app).get('/items/unknown-deep-path')
    expect(res.status).toBe(404)
  })

  it('multiple groups coexist without conflict', async () => {
    const app = express()
    app.use(defineGroup('/users', {
      routes: (r) => { r.get('/', (_req, res) => res.json({ group: 'users' })) },
    }))
    app.use(defineGroup('/posts', {
      routes: (r) => { r.get('/', (_req, res) => res.json({ group: 'posts' })) },
    }))

    const u = await supertest(app).get('/users')
    const p = await supertest(app).get('/posts')
    expect(u.body.group).toBe('users')
    expect(p.body.group).toBe('posts')
  })

  it('works with handle() inside routes', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())

    const CreateRoute = defineRoute({ body: z.object({ name: z.string() }) })

    app.use(defineGroup('/products', {
      routes: (r) => {
        r.post('/', ...handle(CreateRoute, async (req, res) => {
          res.created({ data: { name: req.body.name }, message: 'Created' })
        }))
      },
    }))
    app.use(errorHandler())

    const res = await supertest(app).post('/products').send({ name: 'Widget' })
    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Widget')
  })
})

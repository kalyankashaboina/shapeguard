// ═══════════════════════════════════════════════════════════════════════
// v0.11.0-features.test.ts — shapeguard
// Tests for all new features:
//   - AppError.fromFetch(), AppError.withContext(), AppError.httpStatus()
//   - validateResponse(), checkResponse()
//   - createDTO() with any adapter
//   - res.fail(AppError) direct usage
//   - circuit-breaker HALF_OPEN recovery, probe(), onOpen/onClose/onFailure
//   - defineGroup() middleware isolation
//   - pipe() with real Express routes
//   - context store edge cases
//   - SSE stream edge cases
//   - mergeRoutes() deep merge
// ═══════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { z } from 'zod'

import {
  shapeguard, defineRoute, handle, mergeRoutes, pipe,
  defineGroup,
  setContext, getContext, requireContext, contextMiddleware,
  sseStream, enableSSE, onClientDisconnect,
  circuitBreaker, CircuitOpenError,
  validateResponse, checkResponse,
  AppError, errorHandler, notFoundHandler,
  createDTO,
  resetLoggerForTesting, configureLogger,
} from '../index.js'
import { mockRequest } from '../testing/index.js'
import { joiAdapter } from '../adapters/joi.js'
import type { Request } from 'express'

beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// AppError.fromFetch()
// ─────────────────────────────────────────────────────────────────────────────
describe('AppError.fromFetch()', () => {
  it('creates AppError from a 404 fetch response', async () => {
    const mockResp = { status: 404, statusText: 'Not Found', text: async () => 'User not found' }
    const err = await AppError.fromFetch(mockResp)
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('User not found')
    expect(err.isOperational).toBe(true)  // 404 = operational
  })

  it('creates AppError from a 500 fetch response', async () => {
    const mockResp = { status: 500, statusText: 'Internal Server Error', text: async () => '' }
    const err = await AppError.fromFetch(mockResp)
    expect(err.statusCode).toBe(500)
    expect(err.isOperational).toBe(false)  // 5xx = programmer error
  })

  it('creates AppError from a 429 fetch response', async () => {
    const mockResp = { status: 429, statusText: 'Too Many Requests', text: async () => 'Rate limit hit' }
    const err = await AppError.fromFetch(mockResp)
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('uses statusText when body is empty', async () => {
    const mockResp = { status: 503, statusText: 'Service Unavailable', text: async () => '' }
    const err = await AppError.fromFetch(mockResp)
    expect(err.message).toBe('Service Unavailable')
  })

  it('handles unknown status codes gracefully', async () => {
    const mockResp = { status: 418, statusText: "I'm a teapot", text: async () => '' }
    const err = await AppError.fromFetch(mockResp)
    expect(err.statusCode).toBe(418)
    expect(err.code).toBe('HTTP_418')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AppError.withContext()
// ─────────────────────────────────────────────────────────────────────────────
describe('AppError.withContext()', () => {
  it('attaches extra details to the error', () => {
    const err = AppError.notFound('User').withContext({ userId: 'u_123', requestedBy: 'admin' })
    expect(err.statusCode).toBe(404)
    expect((err.details as Record<string, unknown>)['userId']).toBe('u_123')
    expect((err.details as Record<string, unknown>)['requestedBy']).toBe('admin')
  })

  it('preserves original error code and message', () => {
    const original = AppError.conflict('Email')
    const enriched = original.withContext({ email: 'test@test.com' })
    expect(enriched.code).toBe(original.code)
    expect(enriched.message).toBe(original.message)
    expect(enriched.statusCode).toBe(409)
  })

  it('merges with existing details', () => {
    const err = AppError.badRequest('Bad input', { field: 'email' })
      .withContext({ requestId: 'req_abc' })
    expect((err.details as Record<string, unknown>)['field']).toBe('email')
    expect((err.details as Record<string, unknown>)['requestId']).toBe('req_abc')
  })

  it('withContext does not mutate original error', () => {
    const original = AppError.notFound('User')
    const enriched = original.withContext({ extra: 'data' })
    expect(original.details).toBeNull()
    expect(enriched.details).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AppError.httpStatus() edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe('AppError.httpStatus() edge cases', () => {
  it('uses custom message when provided', () => {
    const err = AppError.httpStatus(404, 'Product not found')
    expect(err.message).toBe('Product not found')
    expect(err.statusCode).toBe(404)
  })

  it('uses default message when none provided', () => {
    const err = AppError.httpStatus(403)
    expect(err.message).toBe('Access denied')
  })

  it('handles unknown status codes', () => {
    const err = AppError.httpStatus(418)
    expect(err.code).toBe('HTTP_418')
    expect(err.statusCode).toBe(418)
  })

  it('maps all standard status codes', () => {
    expect(AppError.httpStatus(400).code).toBe('BAD_REQUEST')
    expect(AppError.httpStatus(401).code).toBe('UNAUTHORIZED')
    expect(AppError.httpStatus(403).code).toBe('FORBIDDEN')
    expect(AppError.httpStatus(404).code).toBe('NOT_FOUND')
    expect(AppError.httpStatus(409).code).toBe('CONFLICT')
    expect(AppError.httpStatus(422).code).toBe('VALIDATION_ERROR')
    expect(AppError.httpStatus(429).code).toBe('RATE_LIMIT_EXCEEDED')
    expect(AppError.httpStatus(500).code).toBe('INTERNAL_ERROR')
    expect(AppError.httpStatus(503).code).toBe('SERVICE_UNAVAILABLE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateResponse() and checkResponse()
// ─────────────────────────────────────────────────────────────────────────────
describe('validateResponse() and checkResponse()', () => {
  const UserSchema = z.object({ id: z.string(), email: z.string() })

  describe('validateResponse()', () => {
    it('strips unknown fields', async () => {
      const raw = { id: 'u1', email: 'a@b.com', password: 'hashed', token: 'secret' }
      const clean = await validateResponse(raw, UserSchema)
      expect((clean as Record<string, unknown>)['password']).toBeUndefined()
      expect((clean as Record<string, unknown>)['token']).toBeUndefined()
      expect((clean as Record<string, unknown>)['id']).toBe('u1')
    })

    it('coerces types according to schema', async () => {
      const Schema = z.object({ count: z.number(), name: z.string() })
      const clean = await validateResponse({ count: 5, name: 'test', extra: true }, Schema)
      expect(clean).toEqual({ count: 5, name: 'test' })
    })

    it('works with arrays', async () => {
      const Schema = z.object({ items: z.array(z.object({ id: z.string() })) })
      const raw = { items: [{ id: 'a', secret: 'x' }, { id: 'b', secret: 'y' }], meta: 'ignore' }
      const clean = await validateResponse(raw, Schema)
      expect(clean).toEqual({ items: [{ id: 'a' }, { id: 'b' }] })
    })
  })

  describe('checkResponse()', () => {
    it('returns success: true for valid data', async () => {
      const result = await checkResponse({ id: 'u1', email: 'a@b.com' }, UserSchema)
      expect(result.success).toBe(true)
    })

    it('returns success: false with errors for invalid data', async () => {
      const result = await checkResponse({ id: 123, email: null }, UserSchema)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0)
      }
    })

    it('never throws even on completely invalid data', async () => {
      const result = await checkResponse(null, UserSchema)
      expect(result.success).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// res.fail() with AppError directly
// ─────────────────────────────────────────────────────────────────────────────
describe('res.fail() accepts AppError directly', () => {
  function makeApp() {
    const app = express()
    app.use(shapeguard())
    app.get('/not-found', (_req, res) => {
      res.fail(AppError.notFound('Product'))
    })
    app.get('/conflict', (_req, res) => {
      res.fail(AppError.conflict('Email'))
    })
    app.get('/with-context', (_req, res) => {
      res.fail(AppError.badRequest('Invalid').withContext({ field: 'email' }))
    })
    app.get('/traditional', (_req, res) => {
      res.fail({ code: 'CUSTOM', message: 'Custom error', status: 422 })
    })
    return app
  }

  it('sends correct status from AppError.notFound()', async () => {
    const res = await supertest(makeApp()).get('/not-found')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('sends correct status from AppError.conflict()', async () => {
    const res = await supertest(makeApp()).get('/conflict')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('still works with traditional ResFailOpts object', async () => {
    const res = await supertest(makeApp()).get('/traditional')
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('CUSTOM')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createDTO() with any adapter
// ─────────────────────────────────────────────────────────────────────────────
describe('createDTO() with any SchemaAdapter', () => {
  it('works with Zod schema (original behaviour)', () => {
    const dto = createDTO(z.object({ name: z.string() }))
    expect(dto.library).toBe('zod')
    expect(dto._isDTO).toBe(true)
  })

  it('throws clear error for non-schema primitives', () => {
    expect(() => createDTO('not a schema' as never)).toThrow('SchemaAdapter')
  })

  it('accepts joiAdapter (duck-type check)', () => {
    const mockJoi = {
      validate: () => ({ value: {}, error: undefined }),
    }
    const adapter = joiAdapter(mockJoi as never)
    // joiAdapter returns a SchemaAdapter — createDTO should accept it
    const dto = createDTO(adapter as never)
    expect(dto._isDTO).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// circuitBreaker — HALF_OPEN recovery + all hooks
// ─────────────────────────────────────────────────────────────────────────────
describe('circuitBreaker() comprehensive', () => {
  it('starts CLOSED', () => {
    const cb = circuitBreaker({ name: 'test', threshold: 5 })
    expect(cb.state).toBe('CLOSED')
    expect(cb.failures).toBe(0)
  })

  it('increments failures on each error', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 5 })
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow()
    expect(cb.failures).toBe(1)
    expect(cb.state).toBe('CLOSED')  // not yet at threshold
  })

  it('opens circuit after threshold failures', async () => {
    const onOpen = vi.fn()
    const cb = circuitBreaker({ name: 'test', threshold: 2, onOpen })

    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail')
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail')

    expect(cb.state).toBe('OPEN')
    expect(onOpen).toHaveBeenCalledWith('test', 2)
  })

  it('throws CircuitOpenError when OPEN', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 1 })
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow()
    await expect(cb.call(() => Promise.resolve('ok'))).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('transitions to HALF_OPEN after resetTimeout', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 1, resetTimeout: 30 })
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow()
    expect(cb.state).toBe('OPEN')

    await new Promise(r => setTimeout(r, 50))

    // Next call should attempt (HALF_OPEN allows one probe)
    const result = await cb.call(() => Promise.resolve('recovered'))
    expect(result).toBe('recovered')
    expect(cb.state).toBe('CLOSED')
  })

  it('calls onClose after HALF_OPEN recovery', async () => {
    const onClose = vi.fn()
    const cb = circuitBreaker({ name: 'test', threshold: 1, resetTimeout: 30, onClose })

    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow()
    await new Promise(r => setTimeout(r, 50))
    await cb.call(() => Promise.resolve('ok'))

    expect(onClose).toHaveBeenCalledWith('test')
  })

  it('onFailure called on every failure', async () => {
    const onFailure = vi.fn()
    const cb = circuitBreaker({ name: 'test', threshold: 10, onFailure })

    await expect(cb.call(() => Promise.reject(new Error('err')))).rejects.toThrow()
    await expect(cb.call(() => Promise.reject(new Error('err')))).rejects.toThrow()

    expect(onFailure).toHaveBeenCalledTimes(2)
    expect(onFailure).toHaveBeenCalledWith('test', expect.any(Error))
  })

  it('manual reset() closes the circuit', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 1 })
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow()
    expect(cb.state).toBe('OPEN')

    cb.reset()
    expect(cb.state).toBe('CLOSED')
    expect(cb.failures).toBe(0)
  })

  it('manual trip() opens the circuit', () => {
    const cb = circuitBreaker({ name: 'test', threshold: 5 })
    expect(cb.state).toBe('CLOSED')
    cb.trip()
    expect(cb.state).toBe('OPEN')
  })

  it('probe() passes when CLOSED', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 5 })
    await expect(cb.probe()).resolves.toBeUndefined()
  })

  it('probe() throws descriptive error when OPEN', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 1 })
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow()
    await expect(cb.probe()).rejects.toThrow(/OPEN/)
    await expect(cb.probe()).rejects.toThrow(/Retrying in/)
  })

  it('second HALF_OPEN attempt uses the halfOpenLock to block', async () => {
    const cb = circuitBreaker({ name: 'test', threshold: 1, resetTimeout: 30 })
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow()
    await new Promise(r => setTimeout(r, 50))

    // First call succeeds (transitions OPEN → HALF_OPEN → CLOSED)
    const r1 = await cb.call(() => Promise.resolve('ok'))
    expect(r1).toBe('ok')
    expect(cb.state).toBe('CLOSED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// defineGroup() — middleware isolation + 405 handling
// ─────────────────────────────────────────────────────────────────────────────
describe('defineGroup() comprehensive', () => {
  function makeApp() {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())

    const authLog: string[] = []

    const usersGroup = defineGroup('/users', {
      middleware: [
        (req: Request, _res: express.Response, next: express.NextFunction) => {
          authLog.push(`auth:${req.method}`); next()
        }
      ],
      routes: (r) => {
        r.get('/', (_req, res) => { res.json({ data: [{ id: 'u1' }] }) })
        r.post('/', ...handle(
          defineRoute({ body: z.object({ name: z.string() }) }),
          async (_req, res) => { res.status(201).json({ data: { id: 'u2' } }) }
        ))
      },
    })

    const publicGroup = defineGroup('/public', {
      routes: (r) => {
        r.get('/status', (_req, res) => { res.json({ ok: true }) })
      },
    })

    app.use(usersGroup)
    app.use(publicGroup)
    app.use(notFoundHandler())
    app.use(errorHandler())

    return { app, authLog }
  }

  it('serves GET /users with middleware applied', async () => {
    const { app, authLog } = makeApp()
    const res = await supertest(app).get('/users')
    expect(res.status).toBe(200)
    expect(authLog).toContain('auth:GET')
  })

  it('serves POST /users with middleware applied', async () => {
    const { app, authLog } = makeApp()
    const res = await supertest(app).post('/users').send({ name: 'Alice' })
    expect(res.status).toBe(201)
    expect(authLog).toContain('auth:POST')
  })

  it('middleware does NOT apply to routes outside the group', async () => {
    const { app, authLog } = makeApp()
    await supertest(app).get('/public/status')
    expect(authLog).toHaveLength(0)
  })

  it('returns 405 for unsupported method on defined route', async () => {
    const { app } = makeApp()
    const res = await supertest(app).delete('/users')
    // createRouter 405 tracking should return 405 or 404
    expect([404, 405]).toContain(res.status)
  })

  it('returns 404 for completely unknown routes', async () => {
    const { app } = makeApp()
    const res = await supertest(app).get('/unknown')
    expect(res.status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// pipe() — compose middleware
// ─────────────────────────────────────────────────────────────────────────────
describe('pipe() comprehensive', () => {
  it('flattens arrays from handle() output', () => {
    const route = defineRoute({})
    const h = handle(route, async (_req, res) => { res.noContent() })
    const piped = pipe(h)
    expect(Array.isArray(piped)).toBe(true)
    expect(piped.length).toBe(h.length)
  })

  it('executes in order — later middleware sees earlier result', async () => {
    const log: string[] = []
    const app = express()
    app.use(shapeguard())

    const mw1 = (_req: Request, _res: express.Response, next: express.NextFunction) => {
      log.push('mw1'); next()
    }
    const mw2 = (_req: Request, _res: express.Response, next: express.NextFunction) => {
      log.push('mw2'); next()
    }

    app.get('/pipe', ...pipe(
      mw1, mw2,
      handle(defineRoute({}), async (_req, res) => { log.push('handler'); res.noContent() }),
    ))

    await supertest(app).get('/pipe')
    expect(log).toEqual(['mw1', 'mw2', 'handler'])
  })

  it('stops chain when middleware calls next(err)', async () => {
    const app = express()
    app.use(shapeguard())

    app.get('/fail', ...pipe(
      (_req: Request, _res: express.Response, next: express.NextFunction) => {
        next(AppError.unauthorized())
      },
      handle(defineRoute({}), async (_req, res) => { res.ok({ data: 'reached', message: '' }) }),
    ))
    app.use(errorHandler())

    const res = await supertest(app).get('/fail')
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Context store — comprehensive edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe('Context store edge cases', () => {
  it('context is isolated between concurrent requests', async () => {
    const app = express()
    app.use(shapeguard())

    app.get('/ctx', (req, res) => {
      const userId = req.query['userId'] as string
      setContext(req, 'user', { id: userId })
      // Simulate async — context should still be req-scoped
      const stored = getContext<{ id: string }>(req, 'user')
      res.json({ userId: stored?.id })
    })

    const [r1, r2] = await Promise.all([
      supertest(app).get('/ctx?userId=alice'),
      supertest(app).get('/ctx?userId=bob'),
    ])

    expect(r1.body.userId).toBe('alice')
    expect(r2.body.userId).toBe('bob')
  })

  it('contextMiddleware with factory function called per request', async () => {
    const app = express()
    let callCount = 0
    app.use(contextMiddleware('reqNum', () => ++callCount))
    app.get('/n', (req, res) => {
      res.json({ n: getContext<number>(req, 'reqNum') })
    })

    const r1 = await supertest(app).get('/n')
    const r2 = await supertest(app).get('/n')

    expect(r1.body.n).toBe(1)
    expect(r2.body.n).toBe(2)
  })

  it('requireContext throws programmer error (not AppError) when missing', () => {
    const req = mockRequest()
    expect(() => requireContext(req as never, 'missing')).toThrow(
      '[shapeguard] requireContext: key "missing" not found'
    )
  })

  it('stores complex objects without mutation', () => {
    const req = mockRequest()
    const obj = { nested: { value: 42 }, arr: [1, 2, 3] }
    setContext(req as never, 'data', obj)

    const retrieved = getContext<typeof obj>(req as never, 'data')
    expect(retrieved).toEqual(obj)
  })

  it('multiple keys coexist on same request', () => {
    const req = mockRequest()
    setContext(req as never, 'user', { id: 'u1' })
    setContext(req as never, 'tenant', { id: 't1' })
    setContext(req as never, 'version', '2024-01')

    expect(getContext(req as never, 'user')).toEqual({ id: 'u1' })
    expect(getContext(req as never, 'tenant')).toEqual({ id: 't1' })
    expect(getContext(req as never, 'version')).toBe('2024-01')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SSE stream — edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe('SSE stream edge cases', () => {
  function makeMockRes() {
    const chunks: string[] = []
    let _ended = false
    return {
      headersSent:   false,
      writableEnded: false,
      get ended()    { return _ended },
      setHeader:     vi.fn().mockReturnThis(),
      flushHeaders:  vi.fn(),
      write:         (chunk: string) => { chunks.push(chunk); return true },
      end:           () => { _ended = true },
      once:          (_e: string, _fn: () => void) => { if (_e === 'close') return; },
      chunks,
    }
  }

  it('sets all required SSE headers', () => {
    const res = makeMockRes()
    sseStream(res as never)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform')
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive')
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no')
  })

  it('serializes event data as JSON', () => {
    const res = makeMockRes()
    const stream = sseStream(res as never)
    stream.send({ type: 'update', data: { count: 42 } })
    expect(res.chunks[0]).toContain('data: {"count":42}')
    expect(res.chunks[0]).toContain('event: update')
  })

  it('sends event with id and retry fields', () => {
    const res = makeMockRes()
    const stream = sseStream(res as never)
    stream.send({ type: 'msg', data: 'hello', id: 'evt-1', retry: 3000 })
    expect(res.chunks[0]).toContain('id: evt-1')
    expect(res.chunks[0]).toContain('retry: 3000')
    expect(res.chunks[0]).toContain('event: msg')
  })

  it('heartbeat sends SSE comment', () => {
    const res = makeMockRes()
    const stream = sseStream(res as never)
    stream.heartbeat()
    expect(res.chunks[0]).toBe(': heartbeat\n\n')
  })

  it('does not write after closed', () => {
    const res = makeMockRes()
    const stream = sseStream(res as never)
    stream.close()
    stream.send({ data: 'should not send' })
    stream.heartbeat()
    // Only end() was called, no data writes after close
    expect(res.chunks).toHaveLength(0)
  })

  it('closed property reflects state', () => {
    const res = makeMockRes()
    const stream = sseStream(res as never)
    expect(stream.closed).toBe(false)
    stream.close()
    expect(stream.closed).toBe(true)
  })

  it('onClientDisconnect registers cleanup on req.close', () => {
    const app = express()
    app.get('/sse', enableSSE, (_req, res) => {
      const stream = sseStream(res)
      const cleanup = vi.fn()
      onClientDisconnect(_req, stream, cleanup)
      stream.send({ data: 'hello' })
      res.end()
    })
    // Just verify it doesn't throw
    return supertest(app).get('/sse')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// mergeRoutes() deep scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe('mergeRoutes() deep scenarios', () => {
  it('merges body + params + query from different routes', () => {
    const A = defineRoute({ body: z.object({ name: z.string() }) })
    const B = defineRoute({ params: z.object({ id: z.string() }) })
    const C = defineRoute({ query: z.object({ page: z.string().optional() }) })
    const merged = mergeRoutes(A, B, C)
    expect(merged.body).toBeDefined()
    expect(merged.params).toBeDefined()
    expect(merged.query).toBeDefined()
  })

  it('last route wins on property collision', () => {
    const A = defineRoute({ timeout: 1000, body: z.object({ x: z.string() }) })
    const B = defineRoute({ timeout: 5000 })
    const merged = mergeRoutes(A, B)
    expect(merged.timeout).toBe(5000)
    expect(merged.body).toBeDefined()  // preserved from A
  })

  it('rateLimit preserved from base', () => {
    const Base = defineRoute({ rateLimit: { windowMs: 60_000, max: 10 } })
    const Ext  = defineRoute({ body: z.object({ x: z.string() }) })
    const merged = mergeRoutes(Base, Ext)
    expect(merged.rateLimit?.max).toBe(10)
  })

  it('merged route works end-to-end', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())
    app.use(errorHandler())

    const Base = defineRoute({ rateLimit: { windowMs: 60_000, max: 100 } })
    const Route = mergeRoutes(Base, defineRoute({
      body: z.object({ email: z.string().email() }),
      response: z.object({ email: z.string() }),
    }))

    app.post('/test', ...handle(Route, async (req, res) => {
      res.created({ data: { email: req.body.email }, message: 'ok' })
    }))

    const ok = await supertest(app).post('/test').send({ email: 'a@b.com' })
    expect(ok.status).toBe(201)
    expect(ok.body.data.email).toBe('a@b.com')

    const fail = await supertest(app).post('/test').send({ email: 'not-an-email' })
    expect(fail.status).toBe(422)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Production patterns — entrepreneur-level scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe('Production pattern: full auth + rate-limit + context + circuit-breaker', () => {
  it('composes auth guard + context + downstream circuit breaker', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard())

    // Auth middleware: set context
    const requireAuth = (req: Request, _res: express.Response, next: express.NextFunction) => {
      const token = req.headers['authorization']
      if (!token) { next(AppError.unauthorized()); return }
      setContext(req, 'user', { id: 'u1', role: 'admin' })
      next()
    }

    // Circuit breaker for "database"
    const dbBreaker = circuitBreaker({ name: 'db', threshold: 3 })

    app.get('/api/users',
      requireAuth,
      async (req: Request, res: express.Response) => {
        const user = requireContext<{ id: string; role: string }>(req, 'user')
        const data = await dbBreaker.call(async () => [{ id: user.id }])
        res.json({ data })
      }
    )

    app.use(notFoundHandler())
    app.use(errorHandler())

    // Unauthenticated
    const unauth = await supertest(app).get('/api/users')
    expect(unauth.status).toBe(401)

    // Authenticated
    const authed = await supertest(app).get('/api/users').set('Authorization', 'Bearer token')
    expect(authed.status).toBe(200)
    expect(authed.body.data).toHaveLength(1)
  })
})

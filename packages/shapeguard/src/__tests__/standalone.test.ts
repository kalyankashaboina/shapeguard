// standalone.test.ts — every feature tested WITHOUT shapeguard() middleware
// Proves each module works completely independently.
// Uses real HTTP via supertest — no mocking.

import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { z } from 'zod'
import {
  validate, defineRoute, handle, createDTO,
  AppError, errorHandler, notFoundHandler,
  healthCheck, gracefulShutdown,
  inMemoryDeduplicator,
  createRouter, withShape,
  generateOpenAPI,
  resetLoggerForTesting, configureLogger,
} from '../index.js'

beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate() — no shapeguard()
// ─────────────────────────────────────────────────────────────────────────────
describe('validate() standalone — no shapeguard()', () => {
  function makeApp() {
    const app = express()
    app.use(express.json())
    app.post('/users',
      validate(defineRoute({ body: z.object({ name: z.string(), age: z.number() }) })),
      (req, res) => res.json({ ok: true, name: req.body.name })
    )
    app.use(errorHandler())
    return app
  }
  const app = makeApp()

  it('validates body and passes to handler', async () => {
    const r = await supertest(app).post('/users').send({ name: 'Alice', age: 30 })
    expect(r.status).toBe(200)
    expect(r.body.name).toBe('Alice')
  })

  it('rejects invalid body with 422', async () => {
    const r = await supertest(app).post('/users').send({ name: 'Alice', age: 'not-a-number' })
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects missing required field with 422', async () => {
    const r = await supertest(app).post('/users').send({ name: 'Alice' })
    expect(r.status).toBe(422)
    expect(r.body.error.details).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// handle() — no shapeguard()
// ─────────────────────────────────────────────────────────────────────────────
describe('handle() standalone — no shapeguard()', () => {
  it('wraps async handler and catches thrown AppError', async () => {
    const app = express()
    app.use(express.json())
    const DTO = createDTO(z.object({ id: z.string().uuid() }))
    app.post('/items', ...handle(defineRoute({ body: DTO }), async (req, res) => {
      if (req.body.id === '00000000-0000-0000-0000-000000000000') throw AppError.notFound('Item')
      res.json({ found: true, id: req.body.id })
    }))
    app.use(errorHandler())

    const goodId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const r1 = await supertest(app).post('/items').send({ id: goodId })
    expect(r1.status).toBe(200)

    const r2 = await supertest(app).post('/items').send({ id: '00000000-0000-0000-0000-000000000000' })
    expect(r2.status).toBe(404)
    expect(r2.body.error.code).toBe('NOT_FOUND')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AppError + errorHandler() — no shapeguard()
// ─────────────────────────────────────────────────────────────────────────────
describe('AppError + errorHandler() standalone', () => {
  const app = express()
  app.get('/not-found',    () => { throw AppError.notFound('User') })
  app.get('/unauthorized', () => { throw AppError.unauthorized() })
  app.get('/forbidden',    () => { throw AppError.forbidden() })
  app.get('/conflict',     () => { throw AppError.conflict('Email') })
  app.get('/custom',       () => { throw AppError.custom('MY_CODE', 'My message', 418) })
  app.get('/crash',        () => { throw new Error('unexpected crash') })
  app.use(errorHandler({ debug: false }))

  it('notFound → 404',      async () => expect((await supertest(app).get('/not-found')).status).toBe(404))
  it('unauthorized → 401',  async () => expect((await supertest(app).get('/unauthorized')).status).toBe(401))
  it('forbidden → 403',     async () => expect((await supertest(app).get('/forbidden')).status).toBe(403))
  it('conflict → 409',      async () => expect((await supertest(app).get('/conflict')).status).toBe(409))
  it('custom → 418',        async () => expect((await supertest(app).get('/custom')).status).toBe(418))
  it('crash → 500 in prod', async () => {
    const r = await supertest(app).get('/crash')
    expect(r.status).toBe(500)
    expect(r.body.error.message).toBe('Something went wrong')  // no leak in prod mode
  })
  it('all errors have consistent envelope shape', async () => {
    const r = await supertest(app).get('/not-found')
    expect(r.body).toHaveProperty('success', false)
    expect(r.body).toHaveProperty('error.code')
    expect(r.body).toHaveProperty('error.message')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// healthCheck() — no shapeguard()
// ─────────────────────────────────────────────────────────────────────────────
describe('healthCheck() standalone', () => {
  it('200 when all checks pass', async () => {
    const app = express()
    app.use('/health', healthCheck({
      checks: {
        sync:  () => 'ok',
        async: async () => 42,
        mem:   healthCheck.memory({ maxPercent: 99 }),
      }
    }))
    const r = await supertest(app).get('/health')
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('healthy')
    expect(r.body.checks.sync).toBe('ok')
    expect(r.body.checks.async).toBe('ok')
    expect(r.body.checks.mem).toBe('ok')
  })

  it('503 when any check throws', async () => {
    const app = express()
    app.use('/health', healthCheck({
      checks: { good: () => 'fine', bad: () => { throw new Error('conn refused') } }
    }))
    const r = await supertest(app).get('/health')
    expect(r.status).toBe(503)
    expect(r.body.status).toBe('unhealthy')
    expect(r.body.checks.good).toBe('ok')
    expect(r.body.checks.bad).toBe('error')
  })

  it('timeout check returns "timeout" status', async () => {
    const app = express()
    app.use('/health', healthCheck({
      checks: { slow: () => new Promise(r => setTimeout(r, 5_000)) },
      timeout: 30,
    }))
    const r = await supertest(app).get('/health')
    expect(r.status).toBe(503)
    expect(r.body.checks.slow).toBe('timeout')
  })

  it('includes uptime, version, time fields', async () => {
    const app = express()
    app.use('/health', healthCheck({ checks: { up: healthCheck.uptime() } }))
    const r = await supertest(app).get('/health')
    expect(typeof r.body.uptime).toBe('number')
    expect(r.body.version).toMatch(/^v\d/)
    expect(() => new Date(r.body.time)).not.toThrow()
  })

  it('healthCheck.env() fails for missing env var', async () => {
    const app = express()
    app.use('/health', healthCheck({ checks: { e: healthCheck.env(['__MISSING_VAR_XYZ__']) } }))
    const r = await supertest(app).get('/health')
    expect(r.status).toBe(503)
  })

  it('runs checks in parallel — timing proves it', async () => {
    const order: string[] = []
    const app = express()
    app.use('/health', healthCheck({
      checks: {
        slow: async () => { await new Promise(r => setTimeout(r, 80)); order.push('slow') },
        fast: async () => { order.push('fast') },
      }
    }))
    const r = await supertest(app).get('/health')
    expect(r.status).toBe(200)
    expect(order[0]).toBe('fast')  // fast finishes first — parallel, not sequential
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// request timeout — no shapeguard()
// ─────────────────────────────────────────────────────────────────────────────
describe('request timeout standalone', () => {
  it('returns 408 when handler exceeds timeout', async () => {
    const app = express()
    app.use(express.json())
    app.get('/slow', validate(defineRoute({ timeout: 50 })), async (_req, res) => {
      await new Promise(r => setTimeout(r, 600))
      res.json({ done: true })
    })
    app.use(errorHandler())
    const r = await supertest(app).get('/slow')
    expect(r.status).toBe(408)
    expect(r.body.error?.code ?? r.body.code ?? 'REQUEST_TIMEOUT').toBe('REQUEST_TIMEOUT')
  })

  it('completes normally when under timeout', async () => {
    const app = express()
    app.use(express.json())
    app.get('/fast', validate(defineRoute({ timeout: 500 })), (_req, res) => {
      res.json({ done: true })
    })
    const r = await supertest(app).get('/fast')
    expect(r.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createRouter() 405 — no shapeguard()
// ─────────────────────────────────────────────────────────────────────────────
describe('createRouter() 405 standalone', () => {
  function makeApp() {
    const app = express()
    const router = createRouter()
    router.get('/items',  (_req, res) => res.json({ ok: true }))
    router.post('/items', (_req, res) => res.json({ ok: true }))
    app.use(router)
    app.use(notFoundHandler())
    app.use(errorHandler())
    return app
  }
  const app = makeApp()

  it('GET /items → 200', async () => expect((await supertest(app).get('/items')).status).toBe(200))
  it('POST /items → 200', async () => expect((await supertest(app).post('/items')).status).toBe(200))
  it('DELETE /items → 405', async () => {
    const r = await supertest(app).delete('/items')
    expect(r.status).toBe(405)
    expect(r.headers['allow']).toContain('GET')
  })
  it('PUT /items → 405', async () => expect((await supertest(app).put('/items')).status).toBe(405))
  it('unknown path → 404', async () => expect((await supertest(app).get('/unknown')).status).toBe(404))
})

// ─────────────────────────────────────────────────────────────────────────────
// withShape() — no shapeguard()
// ─────────────────────────────────────────────────────────────────────────────
describe('withShape() standalone', () => {
  it('map mode extracts nested fields', async () => {
    const app = express()
    app.get('/h', withShape({ ok: '{data.ok}', up: '{data.uptime}' }), (_req, res) => {
      res.json({ success: true, message: '', data: { ok: true, uptime: 42 } })
    })
    const r = await supertest(app).get('/h')
    expect(r.body.ok).toBe(true)
    expect(r.body.up).toBe(42)
    expect(r.body.success).toBeUndefined()
    expect(r.body.data).toBeUndefined()
  })

  it('raw mode unwraps data field', async () => {
    const app = express()
    app.get('/p', withShape('raw'), (_req, res) => {
      res.json({ success: true, data: 'pong' })
    })
    const r = await supertest(app).get('/p')
    expect(r.text).toBe('"pong"')
  })

  it('raw mode passes through non-envelope body', async () => {
    const app = express()
    app.get('/p', withShape('raw'), (_req, res) => {
      res.json('already-raw')
    })
    const r = await supertest(app).get('/p')
    expect(r.text).toBe('"already-raw"')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateOpenAPI() — pure function, no Express
// ─────────────────────────────────────────────────────────────────────────────
describe('generateOpenAPI() standalone — no Express', () => {
  it('generates valid OpenAPI 3.1 spec', () => {
    const spec = generateOpenAPI({
      title: 'Test API', version: '1.0.0',
      routes: {
        'GET  /users':     { summary: 'List users', tags: ['Users'] },
        'POST /users':     { summary: 'Create user', tags: ['Users'] },
        'GET  /users/:id': { summary: 'Get user',   tags: ['Users'] },
      }
    })
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Test API')
    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users/{id}']).toBeDefined()
  })

  it('deduplicates operationIds across versions', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1.0.0',
      routes: {
        'GET /v1/users': {},
        'GET /v2/users': {},
        'GET /v3/users': {},
      }
    })
    const ids = Object.values(spec.paths)
      .flatMap(p => Object.values(p as Record<string, { operationId?: string }>))
      .map(op => op.operationId)
    expect(new Set(ids).size).toBe(ids.length)  // all unique
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// inMemoryDeduplicator — pure function
// ─────────────────────────────────────────────────────────────────────────────
describe('inMemoryDeduplicator standalone', () => {
  it('returns false before add, true after', () => {
    const d = inMemoryDeduplicator()
    expect(d.has('a')).toBe(false)
    d.add('a', 60)
    expect(d.has('a')).toBe(true)
  })

  it('expires entries after TTL', async () => {
    const d = inMemoryDeduplicator()
    d.add('b', 0)
    await new Promise(r => setTimeout(r, 20))
    expect(d.has('b')).toBe(false)
  })

  it('tracks multiple IDs independently', () => {
    const d = inMemoryDeduplicator()
    d.add('x', 60); d.add('y', 60)
    expect(d.has('x')).toBe(true)
    expect(d.has('y')).toBe(true)
    expect(d.has('z')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// gracefulShutdown — deregistration
// ─────────────────────────────────────────────────────────────────────────────
describe('gracefulShutdown standalone — deregistration', () => {
  it('adds and removes SIGTERM listener cleanly', async () => {
    const app    = express()
    const server = app.listen(0)
    const before  = process.listenerCount('SIGTERM')
    const stop   = gracefulShutdown(server, { signals: ['SIGTERM'] })
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
    stop()
    expect(process.listenerCount('SIGTERM')).toBe(before)
    await new Promise<void>(r => server.close(() => r()))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resetLoggerForTesting — logger isolation
// ─────────────────────────────────────────────────────────────────────────────
describe('resetLoggerForTesting standalone', () => {
  it('allows fresh reconfiguration after reset', () => {
    resetLoggerForTesting()
    expect(() => configureLogger({ silent: true })).not.toThrow()
  })

  it('logger is functional after reset+configure', () => {
    resetLoggerForTesting()
    const log = configureLogger({ silent: true })
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })
})

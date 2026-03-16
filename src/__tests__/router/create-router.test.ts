// src/__tests__/router/create-router.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRouter } from '../../router/create-router.js'
import type { Request, Response, NextFunction } from 'express'

function makeReq(method: string, path: string): Request {
  return { method, path } as unknown as Request
}

function makeRes() {
  const headers: Record<string, string> = {}
  return {
    headersSent: false,
    status(_c: number) { return this },
    json(_b: unknown)  { return this },
    setHeader(k: string, v: string) { headers[k] = v },
    get _headers() { return headers },
  } as any
}

// Find the 405-catch use-layer in the router stack.
// It's the layer registered by router.use() with no route — find it by
// checking layer.route === undefined and the handle function name.
function find405Handler(router: any): ((req: any, res: any, next: any) => void) | null {
  const stack: any[] = router.stack
  for (const layer of stack) {
    // use-type layers have no .route property
    if (!layer.route && typeof layer.handle === 'function') {
      // Confirm it's ours by checking it calls next with an AppError
      return layer.handle
    }
  }
  return null
}

describe('createRouter', () => {
  it('is a drop-in for express.Router — has .get .post .use etc', () => {
    const router = createRouter()
    expect(typeof router.get).toBe('function')
    expect(typeof router.post).toBe('function')
    expect(typeof router.use).toBe('function')
    expect(typeof router.put).toBe('function')
    expect(typeof router.delete).toBe('function')
  })

  it('returns a router with handle method (is an Express router)', () => {
    const router = createRouter()
    expect(typeof router.handle).toBe('function')
  })

  describe('405 Method Not Allowed', () => {
    it('triggers 405 when path is registered but method is not', () => {
      const router = createRouter()
      router.get('/users', vi.fn())

      const handler = find405Handler(router)
      expect(handler).not.toBeNull()

      const next = vi.fn()
      handler!(makeReq('POST', '/users'), makeRes(), next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        code: 'METHOD_NOT_ALLOWED',
      }))
    })

    it('sends 405 with correct statusCode', () => {
      const router = createRouter()
      router.get('/items', vi.fn())
      router.post('/items', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('DELETE', '/items'), makeRes(), next)

      const err = next.mock.calls[0]?.[0]
      expect(err?.code).toBe('METHOD_NOT_ALLOWED')
      expect(err?.statusCode).toBe(405)
    })

    it('includes allowed methods in error details', () => {
      const router = createRouter()
      router.get('/items', vi.fn())
      router.post('/items', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('DELETE', '/items'), makeRes(), next)

      const err = next.mock.calls[0]?.[0]
      expect(err?.details?.allowed).toContain('GET')
      expect(err?.details?.allowed).toContain('POST')
    })

    it('passes through for completely unregistered paths (no 405, let notFoundHandler handle)', () => {
      const router = createRouter()
      router.get('/users', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('GET', '/completely-unknown'), makeRes(), next)

      // next() called with no error argument
      expect(next).toHaveBeenCalledWith()
    })

    it('does not 405 when method IS registered', () => {
      const router = createRouter()
      router.get('/users/:id', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('GET', '/users/123'), makeRes(), next)

      // next() called without error
      expect(next).toHaveBeenCalledWith()
    })

    it('matches parameterized routes — /users/:id matches /users/123', () => {
      const router = createRouter()
      router.get('/users/:id', vi.fn())
      router.put('/users/:id', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('DELETE', '/users/123'), makeRes(), next)

      const err = next.mock.calls[0]?.[0]
      expect(err?.code).toBe('METHOD_NOT_ALLOWED')
    })

    it('matches parameterized routes — slug-style IDs like /users/abc-def-ghi', () => {
      const router = createRouter()
      router.get('/users/:id', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('POST', '/users/abc-def-ghi'), makeRes(), next)

      const err = next.mock.calls[0]?.[0]
      expect(err?.code).toBe('METHOD_NOT_ALLOWED')
    })

    it('matches parameterized routes — UUID IDs', () => {
      const router = createRouter()
      router.get('/items/:id', vi.fn())
      router.delete('/items/:id', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('POST', '/items/550e8400-e29b-41d4-a716-446655440000'), makeRes(), next)

      const err = next.mock.calls[0]?.[0]
      expect(err?.code).toBe('METHOD_NOT_ALLOWED')
    })

    it('sets Allow header on response', () => {
      const router = createRouter()
      router.get('/things', vi.fn())
      router.post('/things', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      const res = makeRes()
      handler(makeReq('DELETE', '/things'), res, next)

      expect(res._headers['Allow']).toBeDefined()
    })
  })

  describe('normalizePath', () => {
    it('treats /users/ and /users as the same path', () => {
      const router = createRouter()
      router.get('/users', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('POST', '/users/'), makeRes(), next)

      const err = next.mock.calls[0]?.[0]
      expect(err?.code).toBe('METHOD_NOT_ALLOWED')
    })
  })

  describe('router isolation', () => {
    it('two routers do not share registeredMethods (closure isolation)', () => {
      const routerA = createRouter()
      const routerB = createRouter()

      routerA.get('/shared-path', vi.fn())
      // routerB has NOT registered /shared-path

      const handlerA = find405Handler(routerA)!
      const handlerB = find405Handler(routerB)!

      const nextA = vi.fn()
      const nextB = vi.fn()

      handlerA(makeReq('POST', '/shared-path'), makeRes(), nextA)
      handlerB(makeReq('POST', '/shared-path'), makeRes(), nextB)

      // A should 405 (POST not registered), B should pass through (path not known)
      expect(nextA.mock.calls[0]?.[0]?.code).toBe('METHOD_NOT_ALLOWED')
      expect(nextB.mock.calls[0]?.[0]).toBeUndefined()  // no error — unknown path
    })
  })

  describe('HEAD and OPTIONS tracking', () => {
    it('tracks HEAD method', () => {
      const router = createRouter()
      router.head('/ping', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      // GET on a HEAD-only path → 405
      handler(makeReq('GET', '/ping'), makeRes(), next)
      expect(next.mock.calls[0]?.[0]?.code).toBe('METHOD_NOT_ALLOWED')
    })

    it('tracks OPTIONS method', () => {
      const router = createRouter()
      router.options('/cors-path', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('GET', '/cors-path'), makeRes(), next)
      expect(next.mock.calls[0]?.[0]?.code).toBe('METHOD_NOT_ALLOWED')
    })
  })

  describe('nested paths', () => {
    it('matches /api/v1/users/:id', () => {
      const router = createRouter()
      router.get('/api/v1/users/:id', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      handler(makeReq('DELETE', '/api/v1/users/42'), makeRes(), next)
      expect(next.mock.calls[0]?.[0]?.code).toBe('METHOD_NOT_ALLOWED')
    })

    it('does not match /api/v1/users/:id when path is /api/v1/teams/42', () => {
      const router = createRouter()
      router.get('/api/v1/users/:id', vi.fn())

      const handler = find405Handler(router)!
      const next = vi.fn()
      // different resource — not a match → pass through
      handler(makeReq('DELETE', '/api/v1/teams/42'), makeRes(), next)
      expect(next.mock.calls[0]?.[0]).toBeUndefined()
    })
  })

})
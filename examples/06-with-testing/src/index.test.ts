// ─────────────────────────────────────────────────────────────────────────────
// examples/with-testing
// Shows how to unit-test controllers using shapeguard/testing.
// No HTTP, no supertest, no Express app needed.
//
// Run: npx vitest run src/index.test.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { mockRequest, mockResponse, mockNext } from 'shapeguard/testing'
import { AppError, handle, defineRoute, createDTO } from 'shapeguard'
import type { RequestHandler } from 'express'

// ── Test utility ──────────────────────────────────────────────────────────────
// asyncHandler wraps handlers in a sync Express-compatible function.
// In tests we need to properly await the inner promise. This helper does that.
async function callHandler(
  fn: RequestHandler,
  req: ReturnType<typeof mockRequest>,
  res: ReturnType<typeof mockResponse>,
  next: ReturnType<typeof mockNext>,
) {
  await new Promise<void>((resolve, reject) => {
    // Replace next with a version that always resolves the outer promise
    const wrappedNext = (...args: unknown[]) => {
      ;(next as Function)(...args)
      resolve()
    }
    const result = fn(req as any, res as any, wrappedNext as any)
    // If fn returned a promise (non-asyncHandler path), await it too
    if (result && typeof (result as any).then === 'function') {
      ;(result as any).then(resolve, reject)
    } else {
      // asyncHandler path: sync return, inner promise runs via microtask
      // flush microtasks so the inner promise settles
      setImmediate(resolve)
    }
  })
}

// ── Schema + route ────────────────────────────────────────────────────────────
const CreateUserDTO = createDTO(z.object({
  email: z.string().email(),
  name:  z.string().min(1),
}))

const CreateUserRoute = defineRoute({
  body: CreateUserDTO,
})

// ── Fake service ──────────────────────────────────────────────────────────────
const UserService = {
  create: vi.fn(),
  findById: vi.fn(),
}

// ── Controller ────────────────────────────────────────────────────────────────
const createUser = handle(CreateUserRoute, async (req, res) => {
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
})

const getUser = handle(
  defineRoute({ params: z.object({ id: z.string().uuid() }) }),
  async (req, res) => {
    const user = await UserService.findById(req.params.id)
    res.ok({ data: user, message: 'User found' })
  }
)

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('UserController — unit tests via shapeguard/testing', () => {

  beforeEach(() => vi.clearAllMocks())

  describe('createUser', () => {
    it('returns 201 with created user', async () => {
      const mockUser = { id: '1', email: 'alice@example.com', name: 'Alice' }
      UserService.create.mockResolvedValue(mockUser)

      const req  = mockRequest({ body: { email: 'alice@example.com', name: 'Alice' } })
      const res  = mockResponse()
      const next = mockNext()

      // handle() returns [validateMiddleware, handler]
      // Test the handler directly (index 1) — validation already tested separately
      await callHandler(createUser[1], req, res, next)

      expect(next.error).toBeUndefined()
      expect(res._result().statusCode).toBe(201)
      expect(res._result().body).toMatchObject({
        success: true,
        message: 'User created',
        data:    { email: 'alice@example.com' },
      })
    })

    it('forwards service errors to next', async () => {
      UserService.create.mockRejectedValue(AppError.conflict('Email'))

      const req  = mockRequest({ body: { email: 'exists@example.com', name: 'Alice' } })
      const res  = mockResponse()
      const next = mockNext()

      await callHandler(createUser[1], req, res, next)

      expect(next.called).toBe(true)
      expect(next.error).toBeInstanceOf(AppError)
      expect((next.error as AppError).statusCode).toBe(409)
      expect((next.error as AppError).code).toBe('CONFLICT')
    })
  })

  describe('getUser', () => {
    it('returns 200 with user when found', async () => {
      const mockUser = { id: 'abc', email: 'alice@example.com', name: 'Alice' }
      UserService.findById.mockResolvedValue(mockUser)

      const req  = mockRequest({ params: { id: 'abc' } })
      const res  = mockResponse()
      const next = mockNext()

      await callHandler(getUser[1], req, res, next)

      expect(res._result().statusCode).toBe(200)
      expect(res._result().body).toMatchObject({ success: true, data: { id: 'abc' } })
    })

    it('forwards 404 when user not found', async () => {
      UserService.findById.mockRejectedValue(AppError.notFound('User'))

      const req  = mockRequest({ params: { id: 'non-existent' } })
      const res  = mockResponse()
      const next = mockNext()

      await callHandler(getUser[1], req, res, next)

      expect(next.error).toBeInstanceOf(AppError)
      expect((next.error as AppError).statusCode).toBe(404)
    })
  })
})

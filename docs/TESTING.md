# Testing — shapeguard

> Unit-test your controllers without spinning up Express or making HTTP requests.
> Import from `shapeguard/testing`.

---

## Table of contents

- [Why test helpers?](#why)
- [mockRequest()](#mockrequest)
- [mockResponse()](#mockresponse)
- [mockNext()](#mocknext)
- [Full controller test example](#example)

---


## Why test helpers? <a name="why"></a>

Without helpers, testing a controller requires supertest + a full Express app:

```ts
// ❌ Before — needs full HTTP stack
const app = express()
app.use(shapeguard())
app.post('/users', ...createUser)
const res = await supertest(app).post('/users').send({ email: 'a@b.com' })
```

With helpers, you test the handler directly — no HTTP, no app setup:

```ts
// ✅ After — pure unit test
const req = mockRequest({ body: { email: 'a@b.com', name: 'Alice' } })
const res = mockResponse()
await UserController.createUser[1](req, res, mockNext())
expect(res._result().statusCode).toBe(201)
```

---

## mockRequest() <a name="mockrequest"></a>

Creates a mock Express Request.

```ts
import { mockRequest } from 'shapeguard/testing'

// Basic
const req = mockRequest()

// With body
const req = mockRequest({
  body: { email: 'alice@example.com', name: 'Alice' },
})

// With params, query, headers
const req = mockRequest({
  params:  { id: '550e8400-e29b-41d4-a716-446655440000' },
  query:   { page: '1', limit: '20' },
  headers: { authorization: 'Bearer token123' },
  method:  'GET',
  path:    '/api/users/550e...',
})
```

---

## mockResponse() <a name="mockresponse"></a>

Creates a mock Express Response that captures everything.

```ts
import { mockResponse } from 'shapeguard/testing'

const res = mockResponse()

// After calling your handler:
const { statusCode, body, headers, ended } = res._result()

expect(statusCode).toBe(201)
expect(body).toMatchObject({ success: true, data: { email: 'alice@example.com' } })
expect(headers['x-request-id']).toBeDefined()
```

All shapeguard `res.*` helpers work on mockResponse:

```ts
res.ok({ data: user, message: 'found' })
res.created({ data: user, message: 'created' })
res.accepted({ data: job, message: 'queued' })
res.noContent()
res.paginated({ data: users, total: 45, page: 1, limit: 20 })
res.fail({ code: 'INVALID_COUPON', message: 'Coupon expired' })
```

---

## mockNext() <a name="mocknext"></a>

Creates a mock NextFunction that tracks calls and errors.

```ts
import { mockNext } from 'shapeguard/testing'

const next = mockNext()

// After running middleware:
expect(next.called).toBe(true)   // next() was called
expect(next.error).toBeUndefined() // no error passed to next
```

If an error was thrown and caught:

```ts
expect(next.error).toBeInstanceOf(AppError)
expect((next.error as AppError).statusCode).toBe(404)
```

---

## Full controller test example <a name="example"></a>

```ts
// controllers/user.controller.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mockRequest, mockResponse, mockNext } from 'shapeguard/testing'
import { AppError } from 'shapeguard'
import { UserController } from './user.controller.js'
import { UserService } from '../services/user.service.js'

vi.mock('../services/user.service.js')

describe('UserController.createUser', () => {
  it('creates user and returns 201', async () => {
    const mockUser = { id: '1', email: 'alice@example.com', name: 'Alice', createdAt: new Date().toISOString() }
    vi.mocked(UserService.create).mockResolvedValue(mockUser)

    const req  = mockRequest({ body: { email: 'alice@example.com', name: 'Alice', password: 'hashed' } })
    const res  = mockResponse()
    const next = mockNext()

    // handle() returns [validateMiddleware, handler] — test the handler directly (index 1)
    await UserController.createUser[1](req, res, next)

    expect(next.error).toBeUndefined()
    expect(res._result().statusCode).toBe(201)
    expect(res._result().body).toMatchObject({
      success: true,
      message: 'User created',
      data: { email: 'alice@example.com' },
    })
  })

  it('forwards AppError to next when user not found', async () => {
    vi.mocked(UserService.findById).mockRejectedValue(AppError.notFound('User'))

    const req  = mockRequest({ params: { id: 'non-existent-id' } })
    const res  = mockResponse()
    const next = mockNext()

    await UserController.getUser[1](req, res, next)

    expect(next.called).toBe(true)
    expect(next.error).toBeInstanceOf(AppError)
    expect((next.error as AppError).statusCode).toBe(404)
  })
})
```

---

## Testing response stripping (async behaviour) <a name="testing-strip"></a>

`validate({ response: ... })` strips unknown fields from the response asynchronously.
When writing unit tests that assert on the exact response body after stripping,
you need to wait for the strip promise to resolve before reading `res.body`.

### The problem

```ts
const res = mockResponse()
await validate(GetUserRoute)(req, res, next)
await handler(req, res, next)

// ❌ WRONG — body may be read before the async strip finishes
expect(res.body).not.toHaveProperty('passwordHash')
```

### The fix — await a tick after calling the handler

```ts
const res = mockResponse()
await validate(GetUserRoute)(req, res, next)
await handler(req, res, next)

// ✅ CORRECT — flush the microtask queue so the strip .then() runs
await Promise.resolve()

expect(res.body).not.toHaveProperty('passwordHash')
expect(res.body).toMatchObject({ email: 'alice@example.com' })
```

### Why `await Promise.resolve()` works

`patchResponseStrip` calls `responseSchema.strip(data)` which returns a Promise.
After your handler calls `res.json(body)`, the strip runs in the next microtask.
`await Promise.resolve()` yields to the microtask queue, letting the `.then()` run
before your assertions execute.

### Integration tests (supertest)

In integration tests using `supertest`, this is handled automatically — the HTTP
response is not sent until the strip promise resolves, so `await request(app).get('/users/1')`
always returns the fully-stripped body. No extra `await` needed.

```ts
// ✅ Integration test — always sees post-strip body
const res = await request(app).get('/users/1')
expect(res.body.data).not.toHaveProperty('passwordHash')
```

### Note on `logResponseBody`

When `logResponseBody: true` is configured, the logger captures the body from
the inner `res.json` wrapper — which is called by the strip promise's `.then()`.
So logs always show the **post-strip** body (what the client actually received),
not the pre-strip body. This is correct behaviour, not a bug.

---

## Logger isolation between tests <a name="logger-isolation"></a>

The shapeguard logger is a module-level singleton. Without resetting it, test suites share
the same logger instance, which can cause unexpected log output in silent test runs.

```ts
import { resetLoggerForTesting, configureLogger } from 'shapeguard'

// In your vitest/jest setup file:
beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})
```

`resetLoggerForTesting()` clears the singleton instance. The next `configureLogger()` or first
`logger.info()` call creates a fresh instance with the new config.

---

## Testing healthCheck() <a name="health-check-testing"></a>

`healthCheck()` is a standard Express middleware — use `mockRequest` and test it directly:

```ts
import { healthCheck } from 'shapeguard'
import { mockRequest, mockResponse } from 'shapeguard/testing'

it('returns 200 when all checks pass', async () => {
  const middleware = healthCheck({
    checks: {
      db:  async () => { /* resolves */ },
      mem: healthCheck.memory({ maxPercent: 99 }),
    }
  })

  const req = mockRequest({ method: 'GET', path: '/health' })
  const res = mockResponse()
  await middleware(req as any, res as any)

  expect(res._result().statusCode).toBe(200)
  expect((res._result().body as any).status).toBe('healthy')
})

it('returns 503 when a check fails', async () => {
  const middleware = healthCheck({
    checks: {
      db: async () => { throw new Error('Connection refused') },
    }
  })

  const req = mockRequest({ method: 'GET', path: '/health' })
  const res = mockResponse()
  await middleware(req as any, res as any)

  expect(res._result().statusCode).toBe(503)
  expect((res._result().body as any).checks.db).toBe('error')
})
```

---


---

## Testing SSE endpoints <a name="sse-testing"></a>

Test SSE routes using supertest with a streaming response:

```ts
import supertest from 'supertest'

it('streams SSE events', async () => {
  const events: unknown[] = []

  await supertest(app)
    .get('/live-prices')
    .buffer(false)                          // receive chunks as they arrive
    .parse((res, callback) => {
      res.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { events.push(JSON.parse(line.slice(6))) } catch { /* skip */ }
          }
        }
      })
      res.on('end', () => callback(null, null))
    })

  expect(events.length).toBeGreaterThan(0)
})
```

For unit tests, mock the stream directly:

```ts
import { sseStream } from 'shapeguard'

it('sends typed SSE events', () => {
  const sent: unknown[] = []
  const mockRes = {
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: (chunk: string) => { sent.push(chunk) },
    end: vi.fn(),
    once: (_event: string, fn: () => void) => { /* store or call */ },
  }

  const stream = sseStream(mockRes as any)
  stream.send({ type: 'update', data: { count: 42 } })
  stream.heartbeat()

  expect(sent[0]).toContain('event: update')
  expect(sent[0]).toContain('"count":42')
  expect(sent[1]).toContain(': heartbeat')
})
```

---

## Testing circuit breakers <a name="circuit-breaker-testing"></a>

```ts
import { circuitBreaker, CircuitOpenError } from 'shapeguard'

it('opens after threshold failures', async () => {
  const cb = circuitBreaker({ name: 'test', threshold: 2, resetTimeout: 100 })

  const fail = () => cb.call(() => Promise.reject(new Error('service down')))

  await expect(fail()).rejects.toThrow('service down')
  await expect(fail()).rejects.toThrow('service down')
  // Circuit now OPEN
  await expect(fail()).rejects.toBeInstanceOf(CircuitOpenError)
  expect(cb.state).toBe('OPEN')
})

it('recovers after resetTimeout', async () => {
  const cb = circuitBreaker({ name: 'test', threshold: 1, resetTimeout: 50 })

  // Trip the circuit
  await expect(cb.call(() => Promise.reject(new Error('down')))).rejects.toThrow()
  expect(cb.state).toBe('OPEN')

  // Wait for cooldown
  await new Promise(r => setTimeout(r, 60))

  // Should attempt recovery (HALF_OPEN)
  await expect(cb.call(() => Promise.resolve('ok'))).resolves.toBe('ok')
  expect(cb.state).toBe('CLOSED')
})
```

---

## Testing context store <a name="context-testing"></a>

```ts
import { setContext, getContext, requireContext } from 'shapeguard'
import { mockRequest } from 'shapeguard/testing'

it('passes context between middleware', () => {
  const req = mockRequest()

  // Simulate auth middleware
  setContext(req as any, 'user', { id: 'u1', role: 'admin' })

  // Simulate route reading context
  const user = getContext<{ id: string; role: string }>(req as any, 'user')
  expect(user?.id).toBe('u1')
  expect(user?.role).toBe('admin')
})

it('requireContext throws when key missing', () => {
  const req = mockRequest()
  expect(() => requireContext(req as any, 'user')).toThrow('key "user" not found')
})
```

---

## Testing validateResponse() <a name="validate-response-testing"></a>

```ts
import { validateResponse, checkResponse } from 'shapeguard'
import { z } from 'zod'

const UserSchema = z.object({ id: z.string(), email: z.string() })

it('strips sensitive fields from response', async () => {
  const raw = { id: 'u1', email: 'alice@example.com', password: 'hashed' }
  const clean = await validateResponse(raw, UserSchema)
  expect(clean).toEqual({ id: 'u1', email: 'alice@example.com' })
  expect((clean as any).password).toBeUndefined()
})

it('checkResponse returns errors without throwing', async () => {
  const raw = { id: 123, email: null }  // wrong types
  const result = await checkResponse(raw, UserSchema)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.errors.length).toBeGreaterThan(0)
  }
})
```

---

## Testing controllers with cursorPaginated <a name="cursor-pagination-testing"></a>

`mockResponse()` now includes `cursorPaginated` — previously missing:

```ts
it('cursor-paginates results', async () => {
  const req = mockRequest({ query: { cursor: 'abc' } })
  const res = mockResponse()

  await listItems[1](req, res, mockNext())

  const body = res._result().body as any
  expect(body.success).toBe(true)
  expect(body.data.hasMore).toBe(true)
  expect(body.data.nextCursor).toBeDefined()
})
```

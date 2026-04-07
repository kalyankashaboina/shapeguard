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

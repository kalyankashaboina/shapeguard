# shapeguard

**Structured validation, error handling, response shaping, and API docs for Express — without the boilerplate.**

<!-- quality -->
[![CI](https://github.com/kalyankashaboina/shapeguard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kalyankashaboina/shapeguard/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/kalyankashaboina/shapeguard/branch/main/graph/badge.svg)](https://codecov.io/gh/kalyankashaboina/shapeguard)
[![CodeQL](https://github.com/kalyankashaboina/shapeguard/actions/workflows/codeql.yml/badge.svg)](https://github.com/kalyankashaboina/shapeguard/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/shapeguard?label=shapeguard&color=0f6e56)](https://npmjs.com/package/shapeguard)
[![npm downloads](https://img.shields.io/npm/dm/shapeguard?color=0f6e56)](https://npmjs.com/package/shapeguard)
[![bundle size](https://img.shields.io/bundlephobia/minzip/shapeguard?label=minzipped)](https://bundlephobia.com/package/shapeguard)
[![node](https://img.shields.io/node/v/shapeguard?label=node)](https://npmjs.com/package/shapeguard)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-4%20%7C%205-000000?logo=express&logoColor=white)](https://expressjs.com)
[![license](https://img.shields.io/npm/l/shapeguard)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](./CONTRIBUTING.md)

---

## What is it?

shapeguard is an Express middleware library that eliminates the infrastructure boilerplate every API project copies and re-writes. It does not replace the libraries you already use — it replaces the *boilerplate code* you write to wire them together.

You keep using Zod (or Joi, or Yup) for schemas. You keep using pino or winston if you want structured logging. shapeguard provides the middleware layer that takes those tools and turns them into a consistent, production-ready API pattern with almost no configuration.

---

## The boilerplate problem

Every Express API starts the same way — writing infrastructure code that has nothing to do with your actual product:

```ts
// ❌ The same boilerplate every Express project writes from scratch

// Validation — inconsistent shapes, manual if-checks
if (!req.body.email) return res.status(400).json({ error: 'email required' })
if (!req.body.name)  return res.status(400).json({ message: 'Name missing' }) // different shape!

// Sensitive fields — easy to forget, silent leak
res.json(user) // passwordHash, stripeCustomerId included. No warning.

// Async errors — Express 4 doesn't catch these without extra setup
app.get('/users/:id', async (req, res) => {
  const user = await db.find(req.params.id) // throws → request hangs forever
  res.json(user)
})

// Error handler — each team writes their own, every project looks different
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message })
})

// Request IDs, 405 handling, request logging, structured responses —
// all copy-pasted setup code, different shape on every project.
```

shapeguard replaces that entire block with composable middleware functions backed by your existing schema library.

---

## Install

```bash
npm install shapeguard zod
```

```bash
# Optional — structured production logging (auto-detected if present)
npm install pino pino-pretty
```

---

## Quick start

```ts
import express from 'express'
import { z } from 'zod'
import {
  shapeguard, defineRoute, handle, createDTO,
  AppError, errorHandler, notFoundHandler,
} from 'shapeguard'

const app    = express()
const router = express.Router()

app.use(express.json())
app.use(shapeguard())  // request ID + structured logging + security guards + res helpers

// Define schema once — validation, TypeScript types, and response stripping all come from it
const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
}))

const UserResponse = z.object({
  id: z.string().uuid(), email: z.string(), name: z.string(),
  // password NOT listed → stripped from every response automatically
})

const CreateUserRoute = defineRoute({ body: CreateUserDTO, response: UserResponse })

// Mount routes BEFORE error handlers
router.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body is fully typed. async errors caught. sensitive fields stripped.
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))

app.use('/api/v1', router)

// Error handlers LAST — after all routes
app.use(notFoundHandler())  // unmatched routes → 404
app.use(errorHandler())     // everything thrown above → consistent error shape

app.listen(3000)
```

Every error produces the same shape:

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code":    "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "email", "message": "Invalid email" }]
  }
}
```

---

## What boilerplate it removes

shapeguard eliminates the *code you write*, not the libraries you use.

| Boilerplate you no longer write | What shapeguard provides |
|---|---|
| `if (!req.body.x)` manual field checks | `validate()` — schema-driven, typed, consistent |
| `try { } catch { next(err) }` on every async handler | `handle()` / `asyncHandler()` — async errors caught automatically |
| Custom `AppError` class per project | `AppError` with typed factories and `errorHandler()` |
| Inconsistent `res.status(x).json({ ... })` shapes | `res.ok()`, `res.created()`, `res.fail()`, `res.paginated()` |
| `req.id` generation and header forwarding | Built into `shapeguard()` |
| `res.json(user)` with sensitive fields leaking | Response schema stripping — unlisted fields removed |
| Copy-pasted request logging setup | Structured request/response logging built into `shapeguard()` |
| Missing 405 Method Not Allowed responses | `createRouter()` tracks registered methods, returns 405 automatically |
| Webhook HMAC verification per provider | `verifyWebhook()` with presets for Stripe, GitHub, Shopify, Twilio, Svix |
| OpenAPI spec maintenance (YAML/JSDoc) | `generateOpenAPI()` from route definitions + CDN docs UI |
| Health check endpoint boilerplate | `healthCheck()` — parallel checks, timeouts, k8s-compatible |
| SIGTERM drain + cleanup boilerplate | `gracefulShutdown()` — drain in-flight requests, run cleanup, exit |

If you already use `express-validator` or any other validation library, shapeguard doesn't conflict. You can migrate one route at a time.

---

## Features

### Validation + TypeScript types + response stripping

```ts
import { z } from 'zod'
import { defineRoute, handle, createDTO } from 'shapeguard'

// createDTO wraps a Zod schema — no manual z.infer needed
const CreatePostDTO = createDTO(z.object({
  title:   z.string().min(1).max(200),
  content: z.string().min(1),
  tags:    z.array(z.string()).optional(),
}))

type CreatePostInput = typeof CreatePostDTO.Input
// → { title: string; content: string; tags?: string[] }

const PostResponse = z.object({
  id:    z.string().uuid(),
  title: z.string(),
  // authorId, internalScore — not listed → stripped automatically
})

router.post('/posts', ...handle(
  defineRoute({ body: CreatePostDTO, response: PostResponse }),
  async (req, res) => {
    const post = await PostService.create(req.body)  // req.body is typed
    res.created({ data: post })
    // only { id, title } sent — no internal fields leak
  }
))
```

Validation failures return `422` with a consistent error array — never a single string, never inconsistent shapes.

### Consistent error handling

```ts
import { AppError, errorHandler } from 'shapeguard'

// Throw from anywhere — controller, service, repository, middleware
throw AppError.notFound('User')
throw AppError.unauthorized('Token expired')
throw AppError.forbidden('Insufficient permissions')
throw AppError.conflict('Email already registered')
throw AppError.custom('PAYMENT_FAILED', 'Insufficient funds', 402)

// AppError.define() — typed error factories, defined once, thrown anywhere
const PaymentError = AppError.define<{ amount: number; currency: string }>(
  'PAYMENT_FAILED', 402, 'Payment failed'
)
throw PaymentError({ amount: 9.99, currency: 'USD' })
throw PaymentError({ amount: 0, currency: 'USD' }, 'Card declined')

// Mount once — catches everything
app.use(errorHandler({
  debug:   process.env.NODE_ENV !== 'production',
  onError: (err, req) => Sentry.captureException(err),
}))
```

`AppError` is operational (message shown to client). Anything else (unexpected `Error`, `null`, `string`) is treated as a programmer error — "Something went wrong" in production, full stack trace in development.

### Structured logging

shapeguard includes a request/response logger. It auto-selects pino if installed, falls back to a built-in console logger with identical output.

```
# Dev:
09:44:57  [INFO]  >>  POST  /api/users             [req_019c...]
09:44:57  [INFO]  <<  201   POST  /api/users  2ms   [req_019c...]

# Prod (JSON):
{"level":"info","time":"...","status":201,"method":"POST","path":"/api/users","ms":2}
```

```ts
import { logger } from 'shapeguard'

logger.info({ userId, action: 'login' }, 'User authenticated')
logger.error(err as object, 'Payment failed')
```

### Health check endpoint

```ts
import { healthCheck } from 'shapeguard'

app.use('/health', healthCheck({
  checks: {
    db:    () => db.query('SELECT 1'),        // resolves = pass, throws = fail
    redis: () => redis.ping(),
    mem:   healthCheck.memory({ maxPercent: 90 }),   // built-in
    env:   healthCheck.env(['DATABASE_URL']),         // built-in
  },
  timeout: 5_000,  // each check times out independently
}))
```

Returns `200` (all healthy) or `503` (any failing) — correct for Kubernetes liveness/readiness probes. All checks run in parallel.

### Graceful shutdown

```ts
import { gracefulShutdown, logger } from 'shapeguard'

const server = app.listen(3000)

gracefulShutdown(server, {
  drainMs:    30_000,
  onShutdown: async () => { await db.close(); await redis.quit() },
  onDrained:  () => logger.info({}, 'Server drained'),
  logger,
})
```

On `SIGTERM` or `SIGINT`: stops accepting new connections, waits for in-flight requests, runs cleanup, exits. Returns a deregistration function for use in tests.

### OpenAPI + docs (zero extra packages)

```ts
import { generateOpenAPI, serveScalar, serveSwaggerUI, toPostman } from 'shapeguard/openapi'

const spec = generateOpenAPI({
  title:   'My API',
  version: '1.0.0',
  routes: {
    'POST /users':    { ...CreateUserRoute, summary: 'Create user', tags: ['Users'] },
    'GET  /users/:id': { ...GetUserRoute,   summary: 'Get user',    tags: ['Users'] },
  },
})

app.use('/docs',    serveScalar(spec))    // Scalar UI — modern, try-it-out
app.use('/swagger', serveSwaggerUI(spec)) // Swagger UI — classic, dark mode
app.get('/docs/postman.json', (_req, res) => res.json(toPostman(spec)))
```

All doc UIs load from CDN — no npm install required.

### Webhook signature verification

```ts
import { verifyWebhook } from 'shapeguard'

app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  verifyWebhook({ provider: 'stripe', secret: process.env.STRIPE_SECRET! }),
  handler
)
```

Providers: `stripe`, `github`, `shopify`, `twilio`, `svix`. Timing-safe HMAC. Stripe and Svix include replay-attack prevention.

### 405 Method Not Allowed

```ts
import { createRouter } from 'shapeguard'

const router = createRouter()  // drop-in for express.Router()

router.get('/users', listHandler)   // DELETE /users → 405 + Allow: GET header
router.post('/users', createHandler)
```

### Rate limiting (per route)

```ts
defineRoute({
  body:      CreateUserDTO,
  rateLimit: { windowMs: 60_000, max: 10 },
})
```

Built-in rate limiter uses a fixed-window in-memory store. For distributed deployments, pass `rateLimit.store` with a Redis-compatible interface.

> **Security:** By default, rate limiting uses `socket.remoteAddress` for the client IP. If you are behind a trusted reverse proxy (nginx, AWS ALB, Cloudflare), set `trustProxy: true` to read from `x-forwarded-for`. Never set `trustProxy: true` without an actual proxy — attackers can spoof any IP and bypass rate limiting entirely.

### Security defaults (always active)

| Threat | Default protection |
|---|---|
| Prototype pollution (`__proto__`, `constructor`) | Stripped before schema validation |
| Unicode injection (null bytes, RTL override) | Normalised and stripped |
| Deep nesting DoS | Rejected at depth > 20 |
| Oversized array DoS | Rejected at length > 1,000 |
| Oversized string DoS | Rejected at length > 10,000 chars |
| Query parameter pollution | Rejected with `PARAM_POLLUTION` |
| Sensitive fields in responses | Stripped by response schema |

---

## Standalone usage

Every feature works independently. Nothing requires `shapeguard()` to be mounted.

```ts
// Only validation
import { validate, defineRoute } from 'shapeguard'
router.post('/users', validate(CreateUserRoute), handler)

// Only error handling
import { AppError, errorHandler } from 'shapeguard'
app.use(errorHandler())

// Only docs
import { generateOpenAPI, serveScalar } from 'shapeguard/openapi'
app.use('/docs', serveScalar(generateOpenAPI({ title: 'My API', version: '1.0.0', routes: {} })))

// Only health check
import { healthCheck } from 'shapeguard'
app.get('/health', healthCheck({ checks: { db: () => db.ping() } }))

// Only graceful shutdown
import { gracefulShutdown } from 'shapeguard'
gracefulShutdown(server, { drainMs: 30_000, onShutdown: () => db.close() })
```

---

## Response helpers

`shapeguard()` injects these onto every `res` in your handlers:

```ts
res.ok({ data: user, message: 'Found' })           // 200
res.created({ data: user, message: 'Created' })    // 201
res.accepted({ data: job, message: 'Queued' })     // 202
res.noContent()                                     // 204
res.fail({ code: 'ERR', message: '...', status: 422 })

res.paginated({ data: users, total: 120, page: 1, limit: 20 })
res.cursorPaginated({ data: items, nextCursor: 'abc', prevCursor: null, hasMore: true })
```

---

## Testing

```ts
import { mockRequest, mockResponse, mockNext } from 'shapeguard/testing'

it('creates a user', async () => {
  const req  = mockRequest({ body: { email: 'a@b.com', name: 'Alice', password: 'secret123' } })
  const res  = mockResponse()
  const next = mockNext()

  await createUser[1](req, res, next)

  expect(res._result().statusCode).toBe(201)
  expect(res._result().body).toMatchObject({ success: true })
})
```

`mockResponse()` includes all res helpers. For test logger isolation:

```ts
import { resetLoggerForTesting, configureLogger } from 'shapeguard'

beforeEach(() => {
  resetLoggerForTesting()
  configureLogger({ silent: true })
})
```

---

## Schema adapters

```ts
// Zod — pass directly, no wrapper needed
defineRoute({ body: z.object({ email: z.string().email() }) })

// Joi
import { joiAdapter } from 'shapeguard/adapters/joi'
defineRoute({ body: joiAdapter(Joi.object({ email: Joi.string().email() })) })

// Yup
import { yupAdapter } from 'shapeguard/adapters/yup'
defineRoute({ body: yupAdapter(yup.object({ email: yup.string().email() })) })
```

---

## Peer dependencies

| Package | Required | Notes |
|---|---|---|
| `express` | **Yes** | 4.x or 5.x |
| `zod` | **Yes** | v3.x |
| `pino` | Optional | Auto-detected for structured logging |
| `pino-pretty` | Optional | Pretty dev output with pino |
| `joi` | Optional | `shapeguard/adapters/joi` |
| `yup` | Optional | `shapeguard/adapters/yup` |
| `winston` | Optional | `shapeguard/adapters/winston` |

---

## Bundle size

| Entry point | raw | gzip |
|---|---|---|
| `shapeguard` (core) | ~53 KB | ~18 KB |
| `shapeguard/openapi` | ~26 KB | ~8 KB |
| `shapeguard/testing` | ~2 KB | ~1 KB |
| `shapeguard/adapters/*` | <1 KB | <1 KB |

> Sizes measured at v0.11.0. All entry points have `"sideEffects": false` — tree-shaking removes features you don't import. The full gzip budget is monitored in CI; PRs that exceed 25 KB gzip on the core entry point are blocked.

`"sideEffects": false` — unused exports are tree-shaken automatically.

---

## Documentation

| | |
|---|---|
| [Configuration](./docs/CONFIGURATION.md) | All `shapeguard()` options |
| [Validation](./docs/VALIDATION.md) | `defineRoute()`, `handle()`, `createDTO()`, adapters |
| [Errors](./docs/ERRORS.md) | `AppError`, `errorHandler()`, all error codes |
| [Response](./docs/RESPONSE.md) | `res.ok()`, `res.paginated()`, `withShape()` |
| [Logging](./docs/LOGGING.md) | pino, redaction, request ID, BYOL |
| [OpenAPI](./docs/OPENAPI.md) | `generateOpenAPI()`, all UI options |
| [Testing](./docs/TESTING.md) | `mockRequest()`, `mockResponse()`, `mockNext()` |
| [Migration](./MIGRATION.md) | Version-by-version upgrade guide |
| [Changelog](./CHANGELOG.md) | All releases |

---

## Examples

| Example | What it shows |
|---|---|
| [basic-crud-api](./examples/basic-crud-api/) | Full CRUD, validation, errors, logging, 405 |
| [handle-and-dto](./examples/handle-and-dto/) | `handle()` + `createDTO()` — minimal boilerplate |
| [transform-hook](./examples/transform-hook/) | Password hashing via `defineRoute({ transform })` |
| [global-config](./examples/global-config/) | All `shapeguard()` config options |
| [with-openapi](./examples/with-openapi/) | Docs + webhooks + cursor pagination |
| [with-webhook](./examples/with-webhook/) | Stripe, GitHub, Shopify, custom HMAC |
| [with-testing](./examples/with-testing/) | Unit testing controllers without HTTP |

```bash
cd examples/with-openapi && npm install && npm start
# → http://localhost:3000/docs
```

---

## Limitations

- **Express only.** No Fastify, Hono, or Koa support.
- **Rate limiting is per-process.** In-memory store. Pass `rateLimit.store` for Redis/multi-instance.
- **Zod required.** Joi and Yup adapters exist, but Zod is the primary supported library.
- **OpenAPI reads Zod internals.** Works with Zod v3.x. Breaking Zod internal API changes could require a shapeguard update.
- **Pre-1.0 API.** At v0.10.x, minor bumps may include breaking changes. See [MIGRATION.md](./MIGRATION.md).

---

## Docker

```bash
npm run docker:up   # app + Redis at http://localhost:3000/docs
```

See [docker/](./docker/).

---

## License

MIT © [Kalyan Kashaboina](https://github.com/kalyankashaboina)

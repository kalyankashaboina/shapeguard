# shapeguard

**One package that replaces nine. Typed validation, structured logging, error handling, and API docs for Express — with zero runtime dependencies.**

<!-- quality -->
[![CI](https://github.com/kalyankashaboina/shapeguard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kalyankashaboina/shapeguard/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/kalyankashaboina/shapeguard/branch/main/graph/badge.svg)](https://codecov.io/gh/kalyankashaboina/shapeguard)
[![CodeQL](https://github.com/kalyankashaboina/shapeguard/actions/workflows/codeql.yml/badge.svg)](https://github.com/kalyankashaboina/shapeguard/actions/workflows/codeql.yml)
<!-- publish -->

[![npm](https://img.shields.io/badge/npm-shapeguard-red)](https://www.npmjs.com/package/shapeguard)
[![npm version](https://img.shields.io/npm/v/shapeguard?label=shapeguard&color=0f6e56)](https://npmjs.com/package/shapeguard)
[![npm downloads](https://img.shields.io/npm/dm/shapeguard?color=0f6e56)](https://npmjs.com/package/shapeguard)
[![bundle size](https://img.shields.io/bundlephobia/minzip/shapeguard?label=minzipped)](https://bundlephobia.com/package/shapeguard)
<!-- compatibility -->
[![node](https://img.shields.io/node/v/shapeguard?label=node)](https://npmjs.com/package/shapeguard)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-4%20%7C%205-000000?logo=express&logoColor=white)](https://expressjs.com)
<!-- meta -->
[![license](https://img.shields.io/npm/l/shapeguard)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](./CONTRIBUTING.md)

---

## The problem

Every Express app starts the same way — copy-pasting infrastructure that has nothing to do with your actual product:

```ts
// ❌ What every Express project does today

// Validate manually, get inconsistent errors
if (!req.body.email) return res.status(400).json({ error: 'email required' })
if (!req.body.name)  return res.status(400).json({ message: 'Name missing' }) // different shape!

// Forget to strip passwordHash — ships to clients
res.json(user) // passwordHash included. Silent. No warning.

// Unhandled async errors in Express 4
app.get('/users/:id', async (req, res) => {
  const user = await db.find(req.params.id) // throws → request hangs
  res.json(user)
})

// 9 packages installed just to have a working API server:
// express-validator, http-errors, morgan, express-rate-limit,
// express-async-errors, swagger-ui-express, swagger-jsdoc, uuid, supertest
```

---

## The solution

```bash
npm install shapeguard zod
```

```ts
// ✅ The entire setup — one package

import express from 'express'
import { z } from 'zod'
import {
  shapeguard, defineRoute, handle, createDTO,
  AppError, errorHandler, notFoundHandler,
} from 'shapeguard'

const app = express()
app.use(express.json())
app.use(shapeguard())     // logging + requestId + security guards
app.use(notFoundHandler())
app.use(errorHandler())   // catches everything thrown anywhere

// Define schema once → validation + types + response stripping, all automatic
const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
}))

const UserResponse = z.object({
  id: z.string().uuid(), email: z.string(), name: z.string()
  // password NOT listed → automatically stripped from every response
})

const CreateUserRoute = defineRoute({ body: CreateUserDTO, response: UserResponse })

router.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body is fully typed. async errors are caught. sensitive fields stripped.
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))

app.listen(3000)
```

Every error — validation, 404, thrown `AppError`, or unexpected crash — produces the same shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "field": "email", "message": "Invalid email" }]
  }
}
```

---

## What it replaces

| Package(s) | shapeguard equivalent |
|---|---|
| `express-validator` | `defineRoute()` + `handle()` |
| `express-async-errors` | built into `handle()` and `asyncHandler()` |
| `http-errors` | `AppError` with typed factories |
| `morgan` | `shapeguard()` built-in structured logging |
| `express-rate-limit` | `defineRoute({ rateLimit })` |
| `swagger-ui-express` + `swagger-jsdoc` | `generateOpenAPI()` + `serveScalar()` |
| custom error handler boilerplate | `errorHandler()` |
| `uuid` for request IDs | built into `shapeguard()` |

**9 packages → 1. Zero required runtime dependencies. ~12KB minzipped.**

---

## Install

```bash
npm install shapeguard zod
```

```bash
# Optional — structured production logging (auto-detected if present)
npm install pino pino-pretty
```

If pino is not installed, shapeguard uses a built-in console logger with identical output format.

---

## Core features

### 1. Validation + types + response stripping

```ts
import { z } from 'zod'
import { defineRoute, handle, createDTO } from 'shapeguard'

// createDTO() wraps a Zod schema — no manual z.infer needed
const CreatePostDTO = createDTO(z.object({
  title:   z.string().min(1).max(200),
  content: z.string().min(1),
  tags:    z.array(z.string()).optional(),
}))

const PostResponse = z.object({ id: z.string(), title: z.string(), content: z.string() })

const CreatePostRoute = defineRoute({
  body:      CreatePostDTO,
  response:  PostResponse,
  rateLimit: { windowMs: 60_000, max: 20 },
})

router.post('/posts', ...handle(CreatePostRoute, async (req, res) => {
  // req.body: { title: string, content: string, tags?: string[] }
  const post = await PostService.create(req.body)
  res.created({ data: post, message: 'Post created' })
}))
```

Validation failure returns `422` with all errors at once — never one error at a time.

### 2. Consistent error handling

```ts
import { AppError, errorHandler } from 'shapeguard'

// Throw anywhere — always caught, always consistent
throw AppError.notFound('User')
throw AppError.unauthorized('Token expired')
throw AppError.conflict('Email already registered')
throw AppError.custom('PAYMENT_FAILED', 'Insufficient funds', 402, { amount: 9.99 })

// Typed error factories
const RateLimitError = AppError.define<{ retryAfter: number }>('RATE_LIMIT_EXCEEDED', 429)
throw RateLimitError({ retryAfter: 60 })

// Mount once, handles everything
app.use(errorHandler({
  debug:   process.env.NODE_ENV !== 'production', // stack trace in dev only
  onError: (err, req) => Sentry.captureException(err), // hook for external logging
}))
```

### 3. Structured logging

```ts
import { logger } from 'shapeguard'

// Use in any file — same instance as shapeguard() middleware
logger.info({ userId, action: 'login' }, 'User authenticated')
logger.warn({ attempts: 5, ip }, 'Multiple failed login attempts')
logger.error(err as object, 'Stripe payment failed')
logger.debug({ query }, 'Database query executed')
```

**Dev output** — human-readable, color-coded:
```
09:44:57  [INFO]  << 201  POST  /api/users  2ms  [req_019c...]
09:44:57  [WARN]  << 429  POST  /api/auth   1ms  [req_019d...]
```

**Prod output** — one JSON line (Datadog / CloudWatch / Loki ready):
```json
{"level":"info","time":"2024-01-10T09:44:57Z","status":201,"method":"POST","msg":"..."}
```

Auto-selects: **pino** → **winston** → built-in fallback. Configurable via `shapeguard({ logger: ... })`.

### 4. OpenAPI + API docs — zero extra packages

```ts
import { generateOpenAPI, serveScalar, serveDocs, toPostman } from 'shapeguard/openapi'

const spec = generateOpenAPI({
  title:           'My API',
  version:         '1.0.0',
  security:        { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  defaultSecurity: ['bearer'],
  routes: {
    'POST /users': { ...CreateUserRoute, summary: 'Create user', tags: ['Users'], security: [] },
    'GET  /users/:id': { ...GetUserRoute, summary: 'Get user', tags: ['Users'] },
  },
})

// Choose your UI — all load from CDN, zero npm install
app.use('/docs',    serveScalar(spec))              // Scalar — modern, code snippets
app.use('/swagger', serveSwaggerUI(spec))           // Swagger UI — enhanced with dark mode
app.use('/redoc',   serveRedoc(spec))               // Redoc — clean public portal

// Or mount everything at once
app.use('/docs', serveDocs(spec, {
  ui:      'scalar',
  exports: {
    json:    '/docs/openapi.json',     // import into SDK generators
    postman: '/docs/postman.json',     // import URL for Postman
  }
}))

// Export to API clients — pure functions, no deps
app.get('/docs/postman.json',  (_req, res) => res.json(toPostman(spec)))
app.get('/docs/insomnia.json', (_req, res) => res.json(toInsomnia(spec)))
```

### 5. Webhook verification — Stripe, GitHub, Shopify

```ts
import { verifyWebhook } from 'shapeguard'

app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  verifyWebhook({ provider: 'stripe', secret: process.env.STRIPE_SECRET! }),
  (req, res) => {
    // Signature verified. Replay attacks prevented (300s tolerance).
    const event = JSON.parse(req.body.toString())
    res.json({ received: true })
  }
)
```

Supported: `stripe`, `github`, `shopify`, `twilio`, `svix`, and custom HMAC providers.

### 6. Testing — no HTTP server needed

```ts
import { mockRequest, mockResponse, mockNext } from 'shapeguard/testing'

it('creates a user', async () => {
  UserService.create = vi.fn().mockResolvedValue({ id: '1', email: 'alice@example.com' })

  const req  = mockRequest({ body: { email: 'alice@example.com', name: 'Alice' } })
  const res  = mockResponse()
  const next = mockNext()

  await createUser[1](req, res, next)  // [1] = the handler after validate middleware

  expect(next.error).toBeUndefined()
  expect(res._result().statusCode).toBe(201)
  expect(res._result().body).toMatchObject({ success: true, data: { email: 'alice@example.com' } })
})
```

---

## Standalone usage

Nothing is mandatory. Each feature works independently.

```ts
// Only need logging on an existing app? Zero route changes.
app.use(shapeguard())

// Only need validation?
import { validate, defineRoute } from 'shapeguard'
router.post('/users', validate(CreateUserRoute), handler)

// Only need consistent errors?
import { AppError, errorHandler } from 'shapeguard'
app.use(errorHandler())
throw AppError.notFound('User')

// Only need Swagger docs? 3 lines on any existing app.
import { generateOpenAPI, serveScalar } from 'shapeguard/openapi'
const spec = generateOpenAPI({ title: 'My API', version: '1.0.0', routes: {} })
app.use('/docs', serveScalar(spec))

// Only need webhook verification?
app.post('/wh', express.raw({ type: 'application/json' }),
  verifyWebhook({ provider: 'stripe', secret: S }), handler)
```

---

## Security defaults (always on)

| Threat | Protection |
|---|---|
| Proto pollution (`__proto__`, `constructor`) | Stripped before schema validation |
| Unicode injection (null bytes, RTL override) | Stripped before schema validation |
| Object depth DoS | Max 20 levels (configurable) |
| Array size DoS | Max 1,000 items (configurable) |
| Sensitive field exposure | Response schema stripping |
| Webhook replay attacks | HMAC + timestamp tolerance |

![Security defaults](./assets/shapeguard-security.svg)

---

## Peer dependencies

| Package | Required | Notes |
|---|---|---|
| `express` | **Yes** | Express 4 and 5 |
| `zod` | **Yes** | v3.x |
| `pino` | Optional | Auto-detected for production logging |
| `pino-pretty` | Optional | Pretty dev output with pino |
| `joi` | Optional | `import from 'shapeguard/adapters/joi'` |
| `yup` | Optional | `import from 'shapeguard/adapters/yup'` |
| `winston` | Optional | `import from 'shapeguard/adapters/winston'` |

---

## Bundle size

| Entry point | ESM (minzipped) |
|---|---|
| `shapeguard` | ~12 KB |
| `shapeguard/openapi` | ~8 KB |
| `shapeguard/testing` | ~2 KB |
| `shapeguard/adapters/*` | ~1 KB each |

`sideEffects: false` — tree-shaking removes what you don't import.

---

## Documentation

| | |
|---|---|
| [Configuration](./docs/CONFIGURATION.md) | All `shapeguard()` options, global vs per-route config |
| [Validation](./docs/VALIDATION.md) | `defineRoute()`, `handle()`, `createDTO()`, adapters |
| [Errors](./docs/ERRORS.md) | `AppError`, `errorHandler()`, all error codes |
| [Response](./docs/RESPONSE.md) | `res.ok()`, `res.paginated()`, `res.cursorPaginated()`, `withShape()` |
| [Logging](./docs/LOGGING.md) | Pino, redaction, requestId, bring your own logger |
| [OpenAPI](./docs/OPENAPI.md) | `generateOpenAPI()`, all UI options, exports |
| [Testing](./docs/TESTING.md) | `mockRequest()`, `mockResponse()`, `mockNext()` |
| [Migration](./MIGRATION.md) | Version-by-version upgrade guide |
| [Changelog](./CHANGELOG.md) | All releases |

---

## Examples

| Example | What it demonstrates |
|---|---|
| [basic-crud-api](./examples/basic-crud-api/) | Full CRUD API — validation, errors, logging, 405 |
| [handle-and-dto](./examples/handle-and-dto/) | `handle()` + `createDTO()` — less boilerplate |
| [transform-hook](./examples/transform-hook/) | Password hashing via `defineRoute({ transform })` |
| [global-config](./examples/global-config/) | All `shapeguard()` config options |
| [with-openapi](./examples/with-openapi/) | Swagger + webhooks + cursor pagination |
| [with-webhook](./examples/with-webhook/) | Stripe, GitHub, Shopify, custom HMAC |
| [with-testing](./examples/with-testing/) | Unit testing controllers without HTTP |

```bash
cd examples/with-openapi
npm install && npm start
# → http://localhost:3000/docs
```

---

## Limitations

- **Express only** — no Fastify, Hono, or framework-agnostic core yet.
- **Rate limiting is per-process** — in-memory Map. Pass `rateLimit.store` (Redis adapter) for multi-instance deployments.
- **Zod required** — Joi and Yup adapters exist, but Zod is the primary validation library.
- **Pre-1.0 API** — at v0.9.x, minor version bumps may include breaking changes. Check [MIGRATION.md](./MIGRATION.md) before upgrading.

---

## Docker

```bash
npm run docker:up   # starts app + Redis at http://localhost:3000/docs
```

All Docker files in `docker/` — nothing at the repository root. See [docker/](./docker/).

---

## License

MIT © [Kalyan Kashaboina](https://github.com/kalyankashaboina)

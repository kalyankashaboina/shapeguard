# shapeguard

> FastAPI-style validation, response shaping, and error handling for Node.js + Express.

Zero config to start. Fully configurable when you need it.
Strict by default. Lightweight. Production-ready.

[![npm](https://img.shields.io/npm/v/shapeguard)](https://npmjs.com/package/shapeguard)
[![bundle size](https://img.shields.io/bundlephobia/minzip/shapeguard)](https://bundlephobia.com/package/shapeguard)
[![license](https://img.shields.io/npm/l/shapeguard)](./LICENSE)

---

## Why shapeguard

Every Node.js + Express app repeats the same setup:

- Manual `if (!req.body.email)` checks scattered everywhere
- Error responses with different shapes per developer
- `passwordHash` leaking because someone forgot to strip it
- `req.body` typed as `any` — no IDE help, no safety
- Unhandled promise rejections silently hanging requests in Express 4
- DB error messages exposed to clients in production

shapeguard fixes all of this permanently — once, at setup.

---

## Install

```bash
npm install shapeguard zod
```

```bash
# Optional — structured production logging
npm install pino pino-pretty
```

If pino is not installed, shapeguard uses a built-in console logger automatically.

---

## Peer dependencies

| Package       | Required | Notes                          |
|---------------|----------|--------------------------------|
| `express`     | Yes      | Primary target                 |
| `zod`         | Yes      | Schema validation              |
| `pino`        | Optional | Richer logging if installed    |
| `pino-pretty` | Optional | Pretty dev logs with pino      |
| `joi`         | Optional | Via `shapeguard/adapters/joi`  |
| `yup`         | Optional | Via `shapeguard/adapters/yup`  |

---

## Quick start

### 1. Mount in app.ts

```ts
import express from 'express'
import { shapeguard, notFoundHandler, errorHandler } from 'shapeguard'

const app = express()
app.use(express.json())
app.use(shapeguard())         // logging, requestId, res helpers
app.use('/api/users', userRouter)
app.use(notFoundHandler())    // 404 — no route matched
app.use(errorHandler())       // catches everything — always last
app.listen(3000)
```

### 2. Define schemas once

```ts
// validators/user.validator.ts
import { z } from 'zod'
import { defineRoute } from 'shapeguard'

const CreateUserBodySchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
})

const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string(),
  name:      z.string(),
  createdAt: z.string().datetime(),
  // passwordHash NOT here → stripped automatically
})

export const CreateUserRoute = defineRoute({
  body:     CreateUserBodySchema,
  response: UserResponseSchema,
})

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>
export type UserResponse   = z.infer<typeof UserResponseSchema>
```

### 3. Validate in controller

```ts
import { validate, asyncHandler, AppError } from 'shapeguard'
import { CreateUserRoute } from '../validators/user.validator'

export const createUser = [
  validate(CreateUserRoute),
  asyncHandler(async (req, res) => {
    req.body.email   // string — typed ✅
    req.body.isAdmin // TypeScript error — not in schema ✅

    const user = await UserService.create(req.body)
    res.created({ data: user, message: 'User created' })
    // passwordHash stripped by response schema automatically ✅
  })
]
```

### 4. Throw errors from anywhere

```ts
import { AppError } from 'shapeguard'

async create(data: CreateUserBody) {
  const exists = await db.findByEmail(data.email)
  if (exists) throw AppError.conflict('Email')
  // → client sees "Email already exists" — 409

  return db.create(data)
  // crash → client sees "Something went wrong" in prod
  // full stack trace → pino logger only ✅
}
```

### 5. Routes with auto 405

```ts
import { createRouter } from 'shapeguard'

const router = createRouter()  // drop-in for express.Router()

router.post('/',      ...UserController.createUser)
router.get('/',       ...UserController.listUsers)
// DELETE / → 405 Method Not Allowed, Allow: GET, POST — automatic

router.get('/:id',    ...UserController.getUser)
router.put('/:id',    ...UserController.updateUser)
router.delete('/:id', ...UserController.deleteUser)
// POST /:id → 405, Allow: GET, PUT, DELETE — works for :param routes too

export default router
```

---

## What you get for free

```
shapeguard() mounted
  ✅ Structured logging          dev: pretty  |  prod: JSON lines
  ✅ Time-ordered requestId      every request, traceable in logs
  ✅ Request logging             method, endpoint (not path), status, duration
  ✅ res helpers                 res.ok / res.created / res.fail on every route
  ✅ Default redaction           passwords, tokens, cookies never logged

validate() on a route
  ✅ req.body typed              no more any
  ✅ Unknown fields stripped     silently — passwordHash gone before service runs
  ✅ Fail fast                   first invalid field → 422 → handler never runs
  ✅ Response stripping          response schema removes server-only fields
  ✅ Pre-parse guards            proto pollution, depth DoS, size limits

AppError thrown anywhere
  ✅ errorHandler catches it     always consistent response shape
  ✅ Operational → shown         client sees your message
  ✅ Programmer → hidden in prod "Something went wrong"

errorHandler() mounted
  ✅ One error shape always      frontend writes one handler — forever
  ✅ 4xx → logger.warn           expected, low noise
  ✅ 5xx → logger.error + stack  unexpected, full detail
  ✅ onError hook                Sentry, Datadog, alerting
```

---

## Response shapes — always consistent

```ts
// SUCCESS
{ "success": true,  "message": "User created", "data": { ... } }

// ERROR
{ "success": false, "message": "Validation failed",
  "error": { "code": "VALIDATION_ERROR", "message": "...",
             "details": { "field": "email", "message": "Invalid email" }}}
```

Frontend writes this once, forever:

```ts
const { success, data, error } = response.data
if (!success) handleError(error.code, error.message)
```

---

## Logging

```
# Development — human readable, color-coded level badges, one line per request
09:44:57.123  [DEBUG]  >>  POST    /api/v1/users                       [req_019c...]
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users           2ms   [req_019c...]
09:44:57.400  [WARN]   <<  404  GET     /api/v1/users/xx       12ms   [req_019c...]
09:44:57.900  [ERROR]  <<  500  GET     /api/v1/crash           1ms   [req_019c...]
09:44:57.800  [WARN]   <<  200  GET     /api/v1/data         1523ms   [req_019c...]  SLOW

# Production — one JSON line per event (Datadog / CloudWatch / Loki ready)
{"level":"info","time":"...","requestId":"req_019c...","method":"POST","endpoint":"/api/v1/users","status":201,"duration_ms":2}
```

`>>` = request arriving at server &nbsp;|&nbsp; `<<` = response leaving server

### Request ID config

```ts
app.use(shapeguard({
  requestId: {
    // Read trace ID from upstream first (load balancer / API gateway / CDN).
    // Falls back to generating a fresh req_<ts><random> ID if header is absent.
    header: 'x-request-id',        // default. Change to 'x-trace-id', 'x-correlation-id', etc.

    // Custom generator — replace built-in format
    // generator: () => `trace-${crypto.randomUUID()}`,

    // Disable entirely — req.id will be '' and no ID appears in logs
    // enabled: false,
  },
  logger: {
    logRequestId:   true,           // show [req_id] on every log line (default: true)
    logAllRequests: true,           // log every request, not just errors (default: true in dev)
    slowThreshold:  1000,           // SLOW warning if response >= 1000ms
  },
  response: {
    includeRequestId: true,         // send X-Request-Id header on every response
  },
}))
```

### Optional body logging

```ts
app.use(shapeguard({
  logger: {
    logRequestBody:  true,   // include req.body in log (auto-redacted: passwords/tokens never logged)
    logResponseBody: true,   // include response JSON in log
  }
}))
```

---

## Full API

### Tier 1 — daily use

```ts
import {
  validate,          // request validation + response stripping
  asyncHandler,      // async route safety for Express 4
  AppError,          // throw errors from anywhere
  defineRoute,       // bundle schemas — single source of truth
  isAppError,        // type guard
  ErrorCode,         // stable error code constants
} from 'shapeguard'
```

### Tier 2 — setup once

```ts
import {
  shapeguard,        // main middleware — mount in app.ts
  errorHandler,      // centralised error handler — always last
  notFoundHandler,   // 404 for unmatched routes
  createRouter,      // drop-in router with auto 405
} from 'shapeguard'
```

### Tier 3 — special cases

```ts
import {
  withShape,         // custom response shape per route
  zodAdapter,        // wrap zod schemas manually
  isZodSchema,       // detect zod schemas
} from 'shapeguard'
```

### Types

```ts
import type {
  ShapeguardConfig,   // shapeguard() config
  LoggerConfig,       // logger sub-config
  ValidationConfig,   // validation sub-config
  ResponseConfig,     // response sub-config
  ErrorsConfig,       // errors sub-config
  SchemaAdapter,      // adapter interface for custom schemas
  RouteSchema,        // defineRoute() shape
  SuccessEnvelope,    // { success: true, message, data }
  ErrorEnvelope,      // { success: false, message, error }
  Envelope,           // union of both
  PaginatedData,      // paginated data shape
  ValidationIssue,    // { field, message, code }
  Logger,             // { info, warn, error, debug }
  LogLevel,           // 'debug' | 'info' | 'warn' | 'error'

  // Type inference from defineRoute() output
  InferBody,          // type Body = InferBody<typeof MyRoute>
  InferParams,        // type Params = InferParams<typeof MyRoute>
  InferQuery,         // type Query = InferQuery<typeof MyRoute>
  InferHeaders,       // type Headers = InferHeaders<typeof MyRoute>
} from 'shapeguard'
```

### Adapters

```ts
// Joi
import { joiAdapter } from 'shapeguard/adapters/joi'
// Yup
import { yupAdapter } from 'shapeguard/adapters/yup'
```

---

## Security defaults

| Threat | Default | Configurable |
|--------|---------|--------------|
| Proto pollution (`__proto__`) | Stripped | No — always blocked |
| Unicode injection (null bytes, RTL) | Stripped | No — always cleaned |
| Object depth DoS | 20 levels | Yes — per-route or global |
| Array size DoS | 1000 items | Yes |
| String size DoS | 10,000 chars | Yes |
| Missing Content-Type | 415 error | No — always enforced |
| Sensitive fields in logs | `[REDACTED]` | Add more paths |
| Programmer errors in prod | Hidden | `fallbackMessage` to customise |

---

## Bundle size

```
shapeguard core   ~12kb gzip   — zero heavy deps, tree-shakeable
pino (optional)   ~8kb  gzip   — adds structured JSON logging
total             ~20kb gzip
```

---

## Full documentation

| Doc | What's inside |
|-----|---------------|
| [VALIDATION.md](./docs/VALIDATION.md) | validate(), defineRoute(), schemas, adapters, edge cases |
| [ERRORS.md](./docs/ERRORS.md) | AppError, errorHandler, operational vs programmer |
| [LOGGING.md](./docs/LOGGING.md) | pino, requestId, body logging, dev vs prod, config |
| [RESPONSE.md](./docs/RESPONSE.md) | res helpers, withShape, all response shapes |
| [CONFIGURATION.md](./docs/CONFIGURATION.md) | every config option, global vs scoped |
| [CHANGELOG.md](./CHANGELOG.md) | version history |
| [SETUP.md](./SETUP.md) | GitHub + npm publish steps |

---

## License

MIT — Kalyan

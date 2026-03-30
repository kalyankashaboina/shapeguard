# Migration Guide

---

## v0.1.x → v0.2.0

**No breaking changes.** All v0.1.x code works in v0.2.0 without modification.
This release adds new APIs — nothing is removed or renamed.

---

### What's new

| Feature | What it replaces | Required to migrate? |
|---|---|---|
| `handle()` | `validate()` + `asyncHandler()` array | No — opt in when ready |
| `createDTO()` | `z.object()` + manual `z.infer` | No — opt in when ready |
| Transform hook on `defineRoute()` | Manual transform in service layer | No — opt in when ready |
| Global string transforms | Per-field `.trim()` / `.toLowerCase()` | No — opt in when ready |

---

### Opting in to `handle()`

`handle()` is a drop-in replacement for the `[validate(), asyncHandler()]` pattern.
You can migrate one route at a time — both patterns work side by side.

**Before (v0.1.x — still works)**

```ts
import { validate, asyncHandler } from 'shapeguard'

export const createUser = [
  validate(CreateUserRoute),
  asyncHandler(async (req, res) => {
    const user = await UserService.create(req.body)
    res.created({ data: user, message: 'User created' })
  })
]
```

**After (v0.2.0)**

```ts
import { handle } from 'shapeguard'

export const createUser = handle(CreateUserRoute, async (req, res) => {
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
})
```

---

### Opting in to `createDTO()`

`createDTO()` removes the manual `z.infer<typeof ...>` export on every schema.
Migrate one validator file at a time.

**Before (v0.1.x — still works)**

```ts
import { z } from 'zod'

const CreateUserBodySchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
})

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>
```

**After (v0.2.0)**

```ts
import { z } from 'zod'
import { createDTO } from 'shapeguard'

export const CreateUserDTO = createDTO({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
})

export type CreateUserBody = CreateUserDTO.Input  // inferred automatically
```

---

### Opting in to the transform hook

Add `transform` to any `defineRoute()` call to run logic after validation and
before your handler. No changes needed to the handler or service layer.

**Before (v0.1.x — password hashed in service)**

```ts
// service/user.service.ts
async create(data: CreateUserBody) {
  const hash = await bcrypt.hash(data.password, 10)  // ← belongs in middleware layer
  return db.users.create({ ...data, password: hash })
}
```

**After (v0.2.0 — transform hook)**

```ts
// validators/user.validator.ts
export const CreateUserRoute = defineRoute({
  body:      CreateUserBodySchema,
  response:  UserResponseSchema,
  transform: async (data) => ({
    ...data,
    password: await bcrypt.hash(data.password, 10),  // ← runs before handler
  }),
})

// service/user.service.ts — now clean, no hashing
async create(data: CreateUserBody) {
  return db.users.create(data)  // password already hashed
}
```

---

### Opting in to global string transforms

Add `validation.strings` to your `shapeguard()` config once and all string fields
in all schemas are trimmed/lowercased automatically.

**Before (v0.1.x — .trim() repeated everywhere)**

```ts
const CreateUserBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name:  z.string().trim().min(1).max(100),
  city:  z.string().trim(),
})
```

**After (v0.2.0 — set once, applies everywhere)**

```ts
// app.ts — set once
app.use(shapeguard({
  validation: {
    strings: { trim: true, lowercase: false },
  }
}))

// validators — clean
const CreateUserBodySchema = z.object({
  email: z.string().email(),   // trim applied automatically
  name:  z.string().min(1).max(100),
  city:  z.string(),
})
```

---

## v0.2.x → v0.3.0

**No breaking changes.** All v0.2.x code works unchanged in v0.3.0.

### New opt-in features

**1. OpenAPI + Swagger UI**

```bash
npm install swagger-ui-express
```

```ts
import { generateOpenAPI } from 'shapeguard'
import swaggerUi from 'swagger-ui-express'

// Your existing defineRoute() definitions become the spec — zero duplication
const spec = generateOpenAPI({
  title: 'My API', version: '1.0.0',
  routes: {
    'POST /users':     CreateUserRoute,
    'GET  /users/:id': GetUserRoute,
    'GET  /users':     ListUsersRoute,
  }
})

app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec))
app.get('/docs/openapi.json', (_req, res) => res.json(spec))
```

**2. Testing helpers — `shapeguard/testing`**

```ts
import { mockRequest, mockResponse, mockNext } from 'shapeguard/testing'

// Unit-test controllers without HTTP or Express setup
const req  = mockRequest({ body: { email: 'alice@example.com' } })
const res  = mockResponse()
const next = mockNext()

await createUser[1](req, res, next)  // [1] = handler, [0] = validate middleware

expect(next.error).toBeUndefined()
expect(res._result().statusCode).toBe(201)
```

**3. Per-route `rateLimit`**

```ts
// Add to any existing defineRoute() call
defineRoute({
  body:      CreateUserDTO,
  rateLimit: {
    windowMs: 60_000,   // 1 minute
    max:      10,       // 10 requests per IP per minute
    message:  'Too many requests',

    // Optional: plug in Redis for multi-instance production
    store: {
      async get(key) { return redis.get(key) },
      async set(key, value) { await redis.set(key, value) },
    },

    // Optional: key by user ID instead of IP
    keyGenerator: (req) => req.user?.id ?? req.ip,
  }
})
// → 429 RATE_LIMIT_EXCEEDED when exceeded
```

**4. Per-route `cache` headers**

```ts
defineRoute({
  params:   UserParamsSchema,
  response: UserResponseSchema,
  cache:    { maxAge: 60, private: true },
  // cache: { noStore: true }  // for sensitive endpoints
})
```

### Package changes

- `joi` and `yup` removed from `devDependencies` — they remain in `optionalDependencies` only
- New named export: `generateOpenAPI` from `'shapeguard'`
- New subpath export: `'shapeguard/testing'`
- New error code: `ErrorCode.RATE_LIMIT_EXCEEDED`
Track progress in [CHANGELOG.md](./CHANGELOG.md).

---

## v0.3.x → v0.4.0

No breaking changes. All v0.3.x code is fully compatible.

### Internal change — `setFallbackValidationConfig` removed

This function was an internal export from `validation/validate.ts` used only by `shapeguard()` itself. It is not part of the public API and was never documented. If you were importing it directly (unsupported usage), remove the call — config is now scoped automatically via `res.locals` per request.

### New: Winston adapter

```ts
import winston from 'winston'
import { winstonAdapter } from 'shapeguard/adapters/winston'

const wLogger = winston.createLogger({ ... })

app.use(shapeguard({
  logger: { instance: winstonAdapter(wLogger) },
}))
```

---

## v0.4.x → v0.5.0

No breaking changes. All v0.4.x code is fully compatible.

### New: prefix option

```ts
// Before — prefix repeated on every key
generateOpenAPI({
  routes: {
    'GET  /api/v1/users':     GetUsersRoute,
    'POST /api/v1/users':     CreateUserRoute,
    'GET  /api/v1/users/:id': GetUserRoute,
  }
})

// After — set once
generateOpenAPI({
  prefix: '/api/v1',
  routes: {
    'GET  /users':     GetUsersRoute,
    'POST /users':     CreateUserRoute,
    'GET  /users/:id': GetUserRoute,
  }
})
```

### New: tags and summary per route

```ts
export const CreateUserRoute = {
  ...defineRoute({ body: CreateUserDTO, response: UserResponseSchema }),
  summary: 'Create a new user',
  tags:    ['Users'],
}
```

### New: inline route definitions for existing apps

```ts
generateOpenAPI({
  prefix: '/api/v1',
  routes: {
    'POST /users': {
      summary: 'Create a user',
      tags:    ['Users'],
      body:     z.object({ email: z.string(), name: z.string() }),
      response: z.object({ id: z.string(), email: z.string() }),
    },
  }
})
```

---

## v0.5.x → v0.6.0

No breaking changes. All v0.5.x code is fully compatible. All four new options default to the existing behaviour — no config change needed.

### New logger options

All four options are independent — use any combination:

```ts
app.use(shapeguard({
  logger: {
    // Hide >> arrival lines, keep << response lines
    logIncoming:    false,

    // Show last 8 chars of request ID instead of full 28-char ID
    shortRequestId: true,

    // Log client IP on each response line
    logClientIp:    true,

    // Colour whole line by response status instead of HTTP method
    lineColor:      'level',
  }
}))
```

**`logIncoming: false`** — terminal output before:
```
09:44:57.123  [DEBUG]  >>  POST    /api/v1/users          [req_019c...]
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users  2ms [req_019c...]
```
After:
```
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users  2ms [req_019c...]
```

**`shortRequestId: true`** — terminal output before:
```
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users  2ms [req_019cfa6f23691913c86c63a3045a]
```
After:
```
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users  2ms [3a3045a]
```

**`logClientIp: true`** — adds IP to end of response line:
```
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users  2ms [req_019c...]  192.168.1.100
```

**`lineColor: 'level'`** — colours the entire method+status by response level:
- `2xx` → whole line green
- `4xx` → whole line yellow
- `5xx` → whole line red

---

## v0.5.x → v0.6.0

No breaking changes. All v0.5.x code is fully compatible. All 4 new options are opt-in — existing apps need zero changes.

### New logger options

All four can be used independently or combined:

```ts
app.use(shapeguard({
  logger: {
    // Hide >> arrival lines — keep << response lines only
    logIncoming: false,

    // Show last 8 chars of request ID instead of full 28-char ID
    shortRequestId: true,

    // Log client IP on each response line
    logClientIp: true,

    // Colour whole line by response status instead of HTTP method
    lineColor: 'level',
  }
}))
```

**Before (default output):**
```
09:44:57.123  [DEBUG]  >>  POST    /api/v1/users                       [req_019cfa6f23691913c86c63a3045a]
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users           2ms   [req_019cfa6f23691913c86c63a3045a]
```

**After (all 4 options enabled):**
```
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users           2ms   [3a3045a]  192.168.1.1
```

---

## v0.5.x → v0.6.0

No breaking changes. All v0.5.x code is fully compatible. All new options default to their previous behaviour — existing apps need zero changes.

### New logger options

All four are opt-in. Add only the ones you want:

```ts
app.use(shapeguard({
  logger: {
    // Hide >> arrival lines — keep only << response lines
    logIncoming: false,

    // Show last 8 chars of request ID instead of full 28-char ID
    shortRequestId: true,

    // Log client IP on every response line
    logClientIp: true,

    // Colour whole line by response status (2xx=green, 4xx=yellow, 5xx=red)
    // instead of default method colour (GET=green, POST=cyan, DELETE=red)
    lineColor: 'level',
  }
}))
```

#### What each option changes

| Option | Default | Effect |
|--------|---------|--------|
| `logIncoming` | `true` | `false` hides `>>` arrival lines |
| `shortRequestId` | `false` | `true` shows last 8 chars only |
| `logClientIp` | `false` | `true` adds IP to line and JSON payload |
| `lineColor` | `'method'` | `'level'` colours by status instead of verb |

All options work in any combination. JSON prod logs are unaffected by `lineColor`.

---

## v0.5.x → v0.6.0

No breaking changes. All v0.5.x code is fully compatible. All four new options default to the existing behaviour so nothing changes unless you opt in.

### New logger options — all optional, all independent

```ts
app.use(shapeguard({
  logger: {
    // Hide >> arrival lines — keep only << response lines
    logIncoming: false,

    // Show last 8 chars of request ID instead of full 28 chars
    shortRequestId: true,

    // Log client IP on every response line
    logClientIp: true,

    // Colour entire line by response status (2xx green, 4xx yellow, 5xx red)
    // instead of the default HTTP method colour
    lineColor: 'level',
  }
}))
```

Each option is completely independent — use any combination you want.

#### Default values (existing behaviour preserved)

| Option | Default | Effect when changed |
|--------|---------|-------------------|
| `logIncoming` | `true` | `false` hides `>>` arrival lines |
| `shortRequestId` | `false` | `true` shows last 8 chars only |
| `logClientIp` | `false` | `true` adds IP to every response line |
| `lineColor` | `'method'` | `'level'` colours by status instead of verb |

---

## v0.5.x → v0.6.0

No breaking changes. All v0.5.x code is fully compatible. All four new options default to the existing behaviour — no config change needed.

### New logger options

All four are optional fields on `LoggerConfig` inside `shapeguard({ logger: { ... } })`.

```ts
app.use(shapeguard({
  logger: {
    // Hide >> arrival lines — keep only << response lines
    logIncoming: false,

    // Show last 8 chars of request ID instead of full 28-char ID
    shortRequestId: true,

    // Log client IP on each response line
    logClientIp: true,

    // Colour entire line by response status level, not HTTP method
    lineColor: 'level',
  }
}))
```

Each option is fully independent — use any combination.

### Default values (unchanged behaviour)

| Option | Default | What it means |
|--------|---------|---------------|
| `logIncoming` | `true` | `>>` lines shown as before |
| `shortRequestId` | `false` | Full request ID shown as before |
| `logClientIp` | `false` | IP not logged as before |
| `lineColor` | `'method'` | Method colour as before |

---

## v0.5.x → v0.6.0

No breaking changes. All v0.5.x code is fully compatible. All 4 new options default to their previous behaviour so nothing changes unless you opt in.

### New logger options — all optional, all independent

```ts
app.use(shapeguard({
  logger: {
    // Hide >> arrival lines — keep << response lines only
    logIncoming: false,

    // Show last 8 chars of request ID instead of full 28-char ID
    shortRequestId: true,

    // Log client IP on every response line
    logClientIp: true,

    // Colour entire line by response status instead of HTTP method
    lineColor: 'level',
  }
}))
```

Each option is independent — use any combination:

```ts
// Just hide arrivals + shorten IDs — common team preference
logger: { logIncoming: false, shortRequestId: true }

// Just add IP logging — useful for rate limit debugging
logger: { logClientIp: true }

// Full FastAPI-style output
logger: {
  logIncoming:    false,   // no noise
  shortRequestId: true,    // compact IDs
  logClientIp:    true,    // see who called
  lineColor:      'level', // colour by outcome not verb
}
```

### What each option logs

**`logIncoming: false`** — before and after:
```
// Before (default — both lines shown)
09:44:57.123  [DEBUG]  >>  POST    /users                    [req_019c...]
09:44:57.125  [INFO]   <<  201  POST    /users        2ms   [req_019c...]

// After (logIncoming: false — arrival hidden)
09:44:57.125  [INFO]   <<  201  POST    /users        2ms   [req_019c...]
```

**`shortRequestId: true`** — before and after:
```
// Before — full 28-char ID
09:44:57.125  [INFO]   <<  201  POST    /users        2ms   [req_019cfa6f23691913c86c63a3045a]

// After — last 8 chars only
09:44:57.125  [INFO]   <<  201  POST    /users        2ms   [3a3045a]
```

**`logClientIp: true`**:
```
09:44:57.125  [INFO]   <<  201  POST    /users        2ms   [req_019c...]  192.168.1.100
```

**`lineColor: 'level'`** — method column coloured by response status instead of verb colour.

---

## v0.5.x → v0.6.0

No breaking changes. All v0.5.x code is fully compatible. All 4 new options default to the existing behaviour — nothing changes unless you opt in.

### New logger options

```ts
app.use(shapeguard({
  logger: {
    // Hide >> arrival lines — keep only << response lines
    logIncoming: false,

    // Show last 8 chars of request ID instead of full 28-char ID
    shortRequestId: true,

    // Log client IP on every response line
    logClientIp: true,

    // Colour whole line by response status (2xx=green, 4xx=yellow, 5xx=red)
    // instead of the default method colour (GET=green, POST=cyan, DELETE=red)
    lineColor: 'level',
  }
}))
```

All four can be combined freely. Each defaults to the existing behaviour when not set.

| Option | Default | Effect when changed |
|--------|---------|---------------------|
| `logIncoming` | `true` | `false` hides `>>` arrival lines |
| `shortRequestId` | `false` | `true` shows last 8 chars only |
| `logClientIp` | `false` | `true` adds IP to response lines |
| `lineColor` | `'method'` | `'level'` colours by status code |

---

## v0.6.0 → v0.6.1

**Patch release — zero breaking changes. No migration needed.**

All changes are bug fixes. Your existing code continues to work identically.

Notable behaviour changes you might observe:

- `?role=admin&role=user` now returns `400 PARAM_POLLUTION` instead of a generic `422` — this is the documented and intended behaviour that was previously broken.
- Rate-limited routes now return a `Retry-After` HTTP header alongside the body `details.retryAfter` field.
- `Cache-Control` headers are no longer set on validation-failure responses (422). They were previously set regardless of whether the request validated successfully, which could cause CDNs to cache error responses.
- `errorHandler()` now auto-discovers `shapeguard()`'s logger from `req.app.locals` — no manual wiring needed. Existing explicit `logger:` option still takes precedence.

---

## v0.6.1 → v0.7.0

**Minor release — zero breaking changes. No migration needed.**

### New: `security` in `generateOpenAPI()`

The Swagger UI padlock now works. Add security schemes and the spec generates `securitySchemes` in `components` automatically:

```ts
const spec = generateOpenAPI({
  // ... existing config unchanged ...
  security: {
    bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  },
  defaultSecurity: ['bearer'],  // applied to every route
})
```

Per-route override: spread `security: []` for public endpoints, `security: ['bearer']` to override.

### New: `createDocs()` — built-in Swagger UI

Replace `swagger-ui-express` with one line:

```ts
// Before (v0.6.x):
import swaggerUi from 'swagger-ui-express'
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec))

// After (v0.7.0+): no npm install needed
import { createDocs } from 'shapeguard'
app.use('/docs', createDocs({ spec, theme: 'dark' }))
```

`swagger-ui-express` can be uninstalled. `createDocs` is standalone — it works without any other shapeguard feature.

---

## v0.7.0 → v0.8.0

**Minor release — zero breaking changes. No migration needed.**

### New: `res.cursorPaginated()`

```ts
// Before (offset pagination — may break when data changes between pages):
res.paginated({ data: users, total: 1000, page: 1, limit: 20 })

// After (cursor pagination — stable, enterprise standard):
res.cursorPaginated({
  data:       users,
  nextCursor: users.at(-1)?.id ?? null,
  prevCursor: req.query.cursor ?? null,
  hasMore:    users.length === limit,
  total:      1000,  // optional
})
```

`res.paginated()` is unchanged and still works. `cursorPaginated` is an addition, not a replacement.

### New: `verifyWebhook()`

```ts
import { verifyWebhook } from 'shapeguard'

// Before (manual HMAC verification in every webhook handler):
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig  = req.headers['stripe-signature']
  const body = req.body.toString()
  // ... 15 lines of HMAC code ...
})

// After (one middleware, zero boilerplate):
router.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  verifyWebhook({ provider: 'stripe', secret: process.env.STRIPE_SECRET! }),
  asyncHandler(async (req, res) => {
    const event = JSON.parse(req.body.toString())
    res.ok({ data: { received: true } })
  }),
)
```

Built-in presets: `stripe`, `github`, `shopify`, `twilio`, `svix`. Custom providers supported via `algorithm`, `headerName`, `prefix`, `encoding`.

### New: `AppError.define()`

```ts
// Before (untyped details):
throw AppError.custom('PAYMENT_FAILED', 'Payment failed', 402, { amount: 9.99 })

// After (typed factory — TypeScript catches wrong shapes at compile time):
const PaymentError = AppError.define<{ amount: number; currency: string }>('PAYMENT_FAILED', 402)
throw PaymentError({ amount: 9.99, currency: 'USD' })
```

### `createDocs()` improvements

`validatorUrl` is now set to `'none'` (eliminates browser console noise from external validator calls), and many new options are available: `logo`, `requestInterceptor`, `docExpansion`, `operationsSorter`, `showExtensions`, `csp`, `headHtml`. All are optional — existing `createDocs()` calls work unchanged.

### `generateOpenAPI()` improvements

New per-route options: `deprecated`, `description`, `externalDocs`, `extensions` (x-* vendor extensions), `bodyType` (`'multipart'` for file uploads, `'form'` for form-urlencoded), `responseHeaders`. Top-level: `tags`, `externalDocs`, `termsOfService`, `contact`, `license`. All are optional — existing `generateOpenAPI()` calls work unchanged.

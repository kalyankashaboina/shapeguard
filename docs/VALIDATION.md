# Validation — shapeguard

> validate(), handle(), defineRoute(), createDTO(), schemas, types, pre-parse guards.

---

## Table of contents

- [defineRoute()](#defineroute)
- [createDTO()](#createdto)
- [validate()](#validate)
- [handle()](#handle)
- [Transform hook](#transform)
- [What gets validated](#what-gets-validated)
- [Schema naming convention](#naming)
- [Full CRUD example](#crud)
- [Pre-parse guards](#pre-parse)
- [Edge cases](#edge-cases)
- [Adapters — Joi and Yup](#adapters)

---

## defineRoute()

Bundle all schemas for a route into one object.
Pass it directly to `validate()` or `handle()`.
Define once — use in controller, infer types for service and repository.

```ts
import { z } from 'zod'
import { defineRoute } from 'shapeguard'

export const CreateUserRoute = defineRoute({
  body:     CreateUserBodySchema,   // what client sends
  params:   UserParamsSchema,       // route segments :id
  query:    UserQuerySchema,        // ?page=1&limit=20
  headers:  UserHeadersSchema,      // Authorization etc
  response: UserResponseSchema,     // what client receives — strips unknown fields
})
```

All fields are optional — include only what the route needs:

```ts
// GET route — no body
export const GetUserRoute = defineRoute({
  params:   UserParamsSchema,
  response: UserResponseSchema,
})

// LIST route — no body, no params
export const ListUsersRoute = defineRoute({
  query:    UserQuerySchema,
  response: UserListSchema,
})

// DELETE route — user decides response
export const DeleteUserRoute = defineRoute({
  params: UserParamsSchema,
})
```

---

## createDTO()

Removes the `z.infer<typeof ...>` boilerplate from every schema file.
Under the hood it is `z.object()` — same runtime behaviour, same Zod methods.

**Before (v0.1.x)**

```ts
const CreateUserBodySchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
})

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>  // ← repeated every time
```

**With createDTO()**

```ts
import { createDTO } from 'shapeguard'

export const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
}))

export type CreateUserBody = typeof CreateUserDTO.Input  // ← inferred automatically
```

Pass directly to `defineRoute()` — it is a valid Zod schema:

```ts
export const CreateUserRoute = defineRoute({
  body:     CreateUserDTO,
  response: UserResponseDTO,
})
```

---

## validate()

Attach to any route as middleware. Validates before your handler runs.

```ts
// pass full route definition
validate(CreateUserRoute)

// or pick individual pieces
validate({
  body:  CreateUserBodySchema,
  sends: UserResponseSchema,
})

// return ALL validation errors instead of just the first
validate({
  body:      CreateUserBodySchema,
  allErrors: true,
})

// override pre-parse limits for this specific route
validate({
  body:   FileUploadBodySchema,
  limits: { maxStringLength: 100_000 },
})

// control what error info is exposed on this route
validate({
  body:     CreateUserBodySchema,
  sanitize: { exposeEnumValues: true },
})
```

After `validate()` runs:
- `req.body` is typed from your schema
- `req.params` is typed from your schema
- `req.query` is typed from your schema
- Unknown fields are stripped silently
- Invalid fields return 422 immediately — handler never runs

```ts
export const createUser = [
  validate(CreateUserRoute),
  asyncHandler(async (req, res) => {
    req.body.email    // string — typed ✅
    req.body.isAdmin  // TypeScript error — not in schema ✅
  })
]
```

---

## handle()

Combines `validate()` + `asyncHandler()` into a single call.
This is the recommended pattern.

**Before**

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

**With handle()**

```ts
import { handle } from 'shapeguard'

export const createUser = handle(CreateUserRoute, async (req, res) => {
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
})
```

`handle()` is compatible with `createRouter()` — spread it the same way:

```ts
router.post('/',   ...createUser)
router.get('/:id', ...getUser)
```

Both `validate()` + `asyncHandler()` and `handle()` work side by side — migrate one route at a time.

---

## Transform hook <a name="transform"></a>

Run logic after validation and before your handler — hash passwords, normalise fields,
enrich data. Keeps your service layer pure.

Define `transform` on `defineRoute()`:

```ts
export const CreateUserRoute = defineRoute({
  body:      CreateUserBodySchema,
  response:  UserResponseSchema,
  transform: async (data) => ({
    ...data,
    password: await bcrypt.hash(data.password, 10),
  }),
})
```

The flow is: **validate → transform → handler.**
Your handler receives already-transformed data:

```ts
export const createUser = handle(CreateUserRoute, async (req, res) => {
  // req.body.password is already hashed here — service stays clean
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
})
```

Transform also works with `validate()` if you have not migrated to `handle()` yet:

```ts
export const createUser = [
  validate(CreateUserRoute),   // transform runs here
  asyncHandler(async (req, res) => { ... })
]
```

---

## What gets validated

### body — JSON payload

```ts
const CreateUserBodySchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
  role:     z.enum(['admin', 'member', 'viewer']),
})

// extra fields stripped silently
{ "email": "alice@example.com", "isAdmin": true }
// → isAdmin gone before handler runs
```

### params — route segments

```ts
const UserParamsSchema = z.object({
  id: z.string().uuid(),
})

// GET /api/users/550e8400-e29b-41d4-a716-446655440000
req.params.id  // typed uuid string ✅

// GET /api/users/not-a-uuid
// → 422 VALIDATION_ERROR before handler runs
```

### query — URL parameters

```ts
// query params are always strings from the URL — use z.coerce to convert
const UserQuerySchema = z.object({
  page:   z.coerce.number().min(1).default(1),
  limit:  z.coerce.number().min(1).max(100).default(20),
  role:   z.enum(['admin', 'member', 'viewer']).optional(),
  search: z.string().max(100).optional(),
})

// GET /api/users?page=2&limit=10
req.query.page   // 2 — number, not string "2" ✅
req.query.limit  // 10 ✅
```

### headers — request headers

```ts
// Node.js lowercases all header names
const UserHeadersSchema = z.object({
  authorization:  z.string().startsWith('Bearer '),
  'x-tenant-id':  z.string().uuid().optional(),
})

req.headers.authorization  // "Bearer eyJ..." — validated ✅, typed ✅
```

> **Runtime note:** After `validate()` runs, the parsed fields are merged back into
> `req.headers` via `Object.assign`. Express's `IncomingMessage.headers` does not
> allow full reassignment, so existing header keys are updated in place and unknown
> keys remain. Your Zod schema's `.strip()` removes unrecognised fields from the
> parsed value but **does not delete them from `req.headers`** — Express adds its own
> internal headers that you should not strip. Validate what you care about; ignore the rest.

### response — strips outgoing fields

```ts
const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string(),
  name:      z.string(),
  createdAt: z.string().datetime(),
  // passwordHash NOT here → stripped automatically
  // stripeCustomerId NOT here → stripped automatically
})

// DB returns { id, email, name, createdAt, passwordHash, stripeCustomerId }
// Client receives { id, email, name, createdAt }
// sensitive fields gone — even if you forget about them
```

---

## Schema naming convention <a name="naming"></a>

```ts
// Zod schemas    → PascalCase + Schema suffix
const UserResponseSchema     = z.object({ ... })
const CreateUserBodySchema   = z.object({ ... })
const UpdateUserBodySchema   = z.object({ ... })
const UserParamsSchema       = z.object({ ... })
const UserQuerySchema        = z.object({ ... })

// DTOs → PascalCase + DTO suffix
const CreateUserDTO          = createDTO({ ... })

// Route bundles  → PascalCase + Route suffix
export const CreateUserRoute = defineRoute({ ... })
export const GetUserRoute    = defineRoute({ ... })

// Inferred types → PascalCase, no suffix
export type UserResponse   = z.infer<typeof UserResponseSchema>
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>
// or with createDTO:
export type CreateUserBody = CreateUserDTO.Input
```

Why separate names for schema and type:

```ts
// ❌ BREAKS — const and type cannot share the same name
const CreateUserBody = z.object({ ... })
export type CreateUserBody = z.infer<typeof CreateUserBody>  // error

// ✅ WORKS — Schema suffix on const, clean name on type
const CreateUserBodySchema = z.object({ ... })
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>
```

---

## Full CRUD example <a name="crud"></a>

```ts
// validators/user.validator.ts
import { z } from 'zod'
import { defineRoute, createDTO } from 'shapeguard'

// ── params ────────────────────────────────────
const UserParamsSchema = z.object({
  id: z.string().uuid(),
})

// ── query ─────────────────────────────────────
const UserQuerySchema = z.object({
  page:   z.coerce.number().min(1).default(1),
  limit:  z.coerce.number().min(1).max(100).default(20),
  role:   z.enum(['admin', 'member', 'viewer']).optional(),
  search: z.string().max(100).optional(),
})

// ── DTOs ──────────────────────────────────────
export const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
  role:     z.enum(['admin', 'member', 'viewer']),
}))

export const UpdateUserDTO = createDTO(z.object({
  name:     z.string().min(1).max(100).optional(),
  role:     z.enum(['admin', 'member', 'viewer']).optional(),
  password: z.string().min(8).optional(),
}))

// ── response ──────────────────────────────────
const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string(),
  name:      z.string(),
  role:      z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

// ── routes ────────────────────────────────────
export const CreateUserRoute = defineRoute({
  body:      CreateUserDTO,
  response:  UserResponseSchema,
  transform: async (data) => ({
    ...data,
    password: await bcrypt.hash(data.password, 10),
  }),
})

export const GetUserRoute = defineRoute({
  params:   UserParamsSchema,
  response: UserResponseSchema,
})

export const UpdateUserRoute = defineRoute({
  params:   UserParamsSchema,
  body:     UpdateUserDTO,
  response: UserResponseSchema,
})

export const DeleteUserRoute = defineRoute({
  params: UserParamsSchema,
})

export const ListUsersRoute = defineRoute({
  query:    UserQuerySchema,
  response: z.object({ users: z.array(UserResponseSchema) }),
})

// ── inferred types ────────────────────────────
export type UserParams     = z.infer<typeof UserParamsSchema>
export type UserQuery      = z.infer<typeof UserQuerySchema>
export type CreateUserBody = CreateUserDTO.Input
export type UpdateUserBody = UpdateUserDTO.Input
export type UserResponse   = z.infer<typeof UserResponseSchema>
```

---

## Pre-parse guards <a name="pre-parse"></a>

These run on every request before Zod ever sees the data.
Proto pollution and unicode sanitization cannot be disabled.
Size/depth limits have defaults but are configurable per-route or globally.

| Guard | Default | Status | What it blocks |
|-------|---------|--------|----------------|
| Proto pollution | always | 400 | `__proto__`, `constructor`, `prototype` stripped |
| Unicode sanitize | always | 400 | null bytes, zero-width chars, RTL override stripped |
| Object depth | 20 levels | 400 | billion-laughs attacks, stack overflows |
| Array length | 1000 items | 400 | memory exhaustion |
| String length | 10,000 chars | 400 | memory exhaustion |
| Content-Type | always | 415 | POST/PUT/PATCH without Content-Type rejected |

Configure limits globally in `shapeguard()`:

```ts
app.use(shapeguard({
  validation: {
    limits: {
      maxDepth:        20,
      maxArrayLength:  1000,
      maxStringLength: 10_000,
    }
  }
}))
```

Or override per-route in `validate()` or `handle()`:

```ts
// larger limit for this route
validate({ body: FileBodySchema, limits: { maxStringLength: 500_000 } })

// handle() supports the same options
handle({ ...FileUploadRoute, limits: { maxStringLength: 500_000 } }, async (req, res) => { ... })
```

---

## Edge cases <a name="edge-cases"></a>

```
Empty body on POST          → 422 VALIDATION_ERROR — "body is required"
Body is array not object    → 422 — "Expected object, received array"
Extra unknown fields        → stripped silently, never an error
__proto__ in body           → stripped at JSON.parse time
Deeply nested object        → rejected at depth limit before Zod runs
?role=a&role=b (pollution)  → 400 PARAM_POLLUTION — repeated query params are rejected before Zod runs
Query page=abc              → 422 — "Expected number" (use z.coerce.number())
Missing required param      → Express won't match route — never reaches validate()
transform throws            → caught, passed to errorHandler as AppError.internal()
```

> **PARAM_POLLUTION**: Express parses `?role=admin&role=user` as `role: ['admin','user']` — an array where your schema expects a string. shapeguard detects this before Zod runs and returns `400 PARAM_POLLUTION`. This prevents attackers from injecting unexpected arrays into scalar fields.

---

## Adapters — Joi and Yup <a name="adapters"></a>

Zod is first class. Joi and Yup work via adapters — install the library and import the adapter.

### Joi

```ts
import { joiAdapter } from 'shapeguard/adapters/joi'
import Joi from 'joi'

const CreateUserSchema = Joi.object({
  email:    Joi.string().email().required(),
  name:     Joi.string().min(1).max(100).required(),
  password: Joi.string().min(8).required(),
})

// pass directly to validate()
validate({ body: joiAdapter(CreateUserSchema) })

// or wrap in defineRoute() then use with handle()
export const CreateUserRoute = defineRoute({
  body:     joiAdapter(CreateUserSchema),
  response: joiAdapter(UserResponseSchema),
})

export const createUser = handle(CreateUserRoute, async (req, res) => {
  const user = await UserService.create(req.body)
  res.created({ data: user })
})
```

### Yup

```ts
import { yupAdapter } from 'shapeguard/adapters/yup'
import * as yup from 'yup'

const CreateUserSchema = yup.object({
  email:    yup.string().email().required(),
  name:     yup.string().min(1).max(100).required(),
  password: yup.string().min(8).required(),
})

validate({ body: yupAdapter(CreateUserSchema) })
```

> **Note:** `createDTO()` is Zod-only. For Joi/Yup pass the adapter directly to `defineRoute()` or `validate()`.

---

## Per-route rate limiting — `rateLimit` <a name="ratelimit"></a>

> No extra package needed

Add `rateLimit` to any `defineRoute()` call:

```ts
import { defineRoute, createDTO } from 'shapeguard'
import { z } from 'zod'

const CreateUserRoute = defineRoute({
  body:      createDTO(z.object({ email: z.string().email() })),
  rateLimit: {
    windowMs: 60_000,   // 1 minute window
    max:      10,        // 10 requests per IP per window
    message:  'Too many registrations — try again in a minute',

    // Plug in Redis for multi-instance production
    store:        redisStore,

    // Key by user ID instead of IP (e.g. authenticated routes)
    keyGenerator: (req) => req.user?.id ?? req.ip,
  }
})
```

When the limit is exceeded shapeguard responds with **429** and `ErrorCode.RATE_LIMIT_EXCEEDED`:

```json
{
  "success": false,
  "message": "Too many registrations — try again in a minute",
  "error": { "code": "RATE_LIMIT_EXCEEDED", "details": { "retryAfter": 35 } }
}
```

The `retryAfter` field tells the client how many seconds until the window resets.

---

## Per-route timeout <a name="timeout"></a>

Abort a request with 408 if the handler has not responded within a given time.
Protects against slow handlers, hanging DB queries, and stuck external API calls.

```ts
defineRoute({
  body:    CreateOrderDTO,
  timeout: 10_000,   // 408 if handler takes > 10s
})

// Or globally for all routes:
app.use(shapeguard({ timeout: 30_000 }))
```

The timeout fires only if `res.headersSent` is false — if the handler responds first,
the timer is cleared immediately. Standalone: works without `shapeguard()` mounted.

---


---

## Standalone response validation — `validateResponse()` <a name="validate-response"></a>

Strip and validate a response object outside of the full route lifecycle.

```ts
import { validateResponse, checkResponse } from 'shapeguard'
import { z } from 'zod'

const UserSchema = z.object({ id: z.string(), email: z.string() })

// validateResponse() — strips unknown fields, throws if invalid
const clean = await validateResponse(rawUserFromDB, UserSchema)
// clean.password === undefined — stripped automatically

// checkResponse() — never throws, returns a result object
const result = await checkResponse(apiResponse, CacheableSchema)
if (!result.success) {
  logger.warn({ errors: result.errors }, 'Response does not match schema')
}
```

Use cases:
- **Unit testing** — verify response shape without HTTP
- **Before caching** — never cache data that doesn't match your schema
- **Audit logs** — strip PII fields before writing to logs

---

## Merging route definitions — `mergeRoutes()` <a name="merge-routes"></a>

Compose route schemas from reusable base definitions.

```ts
import { mergeRoutes, defineRoute } from 'shapeguard'

// Shared auth + rate-limit base
const AuthenticatedRoute = defineRoute({
  rateLimit: { windowMs: 60_000, max: 100, trustProxy: true },
  headers:   z.object({ authorization: z.string().startsWith('Bearer ') }),
})

// Specific routes extend the base
const CreateUserRoute = mergeRoutes(
  AuthenticatedRoute,
  defineRoute({
    body:     CreateUserDTO,
    response: UserResponseSchema,
    timeout:  10_000,
  })
)

// Later definition wins on collision
const SlowRouteOverride = mergeRoutes(AuthenticatedRoute, defineRoute({ timeout: 60_000 }))
```

---

## Validation hook — `onValidationError` <a name="validation-hook"></a>

Fire a callback when any schema validation fails — before the error is thrown.

```ts
const CreateUserRoute = defineRoute({
  body:              CreateUserDTO,
  onValidationError: async (issues, req) => {
    // Fire analytics, increment counters, log to external service
    analytics.track('validation_failed', {
      endpoint:  req.path,
      fields:    issues.map(i => i.field),
      requestId: req.id,
    })
  },
})
```

Fires for body, params, query, and headers failures. Errors thrown from the hook are silently swallowed — they never affect the response.

---

## Extra content types — `extraContentTypes` <a name="extra-content-types"></a>

```ts
// Allow JSON:API content type
app.use(express.json({ type: ['application/json', 'application/vnd.api+json'] }))
app.use(shapeguard({
  validation: {
    extraContentTypes: ['application/vnd.api+json'],
  }
}))

// Disable content-type enforcement entirely (for webhooks, raw upload routes)
const WebhookRoute = defineRoute({
  sanitize: { skipContentTypeCheck: true },
})
```

---

## Per-route cache hints — `cache` <a name="cache"></a>

> Sets `Cache-Control` response header automatically

```ts
// Public endpoint — CDN + browser cache for 60s
const GetProductRoute = defineRoute({
  params:   z.object({ id: z.string().uuid() }),
  response: ProductSchema,
  cache:    { maxAge: 60 },                   // Cache-Control: public, max-age=60
})

// User-specific — browser cache only
const GetProfileRoute = defineRoute({
  response: ProfileSchema,
  cache:    { maxAge: 300, private: true },   // Cache-Control: private, max-age=300
})

// Sensitive — never cache
const GetPaymentRoute = defineRoute({
  cache: { maxAge: 0, noStore: true },        // Cache-Control: no-store
})
```

Cache headers are set **after successful validation** — if validation fails (422), cache headers are not set, so CDNs never cache error responses.
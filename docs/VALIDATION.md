# Validation — shapeguard

> validate(), defineRoute(), schemas, types, pre-parse guards.

---

## Table of contents

- [defineRoute()](#defineroute)
- [validate()](#validate)
- [What gets validated](#what-gets-validated)
- [Schema naming convention](#naming)
- [Full CRUD example](#crud)
- [Pre-parse guards](#pre-parse)
- [Edge cases](#edge-cases)
- [Adapters — Joi and Yup](#adapters)

---

## defineRoute()

Bundle all schemas for a route into one object.
Pass it directly to `validate()`.
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
  // no response — handler controls what it sends
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
  limits: { maxStringLength: 100_000 },  // larger limit for this route only
})

// control what error info is exposed on this route
validate({
  body:     CreateUserBodySchema,
  sanitize: { exposeEnumValues: true },  // show enum options on this route
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
    req.body.email    // string — typed
    req.body.name     // string — typed
    req.body.isAdmin  // TypeScript error — not in schema
    req.body.anything // TypeScript error — not in schema
  })
]
```

### allErrors mode

By default, validation stops at the first error (fail fast).
Set `allErrors: true` to collect every error in the request and return them all.

```ts
validate({ body: CreateUserBodySchema, allErrors: true })

// client sends: { email: 'not-valid', name: '' }
// response:
// {
//   "error": {
//     "code": "VALIDATION_ERROR",
//     "details": [
//       { "field": "email", "message": "Invalid email address" },
//       { "field": "name",  "message": "String must contain at least 1 character(s)" }
//     ]
//   }
// }
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

// what client sends
{ "email": "alice@example.com", "name": "Alice", "password": "secure123", "role": "member" }

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
req.params.id  // "550e8400-e29b-41d4-a716-446655440000" — typed, validated uuid

// GET /api/users/not-a-uuid
// → 422 VALIDATION_ERROR before handler runs
```

### query — URL parameters

```ts
// query params are always strings from the URL
// use z.coerce to convert types
const UserQuerySchema = z.object({
  page:   z.coerce.number().min(1).default(1),    // "1" → 1
  limit:  z.coerce.number().min(1).max(100).default(20),
  role:   z.enum(['admin', 'member', 'viewer']).optional(),
  search: z.string().max(100).optional(),
})

// GET /api/users?page=2&limit=10&role=admin
req.query.page   // 2   — number, not string "2"
req.query.limit  // 10  — number
req.query.role   // 'admin' — typed enum
```

### headers — request headers

```ts
// Node.js lowercases all header names automatically
const UserHeadersSchema = z.object({
  authorization:  z.string().startsWith('Bearer '),
  'x-tenant-id':  z.string().uuid().optional(),
})

req.headers.authorization  // "Bearer eyJ..." — typed, validated
```

### response — strips outgoing fields

```ts
const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string(),
  name:      z.string(),
  role:      z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // passwordHash     NOT here → stripped
  // internalRole     NOT here → stripped
  // stripeCustomerId NOT here → stripped
})

// DB returns { id, email, name, role, createdAt, updatedAt, passwordHash }
// Client receives { id, email, name, role, createdAt, updatedAt }
// passwordHash is gone — even if you forget about it
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

// Route bundles  → PascalCase + Route suffix
export const CreateUserRoute = defineRoute({ ... })
export const GetUserRoute    = defineRoute({ ... })

// Inferred types → PascalCase, no suffix
export type UserResponse   = z.infer<typeof UserResponseSchema>
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>
export type UserParams     = z.infer<typeof UserParamsSchema>
export type UserQuery      = z.infer<typeof UserQuerySchema>
```

Why separate names for schema and type:

```ts
// ❌ BREAKS — const and type cannot share same name
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
import { defineRoute } from 'shapeguard'
import { PaginationQuerySchema } from './shared/pagination.schema'

// ── shared base ──────────────────────────────
const UserBaseSchema = z.object({
  email: z.string().email(),
  name:  z.string().min(1).max(100),
  role:  z.enum(['admin', 'member', 'viewer']),
})

// ── params ────────────────────────────────────
const UserParamsSchema = z.object({
  id: z.string().uuid(),
})

// ── query ─────────────────────────────────────
const UserQuerySchema = PaginationQuerySchema.extend({
  role:   z.enum(['admin', 'member', 'viewer']).optional(),
  search: z.string().max(100).optional(),
})

// ── bodies ────────────────────────────────────
const CreateUserBodySchema = UserBaseSchema.extend({
  password: z.string().min(8),
})

const UpdateUserBodySchema = UserBaseSchema.partial().extend({
  password: z.string().min(8).optional(),
})

// ── responses ─────────────────────────────────
const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string(),
  name:      z.string(),
  role:      z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const UserListSchema = z.object({
  users: z.array(UserResponseSchema),
  total: z.number(),
  page:  z.number(),
  limit: z.number(),
})

// ── route definitions ─────────────────────────
export const CreateUserRoute = defineRoute({
  body:     CreateUserBodySchema,
  response: UserResponseSchema,
})

export const GetUserRoute = defineRoute({
  params:   UserParamsSchema,
  response: UserResponseSchema,
})

export const UpdateUserRoute = defineRoute({
  params:   UserParamsSchema,
  body:     UpdateUserBodySchema,
  response: UserResponseSchema,
})

export const DeleteUserRoute = defineRoute({
  params:   UserParamsSchema,
})

export const ListUsersRoute = defineRoute({
  query:    UserQuerySchema,
  response: UserListSchema,
})

// ── types ─────────────────────────────────────
export type UserParams     = z.infer<typeof UserParamsSchema>
export type UserQuery      = z.infer<typeof UserQuerySchema>
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>
export type UpdateUserBody = z.infer<typeof UpdateUserBodySchema>
export type UserResponse   = z.infer<typeof UserResponseSchema>
export type UserList       = z.infer<typeof UserListSchema>
```

---

## Pre-parse guards <a name="pre-parse"></a>

These run on every request before Zod ever sees the data.
Proto pollution and unicode sanitization cannot be disabled.
Size/depth limits have defaults but are configurable per-route or globally.

| Guard | Default | Status | What it blocks |
|-------|---------|--------|----------------|
| Proto pollution | always | 400 | `__proto__`, `constructor`, `prototype` stripped during JSON.parse |
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

Or override per-route in `validate()`:

```ts
// this route accepts larger payloads
validate({
  body:   FileBodySchema,
  limits: { maxStringLength: 500_000 },
})

// this route is stricter than the global default
validate({
  body:   LoginBodySchema,
  limits: { maxStringLength: 200 },
})
```



---

## Edge cases <a name="edge-cases"></a>

```
Empty body on POST          → 422 VALIDATION_ERROR — "body is required"
Body is array not object    → 422 — "Expected object, received array"
Extra unknown fields        → stripped silently, never an error
__proto__ in body           → stripped at JSON.parse time
Deeply nested object        → rejected at depth limit before Zod runs
?role=a&role=b (pollution)  → 422 PARAM_POLLUTION — expected scalar
Query page=abc              → 422 — "Expected number" (use z.coerce.number())
Missing required param      → Express won't match route — never reaches validate()
```

---

## Adapters — Joi and Yup <a name="adapters"></a>

Zod is first class. Joi and Yup work via adapters.
You can mix adapters per route if needed.

```ts
// Joi
import { joiAdapter } from 'shapeguard/adapters/joi'
import Joi from 'joi'

const schema = Joi.object({ email: Joi.string().email().required() })

validate({ body: joiAdapter(schema) })
```

```ts
// Yup
import { yupAdapter } from 'shapeguard/adapters/yup'
import * as yup from 'yup'

const schema = yup.object({ email: yup.string().email().required() })

validate({ body: yupAdapter(schema) })
```

> **Note:** `defineRoute()` is Zod-only. For Joi/Yup pass schemas directly to `validate()`.

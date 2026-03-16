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

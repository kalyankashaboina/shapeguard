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

Migration guide will be published when v0.3.0 ships.
Track progress in [CHANGELOG.md](./CHANGELOG.md).

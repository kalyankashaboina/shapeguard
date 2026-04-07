---
title: Add shapeguard to an existing app
description: How to adopt shapeguard incrementally — one feature at a time, zero rewrites.
---

# Add shapeguard to an existing app

You do not need to rewrite your routes. shapeguard is designed for incremental adoption.

## Step 1 — Add logging and requestId (5 minutes)

Mount `shapeguard()` once. Every existing route gets structured logging immediately.

```ts
import { shapeguard } from 'shapeguard'

app.use(shapeguard())
// ← all existing routes unchanged, now logged automatically
```

## Step 2 — Replace your error handler (10 minutes)

```ts
import { AppError, errorHandler, notFoundHandler } from 'shapeguard'

// Replace your existing 404/error handlers:
app.use(notFoundHandler())  // at the bottom, before error handler
app.use(errorHandler())     // always last

// Now throw AppError anywhere instead of returning error responses:
throw AppError.notFound('User')
throw AppError.unauthorized('Token expired')
```

## Step 3 — Add validation to one route (15 minutes)

Pick one route. Add validation. The rest stays the same.

```ts
import { z } from 'zod'
import { defineRoute, handle, createDTO } from 'shapeguard'

const CreateUserRoute = defineRoute({
  body: createDTO(z.object({ email: z.string().email(), name: z.string() })),
})

// Replace your existing route handler:
router.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body is now typed and validated
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))
```

## Step 4 — Add Swagger docs without touching routes (2 minutes)

```ts
import { generateOpenAPI, serveScalar } from 'shapeguard/openapi'

const spec = generateOpenAPI({
  title:   'My API',
  version: '1.0.0',
  routes: {
    'POST /users': { summary: 'Create user', tags: ['Users'] },
    'GET  /users': { summary: 'List users',  tags: ['Users'] },
    // describe existing routes — they don't need to change
  },
})

app.use('/docs', serveScalar(spec))
// → http://localhost:3000/docs
```

That's it. Your existing routes are completely untouched.

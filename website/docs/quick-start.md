---
sidebar_label: '⚡ Quick start'
sidebar_position: 1
title: Quick start
description: Get shapeguard running in under 2 minutes — validation, logging, and error handling for Express.
---

# Quick start

## Install

```bash
npm install shapeguard zod
```

```bash
# Optional — structured production logging
npm install pino pino-pretty
```

## Minimal setup

```ts
import express from 'express'
import { shapeguard, notFoundHandler, errorHandler } from 'shapeguard'

const app = express()
app.use(express.json())
app.use(shapeguard())       // structured logging + requestId + security guards
app.use('/api', yourRouter)
app.use(notFoundHandler())  // 404 for unmatched routes
app.use(errorHandler())     // catches everything thrown anywhere — must be last
app.listen(3000)
```

That's the entire setup. Every feature is opt-in from here.

## Add validation to a route

```ts
import { z } from 'zod'
import { defineRoute, handle, createDTO } from 'shapeguard'

const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
}))

// Response schema — fields not listed here are automatically stripped
const UserResponse = z.object({
  id:    z.string().uuid(),
  email: z.string(),
  name:  z.string(),
  // password is NOT here — never sent to clients
})

const CreateUserRoute = defineRoute({ body: CreateUserDTO, response: UserResponse })

router.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body: { email: string, name: string, password: string } — fully typed
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))
```

## Throw errors anywhere

```ts
import { AppError } from 'shapeguard'

throw AppError.notFound('User')          // 404
throw AppError.unauthorized('Expired')   // 401
throw AppError.conflict('Email taken')   // 409
throw AppError.custom('PAY_FAIL', 'Insufficient funds', 402)
```

Every error — validation failure, thrown `AppError`, or unexpected crash — produces the same JSON shape. Clients get consistent responses everywhere.

## What's next

- [Validation →](./validation) — `defineRoute()`, `createDTO()`, adapters
- [Errors →](./errors) — `AppError`, all factories, `errorHandler()` config
- [Logging →](./logging) — pino, redaction, requestId, bring your own logger
- [OpenAPI →](./openapi) — generate spec, Scalar/Swagger/Redoc, export to Postman

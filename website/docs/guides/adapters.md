---
title: Joi / Yup / Winston adapters
description: How to use shapeguard with Joi for validation, Yup for validation, or Winston for logging.
---

# Adapters

shapeguard's primary validation library is Zod. Adapters let you use Joi, Yup, or Winston instead.

## Joi adapter

```bash
npm install joi
```

```ts
import Joi from 'joi'
import { joiAdapter } from 'shapeguard/adapters/joi'
import { defineRoute } from 'shapeguard'

const schema = Joi.object({
  email: Joi.string().email().required(),
  name:  Joi.string().min(1).max(100).required(),
})

const CreateUserRoute = defineRoute({
  body: joiAdapter(schema),         // allErrors:true by default — all errors returned
  // body: joiAdapter(schema, { allErrors: false }) — stop at first error
})
```

## Yup adapter

```bash
npm install yup
```

```ts
import * as yup from 'yup'
import { yupAdapter } from 'shapeguard/adapters/yup'
import { defineRoute } from 'shapeguard'

const schema = yup.object({
  email: yup.string().email().required(),
  name:  yup.string().min(1).max(100).required(),
})

const CreateUserRoute = defineRoute({
  body: yupAdapter(schema),
})
```

## Winston adapter

If you have an existing Winston logger, wrap it so shapeguard uses it instead of pino:

```bash
npm install winston
```

```ts
import winston from 'winston'
import { winstonAdapter } from 'shapeguard/adapters/winston'
import { shapeguard } from 'shapeguard'

const wLogger = winston.createLogger({
  transports: [new winston.transports.Console()],
})

app.use(shapeguard({
  logger: { instance: winstonAdapter(wLogger) },
}))
```

Winston expects `logger.info(message, meta)`. shapeguard calls `logger.info(meta, message)`.
The adapter flips argument order so Winston receives them correctly.

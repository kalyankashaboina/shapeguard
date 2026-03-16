// ─────────────────────────────────────────────
// app.ts — shapeguard mounted once here.
// ─────────────────────────────────────────────

import express from 'express'
import { shapeguard, notFoundHandler, errorHandler } from 'shapeguard'
import userRouter from './routes/user.routes.js'

const app = express()

app.use(express.json())

app.use(shapeguard({
  validation: {
    strings: { trim: true },       // auto-trim all string fields globally
  },
  response: {
    includeRequestId: true,        // X-Request-Id on every response
  },
  logger: {
    logAllRequests: true,
    slowThreshold:  1000,
  },
}))

app.use('/api/users', userRouter)

app.use(notFoundHandler())
app.use(errorHandler())

const PORT = process.env['PORT'] ?? 3000
app.listen(PORT, () => {
  console.log(`shapeguard basic-crud-api → http://localhost:${PORT}`)
  console.log('')
  console.log('Try it:')
  console.log(`  POST   http://localhost:${PORT}/api/users`)
  console.log(`  GET    http://localhost:${PORT}/api/users`)
  console.log(`  GET    http://localhost:${PORT}/api/users/:id`)
  console.log(`  PUT    http://localhost:${PORT}/api/users/:id`)
  console.log(`  DELETE http://localhost:${PORT}/api/users/:id`)
})

export default app

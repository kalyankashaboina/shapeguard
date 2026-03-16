// ─────────────────────────────────────────────────────────────────────────────
// examples/global-config
//
// Shows all v0.2.0 global configuration options:
//   1. validation.strings.trim     — auto-trim all string fields
//   2. validation.strings.lowercase — auto-lowercase all string fields
//   3. logger.silent               — suppress all logs (useful in tests)
//   4. response.includeRequestId   — X-Request-Id on every response
//   5. requestId.generator         — custom request ID format
//
// Run:  npx tsx src/index.ts
// Try:
//   # Strings auto-trimmed and lowercased
//   curl -X POST http://localhost:3000/users \
//     -H "Content-Type: application/json" \
//     -d '{"email":"  ALICE@EXAMPLE.COM  ","name":"  Alice  "}'
//
//   # Check X-Request-Id header in response
//   curl -v http://localhost:3000/ping 2>&1 | grep -i request-id
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { z } from 'zod'
import {
  shapeguard,
  createDTO,
  defineRoute,
  handle,
  notFoundHandler,
  errorHandler,
} from 'shapeguard'

// ── Schemas ───────────────────────────────────────────────────────────────────
const CreateUserDTO = createDTO(z.object({
  email: z.string().email(),
  name:  z.string().min(1),
}))

const CreateUserRoute = defineRoute({ body: CreateUserDTO })

// ── App — shows global config options ────────────────────────────────────────
const app = express()
app.use(express.json())

app.use(shapeguard({

  // ── validation.strings ─────────────────────────────────────────────────────
  // Auto-trim + lowercase every string field in every schema — set once, done.
  // No more repeating .trim().toLowerCase() on each field.
  validation: {
    strings: {
      trim:      true,   // "  Alice  " → "Alice"
      lowercase: true,   // "ALICE@EXAMPLE.COM" → "alice@example.com"
    },
  },

  // ── response ───────────────────────────────────────────────────────────────
  response: {
    includeRequestId: true,  // X-Request-Id: req_... on every response
  },

  // ── requestId ──────────────────────────────────────────────────────────────
  requestId: {
    // Custom generator — your own format instead of the default req_<ts><random>
    generator: () => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  },

  // ── logger ─────────────────────────────────────────────────────────────────
  logger: {
    logAllRequests: true,
    slowThreshold:  500,  // warn on responses > 500ms
    // silent: true,      // ← uncomment to suppress all logs (great for tests)
  },

}))

// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body.email is already trimmed + lowercased — no manual cleanup needed
  res.created({
    data: {
      id:    crypto.randomUUID(),
      email: req.body.email,  // "  ALICE@EXAMPLE.COM  " → "alice@example.com"
      name:  req.body.name,   // "  Alice  " → "Alice"
    },
    message: 'User created',
  })
}))

app.get('/ping', (_req, res) => {
  res.ok({ data: { pong: true }, message: 'pong' })
  // Check response headers — X-Request-Id will be present
})

app.use(notFoundHandler())
app.use(errorHandler())

app.listen(3000, () => {
  console.log('global-config example → http://localhost:3000')
  console.log('')
  console.log('Configured:')
  console.log('  ✅ validation.strings.trim = true')
  console.log('  ✅ validation.strings.lowercase = true')
  console.log('  ✅ response.includeRequestId = true')
  console.log('  ✅ requestId.generator = custom format')
  console.log('')
  console.log('POST /users  — email + name auto-trimmed and lowercased')
  console.log('GET  /ping   — check X-Request-Id header in response')
})

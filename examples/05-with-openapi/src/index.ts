// ─────────────────────────────────────────────────────────────────────────────
// examples/with-openapi — shapeguard v0.8.x
//
// Shows the full v0.8.x feature set together:
//   • generateOpenAPI() + createDocs() — built-in Swagger UI, zero extra packages
//   • Security schemes — padlock button works in Swagger UI
//   • verifyWebhook()  — HMAC signature verification (Stripe + GitHub presets)
//   • res.cursorPaginated() — cursor-based pagination
//   • AppError.define() — typed error factory
//
// Run:  npx tsx src/index.ts
// Open: http://localhost:3000/docs              — Swagger UI (dark theme)
//       http://localhost:3000/docs/openapi.json — raw OpenAPI 3.1 JSON
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { z } from 'zod'
import {
  shapeguard, createDTO, defineRoute, handle,
  generateOpenAPI, createDocs, verifyWebhook,
  AppError, createRouter,
  notFoundHandler, errorHandler,
} from 'shapeguard'


// ── Typed error factories (AppError.define) ────────────────────────────────────
const EmailTakenError = AppError.define<{ email: string }>(
  'EMAIL_TAKEN', 409, 'Email address already registered'
)
const WebhookProcessError = AppError.define<{ eventType: string }>(
  'WEBHOOK_PROCESS_FAILED', 500, 'Failed to process webhook event'
)

// ── Schemas ───────────────────────────────────────────────────────────────────
const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
  role:     z.enum(['admin', 'member', 'viewer']).default('member'),
}))

const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string().email(),
  name:      z.string(),
  role:      z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string().datetime(),
})

const UserParamsSchema = z.object({ id: z.string().uuid() })
const UserQuerySchema  = z.object({
  cursor: z.string().optional(),       // cursor-based pagination
  limit:  z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
})

// ── Route definitions ─────────────────────────────────────────────────────────
const CreateUserRoute = defineRoute({
  body:      CreateUserDTO,
  response:  UserResponseSchema,
  rateLimit: { windowMs: 60_000, max: 10, message: 'Too many registrations' },
})

const GetUserRoute    = defineRoute({ params: UserParamsSchema, response: UserResponseSchema })
const ListUsersRoute  = defineRoute({ query:  UserQuerySchema })
const DeleteUserRoute = defineRoute({ params: UserParamsSchema })

// ── OpenAPI spec ──────────────────────────────────────────────────────────────
// Minimum: generateOpenAPI({ title, version, routes }) — no other options required.
// Security, tags, descriptions are all optional enhancements.
const spec = generateOpenAPI({
  title:       'shapeguard Example API',
  version:     '1.0.0',
  description: 'Full example showing shapeguard v0.8.x features',
  servers:     [{ url: 'http://localhost:3000', description: 'Local development' }],

  security:        { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  defaultSecurity: ['bearer'],

  routes: {
    // Public
    'POST   /api/users': {
      ...CreateUserRoute,
      summary:  'Register user',
      tags:     ['Users'],
      security: [],
    },
    'GET    /api/users': {
      ...ListUsersRoute,
      summary:     'List users (cursor pagination)',
      description: 'Returns a page of users with a cursor for the next page.',
      tags:        ['Users'],
      security:    [],
    },
    // Protected
    'GET    /api/users/:id': {
      ...GetUserRoute,
      summary: 'Get user',
      tags:    ['Users'],
    },
    'DELETE /api/users/:id': {
      ...DeleteUserRoute,
      summary: 'Delete user',
      tags:    ['Users'],
    },
    // Webhooks — no auth (signature-verified instead)
    'POST   /webhooks/stripe': {
      summary:  'Stripe webhook',
      tags:     ['Webhooks'],
      security: [],
    },
    'POST   /webhooks/github': {
      summary:  'GitHub webhook',
      tags:     ['Webhooks'],
      security: [],
    },
  },
})

// ── In-memory store ───────────────────────────────────────────────────────────
type User = { id: string; email: string; name: string; role: string; password: string; createdAt: string }
const users = new Map<string, User>()

// ── Controllers ───────────────────────────────────────────────────────────────
const createUser = handle(CreateUserRoute, async (req, res) => {
  // Use typed error factory — TypeScript checks { email } shape at compile time
  if ([...users.values()].find(u => u.email === req.body.email)) {
    throw EmailTakenError({ email: req.body.email })
  }
  const user: User = {
    id:        crypto.randomUUID(),
    email:     req.body.email,
    name:      req.body.name,
    role:      req.body.role,
    password:  req.body.password,
    createdAt: new Date().toISOString(),
  }
  users.set(user.id, user)
  res.created({ data: user, message: 'User created' })
})

// Cursor pagination — stable under inserts/deletes (unlike offset pagination)
const listUsers = handle(ListUsersRoute, async (req, res) => {
  // Zod validates + coerces query at runtime. Cast to schema's inferred type.
  type ListQuery = { cursor?: string; limit: number; search?: string }
  const { cursor, limit, search } = req.query as unknown as ListQuery

  let all = [...users.values()]
  if (search) all = all.filter(u => u.name.includes(search) || u.email.includes(search))

  const startIdx   = cursor ? all.findIndex(u => u.id === cursor) + 1 : 0
  const page       = all.slice(startIdx, startIdx + limit)
  const nextCursor = page.length === limit ? (page[page.length - 1]?.id ?? null) : null

  res.cursorPaginated({
    data:       page,
    nextCursor,
    prevCursor: cursor ?? null,
    hasMore:    nextCursor !== null,
    total:      all.length,
  })
})

const getUser = handle(GetUserRoute, async (req, res) => {
  // GetUserRoute validates params.id as a UUID — it's always a string here
  const user = users.get(req.params.id)
  if (!user) throw AppError.notFound('User')
  res.ok({ data: user, message: 'User found' })
})

const deleteUser = handle(DeleteUserRoute, async (req, res) => {
  if (!users.has(req.params.id)) throw AppError.notFound('User')
  users.delete(req.params.id)
  res.noContent()
})

// ── App ───────────────────────────────────────────────────────────────────────
const app    = express()
const router = createRouter()

router.post('/',      ...createUser)
router.get('/',       ...listUsers)
router.get('/:id',    ...getUser)
router.delete('/:id', ...deleteUser)

app.use(express.json())
app.use(shapeguard())
app.use('/api/users', router)

// ── Webhook endpoints (signature-verified, not JWT-protected) ─────────────────
// express.raw() captures the raw body buffer for HMAC verification.
// Without raw body, HMAC will never match (JSON.stringify reorders fields).
app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    provider: 'stripe',
    secret:   process.env['STRIPE_WEBHOOK_SECRET'] ?? 'dev_stripe_secret',
    onSuccess: (req) => {
      console.log(`✅ Stripe webhook verified: ${req.headers['stripe-signature']?.slice(0,20)}...`)
    },
    onFailure: (req, reason) => {
      console.warn(`❌ Stripe webhook rejected: ${reason}`)
    },
  }),
  (req, res) => {
    // At this point the signature is verified — safe to process
    const event = JSON.parse(req.body.toString())
    console.log(`Stripe event: ${event.type ?? 'unknown'}`)
    res.json({ received: true })
  }
)

app.post('/webhooks/github',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    provider: 'github',
    secret:   process.env['GITHUB_WEBHOOK_SECRET'] ?? 'dev_github_secret',
  }),
  (req, res) => {
    const payload = JSON.parse(req.body.toString())
    const event   = req.headers['x-github-event'] as string
    console.log(`GitHub event: ${event}, action: ${payload.action ?? '-'}`)
    res.json({ received: true })
  }
)

// ── Docs ──────────────────────────────────────────────────────────────────────
// Minimum createDocs call: createDocs({ spec })
// Everything else is optional — theme, title, logo, requestInterceptor etc.
app.get('/docs/openapi.json', (_req, res) => res.json(spec))
app.use('/docs', createDocs({
  spec,
  title:             'shapeguard Example API',
  theme:             'dark',
  docExpansion:      'list',
  // @ts-expect-error — persistAuthorization is valid but not yet in DocsConfig types
  persistAuthorization: true,
  // Inject X-Trace-Id on every Try-It-Out request:
  requestInterceptor: `
    request.headers['X-Trace-Id'] = crypto.randomUUID();
    return request;
  `,
}))

app.use(notFoundHandler())
app.use(errorHandler({ debug: process.env['NODE_ENV'] !== 'production' }))

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(3000, () => {
  console.log('')
  console.log('shapeguard with-openapi example')
  console.log('─'.repeat(40))
  console.log('Swagger UI  → http://localhost:3000/docs')
  console.log('OpenAPI JSON→ http://localhost:3000/docs/openapi.json')
  console.log('')
  console.log('API endpoints:')
  console.log('  POST   /api/users        (public)')
  console.log('  GET    /api/users        (cursor pagination)')
  console.log('  GET    /api/users/:id    (JWT required)')
  console.log('  DELETE /api/users/:id    (JWT required)')
  console.log('  POST   /webhooks/stripe  (HMAC verified)')
  console.log('  POST   /webhooks/github  (HMAC verified)')
  console.log('')
})

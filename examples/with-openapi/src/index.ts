// ─────────────────────────────────────────────────────────────────────────────
// examples/with-openapi — v0.7.0
// Shows generateOpenAPI() with security schemes + createDocs() Swagger UI.
// Your defineRoute() definitions become your API spec — zero duplication.
//
// Run: npx tsx src/index.ts
// Open: http://localhost:3000/docs          — Swagger UI (dark theme)
// Open: http://localhost:3000/docs/openapi.json — raw spec JSON
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { z } from 'zod'
import {
  shapeguard, createDTO, defineRoute, handle,
  generateOpenAPI, createDocs, AppError, createRouter,
  notFoundHandler, errorHandler,
} from 'shapeguard'

// ── Schemas ───────────────────────────────────────────────────────────────────
const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
  role:     z.enum(['admin', 'member', 'viewer']),
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
  page:   z.coerce.number().min(1).default(1),
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
const UpdateUserRoute = defineRoute({ params: UserParamsSchema, body: CreateUserDTO, response: UserResponseSchema })
const DeleteUserRoute = defineRoute({ params: UserParamsSchema })

// ── OpenAPI spec ──────────────────────────────────────────────────────────────
// Security schemes: the padlock button in Swagger UI is now fully functional.
// defaultSecurity applies bearer to every route; override per-route via security: []
const spec = generateOpenAPI({
  title:       'shapeguard Users API',
  version:     '1.0.0',
  description: 'Example API showing auto-generated OpenAPI spec with security schemes',
  servers:     [{ url: 'http://localhost:3000', description: 'Local development' }],

  security: {
    bearer: {
      type:         'http',
      scheme:       'bearer',
      bearerFormat: 'JWT',
    },
  },
  defaultSecurity: ['bearer'],

  routes: {
    // Public endpoints — no auth required
    'POST   /api/users': { ...CreateUserRoute, summary: 'Register',   tags: ['Users'], security: [] },
    'GET    /api/users': { ...ListUsersRoute,  summary: 'List users', tags: ['Users'], security: [] },

    // Protected endpoints — require bearer JWT
    'GET    /api/users/:id': { ...GetUserRoute,    summary: 'Get user',    tags: ['Users'] },
    'PUT    /api/users/:id': { ...UpdateUserRoute, summary: 'Update user', tags: ['Users'] },
    'DELETE /api/users/:id': { ...DeleteUserRoute, summary: 'Delete user', tags: ['Users'] },
  },
})

// ── In-memory store ───────────────────────────────────────────────────────────
type User = { id: string; email: string; name: string; role: string; password: string; createdAt: string }
const users = new Map<string, User>()

// ── Controllers ───────────────────────────────────────────────────────────────
const createUser = handle(CreateUserRoute, async (req, res) => {
  if ([...users.values()].find(u => u.email === req.body.email)) throw AppError.conflict('Email')
  const user: User = { id: crypto.randomUUID(), ...req.body, createdAt: new Date().toISOString() }
  users.set(user.id, user)
  res.created({ data: user, message: 'User created' })
})

const listUsers = handle(ListUsersRoute, async (req, res) => {
  const all = [...users.values()]
  res.paginated({ data: all, total: all.length, page: req.query.page, limit: req.query.limit })
})

const getUser = handle(GetUserRoute, async (req, res) => {
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

// Raw spec JSON — import into Postman, Insomnia, Stoplight, etc.
app.get('/docs/openapi.json', (_req, res) => res.json(spec))

// Swagger UI — dark theme, padlock works, no extra npm packages needed
app.use('/docs', createDocs({ spec, title: 'shapeguard Users API', theme: 'dark' }))

app.use(notFoundHandler())
app.use(errorHandler())

app.listen(3000, () => {
  console.log('with-openapi example → http://localhost:3000')
  console.log('Swagger UI → http://localhost:3000/docs')
  console.log('OpenAPI JSON → http://localhost:3000/docs/openapi.json')
  console.log()
  console.log('Click the padlock in Swagger UI and enter a JWT to test protected routes.')
})

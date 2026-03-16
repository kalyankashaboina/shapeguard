// ─────────────────────────────────────────────────────────────────────────────
// examples/with-openapi
// Shows generateOpenAPI() — zero manual schema duplication.
// Your defineRoute() definitions become your API spec.
//
// Run: npx tsx src/index.ts
// Open: http://localhost:3000/docs/openapi.json
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { z } from 'zod'
import {
  shapeguard, createDTO, defineRoute, handle,
  generateOpenAPI, AppError, createRouter,
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

// ── OpenAPI spec — generated from route definitions, zero duplication ──────────
const spec = generateOpenAPI({
  title:       'shapeguard Users API',
  version:     '1.0.0',
  description: 'Example API showing auto-generated OpenAPI spec from defineRoute() definitions',
  servers:     [{ url: 'http://localhost:3000', description: 'Local development' }],
  routes: {
    'POST   /api/users':     CreateUserRoute,
    'GET    /api/users':     ListUsersRoute,
    'GET    /api/users/:id': GetUserRoute,
    'PUT    /api/users/:id': UpdateUserRoute,
    'DELETE /api/users/:id': DeleteUserRoute,
  }
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

router.post('/',    ...createUser)
router.get('/',     ...listUsers)
router.get('/:id',  ...getUser)
router.delete('/:id', ...deleteUser)

app.use(express.json())
app.use(shapeguard())
app.use('/api/users', router)
app.get('/docs/openapi.json', (_req, res) => res.json(spec))
app.use(notFoundHandler())
app.use(errorHandler())

app.listen(3000, () => {
  console.log('with-openapi example → http://localhost:3000')
  console.log('OpenAPI spec → http://localhost:3000/docs/openapi.json')
  console.log('Import the JSON into Postman or Insomnia for instant API testing')
})

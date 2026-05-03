// ─────────────────────────────────────────────
// validators/user.validator.ts
// Single source of truth for all user schemas,
// route definitions, and inferred types.
// ─────────────────────────────────────────────

import { z } from 'zod'
import { defineRoute, createDTO } from 'shapeguard'

// ── params ────────────────────────────────────
const UserParamsSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID'),
})

// ── query ─────────────────────────────────────
const UserQuerySchema = z.object({
  page:   z.coerce.number().min(1).default(1),
  limit:  z.coerce.number().min(1).max(100).default(20),
  role:   z.enum(['admin', 'member', 'viewer']).optional(),
  search: z.string().max(100).optional(),
})

// ── DTOs ──────────────────────────────────────
// createDTO(z.object(...)) — same as z.object() but with auto type inference.
// No manual z.infer<typeof ...> needed.

export const CreateUserDTO = createDTO(z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
  role:     z.enum(['admin', 'member', 'viewer']),
}))

export const UpdateUserDTO = createDTO(z.object({
  name:     z.string().min(1).max(100).optional(),
  role:     z.enum(['admin', 'member', 'viewer']).optional(),
  password: z.string().min(8).optional(),
}))

// ── response ──────────────────────────────────
// Fields NOT listed here are stripped before the client sees them.
// passwordHash, stripeCustomerId — gone automatically.
const UserResponseSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string(),
  name:      z.string(),
  role:      z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

// ── route definitions ─────────────────────────
export const CreateUserRoute = defineRoute({
  body:      CreateUserDTO,         // ← DTO passed directly — it IS a SchemaAdapter
  response:  UserResponseSchema,
  // transform: runs AFTER validation, BEFORE the handler
  // Service receives already-hashed password — stays pure
  transform: async (data: unknown) => {
    const d = data as { email: string; name: string; password: string; role: string }
    // Simulated hash (replace with: const hash = await bcrypt.hash(d.password, 10))
    const hash = `bcrypt_hashed:${d.password}`
    return { ...d, password: hash }
  },
})

export const GetUserRoute = defineRoute({
  params:   UserParamsSchema,
  response: UserResponseSchema,
})

export const UpdateUserRoute = defineRoute({
  params:    UserParamsSchema,
  body:      UpdateUserDTO,
  response:  UserResponseSchema,
  transform: async (data: unknown) => {
    const d = data as { name?: string; role?: string; password?: string }
    if (!d.password) return d
    // Simulated hash (replace with: const hash = await bcrypt.hash(d.password, 10))
    const hash = `bcrypt_hashed:${d.password}`
    return { ...d, password: hash }
  },
})

export const DeleteUserRoute = defineRoute({
  params: UserParamsSchema,
})

export const ListUsersRoute = defineRoute({
  query:    UserQuerySchema,
  response: z.object({ users: z.array(UserResponseSchema) }),
})

// ── inferred types ────────────────────────────
// typeof DTO.Input gives the type — no z.infer needed
export type CreateUserBody = typeof CreateUserDTO.Input
export type UpdateUserBody = typeof UpdateUserDTO.Input
export type UserParams     = z.infer<typeof UserParamsSchema>
export type UserQuery      = z.infer<typeof UserQuerySchema>
export type UserResponse   = z.infer<typeof UserResponseSchema>

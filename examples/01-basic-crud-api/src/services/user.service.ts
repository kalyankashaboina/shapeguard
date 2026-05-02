// ─────────────────────────────────────────────
// services/user.service.ts
// Pure business logic. No shapeguard imports here.
// Password is already hashed when it arrives —
// the transform hook in defineRoute() handles it.
// ─────────────────────────────────────────────

import { randomUUID } from 'crypto'
import { AppError } from 'shapeguard'
import type { CreateUserBody, UpdateUserBody, UserResponse, UserQuery } from '../validators/user.validator.js'

// In-memory store — replace with your DB of choice
const users = new Map<string, UserResponse & { password: string }>()

export const UserService = {

  async create(data: CreateUserBody): Promise<UserResponse> {
    const exists = [...users.values()].find(u => u.email === data.email)
    if (exists) throw AppError.conflict('Email')

    const now  = new Date().toISOString()
    const user = {
      id:        randomUUID(),
      email:     data.email,
      name:      data.name,
      role:      data.role,
      password:  data.password,  // already hashed by transform hook
      createdAt: now,
      updatedAt: now,
    }
    users.set(user.id, user)
    return user
  },

  async findById(id: string): Promise<UserResponse> {
    const user = users.get(id)
    if (!user) throw AppError.notFound('User')
    return user
  },

  async list(query: UserQuery): Promise<{ users: UserResponse[]; total: number }> {
    let all = [...users.values()]

    if (query.role)   all = all.filter(u => u.role === query.role)
    if (query.search) all = all.filter(u =>
      u.name.toLowerCase().includes(query.search!.toLowerCase()) ||
      u.email.toLowerCase().includes(query.search!.toLowerCase())
    )

    const total = all.length
    const start = (query.page - 1) * query.limit
    return { users: all.slice(start, start + query.limit), total }
  },

  async update(id: string, data: UpdateUserBody): Promise<UserResponse> {
    const user = users.get(id)
    if (!user) throw AppError.notFound('User')

    const updated = {
      ...user,
      ...data,
      updatedAt: new Date().toISOString(),
    }
    users.set(id, updated)
    return updated
  },

  async delete(id: string): Promise<void> {
    if (!users.has(id)) throw AppError.notFound('User')
    users.delete(id)
  },

}

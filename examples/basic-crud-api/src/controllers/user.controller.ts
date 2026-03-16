// ─────────────────────────────────────────────
// controllers/user.controller.ts
// Uses handle() — validate + asyncHandler in one call.
// No [validate(), asyncHandler()] arrays anywhere.
// ─────────────────────────────────────────────

import { handle, AppError } from 'shapeguard'
import {
  CreateUserRoute,
  GetUserRoute,
  UpdateUserRoute,
  DeleteUserRoute,
  ListUsersRoute,
} from '../validators/user.validator.js'
import { UserService } from '../services/user.service.js'

export const UserController = {

  // POST /api/users
  // Body is validated + password hashed (by transform hook) before this runs
  createUser: handle(CreateUserRoute, async (req, res) => {
    const user = await UserService.create(req.body)
    res.created({ data: user, message: 'User created' })
  }),

  // GET /api/users/:id
  getUser: handle(GetUserRoute, async (req, res) => {
    const user = await UserService.findById(req.params.id)
    res.ok({ data: user, message: 'User found' })
  }),

  // GET /api/users
  listUsers: handle(ListUsersRoute, async (req, res) => {
    const { users, total } = await UserService.list(req.query)
    res.paginated({ data: users, total, page: req.query.page, limit: req.query.limit })
  }),

  // PUT /api/users/:id
  updateUser: handle(UpdateUserRoute, async (req, res) => {
    const user = await UserService.update(req.params.id, req.body)
    res.ok({ data: user, message: 'User updated' })
  }),

  // DELETE /api/users/:id
  deleteUser: handle(DeleteUserRoute, async (req, res) => {
    await UserService.delete(req.params.id)
    res.noContent()
  }),

}

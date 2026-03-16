// ─────────────────────────────────────────────
// routes/user.routes.ts
// createRouter() is a drop-in for express.Router().
// Wrong HTTP methods return 405 with Allow header
// automatically — no router.all() needed.
// ─────────────────────────────────────────────

import { createRouter } from 'shapeguard'
import { UserController } from '../controllers/user.controller.js'

const router = createRouter()

// Collection routes — /api/users
router.post('/',  ...UserController.createUser)   // POST   /api/users
router.get('/',   ...UserController.listUsers)    // GET    /api/users
// PUT /api/users  → 405, Allow: GET, POST — automatic

// Resource routes — /api/users/:id
router.get('/:id',    ...UserController.getUser)    // GET    /api/users/:id
router.put('/:id',    ...UserController.updateUser) // PUT    /api/users/:id
router.delete('/:id', ...UserController.deleteUser) // DELETE /api/users/:id
// PATCH /api/users/:id → 405, Allow: GET, PUT, DELETE — automatic

export default router

// ─────────────────────────────────────────────
// router/define-group.ts — shapeguard
// defineGroup() — co-locate related routes with shared prefix + middleware.
// Cleaner than repeating app.use() + router per feature.
//
// Usage:
//   const usersGroup = defineGroup('/users', {
//     middleware: [requireAuth, requireAdmin],
//     routes: (r) => {
//       r.get('/',    ...handle(ListUsersRoute,  listUsers))
//       r.post('/',   ...handle(CreateUserRoute, createUser))
//       r.get('/:id', ...handle(GetUserRoute,    getUser))
//     },
//   })
//   app.use(usersGroup)
// ─────────────────────────────────────────────

import { Router as ExpressRouter } from 'express'
import type { Router, RouterOptions, RequestHandler } from 'express'
import { createRouter } from './create-router.js'

export interface RouteGroupOptions {
  /**
   * Middleware applied to every route in the group before the route handler.
   * Perfect for auth guards, rate limiters, audit logging etc.
   *
   * @example
   * middleware: [requireBearerToken, requireRole('admin')]
   */
  middleware?: RequestHandler[]

  /**
   * Function that registers routes on the group's router.
   * Use shapeguard's `createRouter()` methods — 405 handling is built in.
   *
   * @example
   * routes: (r) => {
   *   r.get('/',    ...handle(ListRoute,   listHandler))
   *   r.post('/',   ...handle(CreateRoute, createHandler))
   * }
   */
  routes: (router: Router) => void

  /**
   * Options forwarded to express.Router().
   * @example { strict: true }
   */
  routerOptions?: RouterOptions
}

/**
 * Group related routes under a shared URL prefix and middleware stack.
 * Returns an Express Router ready to mount with `app.use()`.
 *
 * Benefits over raw express.Router():
 * - Middleware declared once, applied to all routes in the group
 * - Routes registered via shapeguard's createRouter() — 405 automatic
 * - Flat, readable structure — no nested app.use() chains
 *
 * @example
 * // src/routes/users.ts
 * export const usersGroup = defineGroup('/users', {
 *   middleware: [requireBearerToken],
 *   routes: (r) => {
 *     r.get('/',    ...handle(ListUsersRoute,  listUsers))
 *     r.post('/',   ...handle(CreateUserRoute, createUser))
 *     r.get('/:id', ...handle(GetUserRoute,    getUser))
 *     r.put('/:id', ...handle(UpdateUserRoute, updateUser))
 *   },
 * })
 *
 * // src/app.ts
 * app.use(usersGroup)
 * app.use(postsGroup)
 * app.use(authGroup)
 */
export function defineGroup(
  prefix:  string,
  options: RouteGroupOptions,
): Router {
  const { middleware = [], routes, routerOptions } = options

  // Outer router — holds the prefix mount
  const outer  = ExpressRouter(routerOptions)
  // Inner router — the one routes are registered on, has 405 tracking
  const inner  = createRouter(routerOptions)

  // Apply group middleware before all routes in this group
  if (middleware.length > 0) {
    inner.use(...middleware)
  }

  // Let the caller register routes on the inner (405-aware) router
  routes(inner)

  // Mount inner at the prefix on the outer router
  outer.use(prefix, inner)

  return outer
}

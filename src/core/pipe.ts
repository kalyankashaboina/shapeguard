// ─────────────────────────────────────────────
// core/pipe.ts — shapeguard
// pipe() — compose multiple middleware into one, executed left-to-right.
// Each middleware must call next() to proceed. If any throws or calls next(err)
// the chain stops and errorHandler picks it up.
//
// Usage:
//   const secured = pipe(requireAuth, rateLimit(10), validate(RouteSchema))
//   router.post('/users', ...secured, handler)
// ─────────────────────────────────────────────

import type { RequestHandler } from 'express'

/**
 * Compose multiple middleware into a single middleware array.
 * Executes left-to-right. Any thrown error or next(err) stops the chain.
 *
 * @example
 * // Share an auth+rate-limit guard across routes
 * const guard = pipe(
 *   requireBearerToken,
 *   defineRoute({ rateLimit: { windowMs: 60_000, max: 100 } }),
 * )
 *
 * router.get('/users',    ...handle(pipe(guard, GetUsersRoute),    listUsers))
 * router.post('/users',   ...handle(pipe(guard, CreateUserRoute),  createUser))
 * router.delete('/users', ...handle(pipe(guard, DeleteUserRoute),  deleteUser))
 */
export function pipe(...middleware: (RequestHandler | RequestHandler[])[]): RequestHandler[] {
  // Flatten any nested arrays (e.g. from handle() or validate())
  return middleware.flat()
}

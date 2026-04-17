// ─────────────────────────────────────────────
// validation/handle.ts — shapeguard
// handle() = validate() + asyncHandler() in one call.
// Replaces the two-element array pattern on every route.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { RouteSchema } from '../types/index.js'
import { validate, type ValidateOptions } from './validate.js'
import { asyncHandler } from '../errors/not-found.js'

// asyncHandler requires Promise<void> return type.
// We accept void too (for sync handlers) and cast at the call site.
type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void

/**
 * Combines validate() + asyncHandler() into a single call.
 *
 * Before (v0.1.x):
 *   export const createUser = [
 *     validate(CreateUserRoute),
 *     asyncHandler(async (req, res) => { ... })
 *   ]
 *
 * After (v0.2.0):
 *   export const createUser = handle(CreateUserRoute, async (req, res) => { ... })
 *
 * Spread into router exactly the same way:
 *   router.post('/', ...createUser)
 *
 * The returned array has a `cleanup()` method for stopping the rate-limit
 * store interval in tests or when the route is deregistered:
 *   const route = handle(CreateUserRoute, handler)
 *   // later:
 *   route.cleanup()
 */
export function handle(
  schema:  RouteSchema | ValidateOptions,
  handler: AsyncRouteHandler,
): RequestHandler[] & { cleanup: () => void } {
  const validateMiddleware = validate(schema)
  const middlewares        = [validateMiddleware, asyncHandler(handler as (req: Request, res: Response, next: NextFunction) => Promise<void>)]
  const result             = middlewares as RequestHandler[] & { cleanup: () => void }
  result.cleanup = () => validateMiddleware.cleanup()
  return result
}

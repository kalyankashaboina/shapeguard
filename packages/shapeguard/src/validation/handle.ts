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


export function handle(
  schema:  RouteSchema | ValidateOptions,
  handler: AsyncRouteHandler,
): RequestHandler[] {
  const validateMiddleware = validate(schema)

  return [validateMiddleware, asyncHandler(handler as (req: Request, res: Response, next: NextFunction) => Promise<void>)]
}

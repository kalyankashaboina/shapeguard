// ─────────────────────────────────────────────
// errors/not-found.ts — shapeguard
// 404 handler for unmatched routes.
// asyncHandler for Express 4 async safety.
// ─────────────────────────────────────────────

import type {
  Request, Response, NextFunction,
  RequestHandler,
} from 'express'
import { AppError } from './AppError.js'
import { ErrorCode } from '../types/index.js'

// ── notFoundHandler ───────────────────────────
// Mount AFTER all routes, BEFORE errorHandler.
// Catches any request that matched no route → 404
export interface NotFoundOptions {
  message?: string
}

export function notFoundHandler(opts: NotFoundOptions = {}): RequestHandler {
  return function shapeguardNotFound(
    req:  Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const message = opts.message ?? `Cannot ${req.method} ${req.path}`
    // Use AppError directly — not AppError.notFound() which appends " not found"
    next(new AppError(ErrorCode.NOT_FOUND, message, 404))
  }
}

// ── asyncHandler ──────────────────────────────
// Express 4 does not catch async errors automatically.
// Wraps any async route handler — calls next(err) on rejection.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return function asyncHandlerWrapper(
    req:  Request,
    res:  Response,
    next: NextFunction,
  ): void {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

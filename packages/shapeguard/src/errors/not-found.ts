import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { AppError }  from './AppError.js'
import { ErrorCode } from '../types/index.js'

export interface NotFoundOptions {
  message?: string
}

export function notFoundHandler(opts: NotFoundOptions = {}): RequestHandler {
  return function shapeguardNotFound(req: Request, _res: Response, next: NextFunction): void {
    const message = opts.message ?? `Cannot ${req.method} ${req.path}`
    next(new AppError(ErrorCode.NOT_FOUND, message, 404))
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return function asyncHandlerWrapper(req: Request, res: Response, next: NextFunction): void {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

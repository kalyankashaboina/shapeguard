// ─────────────────────────────────────────────
// errors/error-handler.ts — shapeguard
// Centralised error middleware. Always last.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express'
import type { ErrorsConfig, ResponseConfig, Logger } from '../types/index.js'
import { ErrorCode } from '../types/index.js'
import { AppError, isAppError } from './AppError.js'
import { buildError } from '../core/response.js'
import { isDev } from '../core/env.js'

export interface ErrorHandlerOptions {
  errors?:   ErrorsConfig
  response?: ResponseConfig
  logger?:   Logger
  debug?:    boolean
}

export function errorHandler(opts: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const { errors = {}, response = {}, logger, debug = isDev } = opts
  const fallback = errors.fallbackMessage ?? 'Something went wrong'

  return function shapeguardErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    if (res.headersSent) return

    const appErr = isAppError(err) ? (err as AppError) : AppError.fromUnknown(err)
    const isProd = !debug

    if (logger) {
      const payload: Record<string, unknown> = {
        requestId: req.id, code: appErr.code,
        method: req.method, endpoint: req.route?.path ?? req.path, status: appErr.statusCode,
      }
      if (!appErr.isOperational || appErr.statusCode >= 500) {
        payload['stack']   = appErr.stack
        payload['message'] = appErr.message
        logger.error(payload, appErr.message)
      } else {
        logger.warn(payload, appErr.message)
      }
    }

    if (errors.onError) {
      try { errors.onError(appErr, req) } catch { /* hook must never crash server */ }
    }

    const clientMessage = (!appErr.isOperational && isProd) ? fallback : appErr.message
    const clientDetails = isProd
      ? (appErr.code === ErrorCode.VALIDATION_ERROR ? appErr.details : null)
      : appErr.details

    res.status(appErr.statusCode).json(
      buildError(appErr.code, clientMessage, clientDetails as never, false, response)
    )
  }
}

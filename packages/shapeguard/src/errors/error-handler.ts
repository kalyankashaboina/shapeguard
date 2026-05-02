// ─────────────────────────────────────────────
// errors/error-handler.ts — shapeguard
// Centralised error middleware. Always last.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express'
import type { ErrorsConfig, ResponseConfig, Logger } from '../types/index.js'
import { ErrorCode } from '../types/index.js'
import { AppError, isAppError } from './AppError.js'
import { SG_LOGGER_KEY } from '../core/constants.js'
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

    // BUG #5 FIX: auto-discover shapeguard's logger from app.locals when no
    // explicit logger was passed. shapeguard() stores its logger instance on
    // req.app.locals[SG_LOGGER_KEY] so errorHandler() picks it up automatically.
    // Explicit logger option still takes precedence — zero breaking changes.
    // Guard req.app existence for standalone / test usage where app is not attached.
    const activeLogger = logger ?? (req.app?.locals as Record<string, unknown> | undefined)?.[SG_LOGGER_KEY] as typeof logger | undefined

    if (activeLogger) {
      const payload: Record<string, unknown> = {
        requestId: req.id, code: appErr.code,
        method: req.method, endpoint: req.route?.path ?? req.path, status: appErr.statusCode,
      }
      if (!appErr.isOperational || appErr.statusCode >= 500) {
        payload['stack']   = appErr.stack
        payload['message'] = appErr.message
        activeLogger.error(payload, appErr.message)
      } else {
        activeLogger.warn(payload, appErr.message)
      }
    }

    if (errors.onError) {
      try {
        errors.onError(appErr, req)
      } catch (hookErr) {
        // Log hook failures so misconfigured Sentry/PagerDuty integrations are visible
        // Guard activeLogger — it may be undefined if no logger is configured
        activeLogger?.error(
          { hookErr: hookErr instanceof Error ? { message: hookErr.message, stack: hookErr.stack } : hookErr },
          '[shapeguard] errorHandler onError hook threw — check your hook implementation'
        )
      }
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

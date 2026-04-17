// ─────────────────────────────────────────────
// errors/error-handler.ts — shapeguard
// Centralised error middleware. Always last.
// Full async observability hooks for Sentry, Datadog, Rollbar, custom alerting.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express'
import type { ErrorsConfig, ResponseConfig, Logger, ErrorContext } from '../types/index.js'
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
  const reportOn = errors.reportOn ?? 'all'

  return function shapeguardErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    if (res.headersSent) return

    const originalError = err
    const appErr        = isAppError(err) ? (err as AppError) : AppError.fromUnknown(err)
    const isProd        = !debug

    // ── Discover logger ────────────────────────────────────────────────────
    const activeLogger = logger
      ?? (req.app?.locals as Record<string, unknown> | undefined)?.[SG_LOGGER_KEY] as Logger | undefined

    // ── Structured log ─────────────────────────────────────────────────────
    if (activeLogger) {
      const payload: Record<string, unknown> = {
        requestId: req.id,
        code:      appErr.code,
        method:    req.method,
        endpoint:  req.route?.path ?? req.path,
        status:    appErr.statusCode,
      }
      if (!appErr.isOperational || appErr.statusCode >= 500) {
        payload['stack']   = appErr.stack
        payload['message'] = appErr.message
        activeLogger.error(payload, appErr.message)
      } else {
        activeLogger.warn(payload, appErr.message)
      }
    }

    // ── Decide whether to fire observability hooks ─────────────────────────
    const shouldReport =
      reportOn === 'all'       ? true :
      reportOn === 'unhandled' ? !appErr.isOperational :
      reportOn === 'http5xx'   ? appErr.statusCode >= 500 :
                                 true

    // ── Observability hooks (async, fire-and-forget) ───────────────────────
    // Hooks run after the response is sent — never delay the client response.
    if (shouldReport && errors.onError) {
      void (async () => {
        try {
          const extra = errors.enrichContext
            ? await Promise.resolve(errors.enrichContext(req)).catch(() => ({} as Record<string, unknown>))
            : {} as Record<string, unknown>

          const fp = errors.fingerprint
            ? (() => { try { return errors.fingerprint!(appErr) } catch { return [] as string[] } })()
            : [] as string[]

          const context: ErrorContext = {
            err:           appErr,
            originalError,
            req,
            statusCode:    appErr.statusCode,
            isOperational: appErr.isOperational,
            requestId:     (req as Request & { id?: string }).id,
            extra,
            fingerprint:   fp,
          }

          await Promise.resolve(errors.onError!(context))
        } catch (hookErr) {
          activeLogger?.error(
            { hookErr: hookErr instanceof Error
                ? { message: hookErr.message, stack: hookErr.stack }
                : hookErr },
            '[shapeguard] errorHandler onError hook threw — check your Sentry/monitoring config'
          )
        }
      })()
    }

    // ── Build and send response ────────────────────────────────────────────
    const clientMessage = (!appErr.isOperational && isProd) ? fallback : appErr.message
    const clientDetails = isProd
      ? (appErr.code === ErrorCode.VALIDATION_ERROR ? appErr.details : null)
      : appErr.details

    res.setHeader('X-Content-Type-Options', 'nosniff')

    const errorBody = buildError(appErr.code, clientMessage, clientDetails as never, false, response)

    const reqId        = (req as Request & { id?: string }).id
    const responseBody = reqId
      ? { ...errorBody, requestId: reqId }
      : errorBody

    res.status(appErr.statusCode).json(responseBody)
  }
}

// ─────────────────────────────────────────────
// shapeguard.ts — main middleware factory
// Mount once in app.ts. Wires all config together.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ShapeguardConfig } from './types/index.js'
import { isDev } from './core/env.js'
import { createLogger } from './logging/logger.js'
import { requestLogger } from './logging/request-log.js'
import { injectResHelpers } from './validation/res-helpers.js'
import { generateRequestId } from './core/request-id.js'
import { VALIDATION_CONFIG_KEY } from './validation/validate.js'
import { SG_LOGGER_KEY } from './core/constants.js'

export function shapeguard(config: ShapeguardConfig = {}): RequestHandler {
  const {
    logger:     loggerConfig     = {},
    response:   responseConfig   = {},
    validation: validationConfig = {},
    requestId:  requestIdConfig  = {},
    debug:      _debug           = isDev,
  } = config

  // ── Request ID strategy ─────────────────────────────────────────────────
  // enabled (default true):  generate / propagate a request ID per request
  // header  (default 'x-request-id'): read from upstream first (load balancer,
  //         API gateway, CDN) so the same trace ID flows through all services
  // generator: custom ID function, e.g. () => `trace-${crypto.randomUUID()}`
  const ridEnabled   = requestIdConfig.enabled   ?? true
  const ridHeader    = (requestIdConfig.header    ?? 'x-request-id').toLowerCase()
  const ridGenerator = requestIdConfig.generator  ?? generateRequestId

  // Create a per-app logger from config — independent of the user-facing singleton.
  // The singleton (import { logger } from 'shapeguard') is for user code.
  // Each shapeguard() instance needs its OWN logger so test apps don't share state.
  const logger     = createLogger(loggerConfig)
  const resHelpers = injectResHelpers(responseConfig)
  const requestLog = requestLogger(logger, loggerConfig)

  return function shapeguardMiddleware(req: Request, res: Response, next: NextFunction): void {

    // ── Assign req.id ───────────────────────────────────────────────────
    if (ridEnabled) {
      // Honour upstream ID first (load balancer / gateway forwarded trace ID).
      // Fall back to generating a fresh ID for this request.
      const upstream = req.headers[ridHeader]
      req.id = (typeof upstream === 'string' && upstream.trim())
        ? upstream.trim()
        : ridGenerator()
    } else {
      req.id = ''
    }

    // BUG #5 FIX: store logger reference on app.locals so errorHandler() can
    // auto-discover it without requiring manual wiring by the user.
    // errorHandler() reads req.app.locals[SG_LOGGER_KEY] as a fallback when
    // no explicit logger option is passed. Explicit wiring still takes precedence.
    // Guard req.app existence for standalone / test usage where app is not attached.
    if (req.app?.locals && !(req.app.locals as Record<string, unknown>)[SG_LOGGER_KEY]) {
      ;(req.app.locals as Record<string, unknown>)[SG_LOGGER_KEY] = logger
    }

    // ── Store validation + response config on res.locals (per-request, per-app-instance) ──
    // Fixes the module-singleton bug: when dev + prod apps run in the same
    // process (integration tests), each request carries its own app's config.
    // Both validationConfig and responseConfig are stored so validate()'s
    // patchResponseStrip can resolve the correct envelope data key (BUG #2 fix).
    ;(res.locals as Record<string, unknown>)[VALIDATION_CONFIG_KEY] = { ...validationConfig, response: responseConfig }

    // ── X-Request-Id response header ────────────────────────────────────
    if (responseConfig.includeRequestId && req.id) {
      res.setHeader('X-Request-Id', req.id)
    }

    resHelpers(req, res, () => {
      requestLog(req, res, next)
    })
  }
}

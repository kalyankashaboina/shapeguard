import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ShapeguardConfig } from './types/index.js'
import { createLogger }       from './logging/logger.js'
import { requestLogger }      from './logging/request-log.js'
import { injectResHelpers }   from './validation/res-helpers.js'
import { generateRequestId }  from './core/request-id.js'
import { VALIDATION_CONFIG_KEY } from './validation/validate.js'
import { SG_LOGGER_KEY }      from './core/constants.js'

export function shapeguard(config: ShapeguardConfig = {}): RequestHandler {
  const {
    logger:     loggerConfig     = {},
    response:   responseConfig   = {},
    validation: validationConfig = {},
    requestId:  requestIdConfig  = {},
  } = config

  const ridEnabled   = requestIdConfig.enabled   ?? true
  const ridHeader    = (requestIdConfig.header    ?? 'x-request-id').toLowerCase()
  const ridGenerator = requestIdConfig.generator  ?? generateRequestId

  const logger     = createLogger(loggerConfig)
  const resHelpers = injectResHelpers(responseConfig)
  const requestLog = requestLogger(logger, loggerConfig)

  return function shapeguardMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (ridEnabled) {
      const upstream = req.headers[ridHeader]
      req.id = (typeof upstream === 'string' && upstream.trim())
        ? upstream.trim()
        : ridGenerator()
    } else {
      req.id = ''
    }

    if (req.app?.locals && !(req.app.locals as Record<string, unknown>)[SG_LOGGER_KEY]) {
      ;(req.app.locals as Record<string, unknown>)[SG_LOGGER_KEY] = logger
    }

    const storedConfig = {
      ...validationConfig,
      response: responseConfig,
      globalTimeout: config.timeout,
    }
    ;(res.locals as Record<string, unknown>)[VALIDATION_CONFIG_KEY] = storedConfig

    if (responseConfig.includeRequestId && req.id) {
      res.setHeader('X-Request-Id', req.id)
    }

    resHelpers(req, res, () => {
      requestLog(req, res, next)
    })
  }
}

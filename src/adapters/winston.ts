// ─────────────────────────────────────────────
// adapters/winston.ts — shapeguard
// Thin adapter that bridges Winston's argument order to shapeguard's Logger.
//
// Winston expects:  logger.info(message, meta)
// shapeguard calls: logger.info(meta, message)
//
// Usage:
//   import winston from 'winston'
//   import { winstonAdapter } from 'shapeguard/adapters/winston'
//
//   const wLogger = winston.createLogger({ ... })
//   app.use(shapeguard({ logger: { instance: winstonAdapter(wLogger) } }))
// ─────────────────────────────────────────────

import type { Logger } from '../types/index.js'

// Duck-typed Winston logger — no winston import at build time.
// Matches the subset of winston.Logger that shapeguard needs.
type WinstonLike = {
  debug: (msg: string, meta?: object) => void
  info:  (msg: string, meta?: object) => void
  warn:  (msg: string, meta?: object) => void
  error: (msg: string, meta?: object) => void
}

/**
 * Wraps a Winston logger so it conforms to shapeguard's Logger interface.
 *
 * shapeguard calls:  logger.info(obj, msg)
 * Winston expects:   logger.info(msg, obj)
 *
 * This adapter flips the argument order so Winston receives them correctly.
 *
 * @example
 * import winston from 'winston'
 * import { winstonAdapter } from 'shapeguard/adapters/winston'
 *
 * const wLogger = winston.createLogger({
 *   transports: [new winston.transports.Console()],
 * })
 *
 * app.use(shapeguard({
 *   logger: { instance: winstonAdapter(wLogger) },
 * }))
 */
export function winstonAdapter(logger: WinstonLike): Logger {
  if (
    typeof logger.debug !== 'function' ||
    typeof logger.info  !== 'function' ||
    typeof logger.warn  !== 'function' ||
    typeof logger.error !== 'function'
  ) {
    throw new Error(
      '[shapeguard] winstonAdapter: the provided logger is missing one or more ' +
      'required methods (debug, info, warn, error). Pass a valid winston.Logger instance.'
    )
  }

  return {
    debug: (obj: object, msg?: string) => logger.debug(msg ?? '', obj),
    info:  (obj: object, msg?: string) => logger.info (msg ?? '', obj),
    warn:  (obj: object, msg?: string) => logger.warn (msg ?? '', obj),
    error: (obj: object, msg?: string) => logger.error(msg ?? '', obj),
  }
}

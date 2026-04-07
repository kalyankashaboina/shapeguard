// ─────────────────────────────────────────────────────────────────────────────
// logging/singleton.ts — shapeguard
//
// Exports a module-level logger singleton for use anywhere in an application.
//
// Usage:
//   import { logger } from 'shapeguard'
//   logger.info('Server started on port 3000')
//   logger.info({ userId: '123' }, 'User logged in')
//   logger.warn({ attempts: 3 }, 'Rate limit approaching')
//   logger.error(err as object, 'Payment service failed')
//
// LOGGER RESOLUTION ORDER (automatic, no config needed):
//   1. pino installed  → use pino  (performance-first)
//   2. winston installed → use winston adapter
//   3. neither         → built-in console fallback (same format)
//
// The singleton is the SAME instance used by shapeguard() middleware.
// Request logs and app logs share one logger → consistent format everywhere.
//
// Override the singleton logger by calling configureLogger() before app.listen():
//   import { configureLogger } from 'shapeguard'
//   configureLogger({ level: 'warn', redact: ['req.body.ssn'] })
// ─────────────────────────────────────────────────────────────────────────────

import type { Logger, LoggerConfig } from '../types/index.js'
import { createLogger } from './logger.js'

// ── Module-level singleton ────────────────────────────────────────────────────
// Created once at import time with defaults derived from NODE_ENV.
// Lazy so callers can call configureLogger() before first use.

let _config: LoggerConfig = {}
let _instance: Logger | null = null

function getInstance(): Logger {
  if (!_instance) _instance = createLogger(_config)
  return _instance
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Shapeguard's shared logger instance.
 * Same instance used internally by shapeguard() middleware.
 * Auto-selects pino → winston → built-in fallback.
 *
 * @example
 * import { logger } from 'shapeguard'
 * logger.info('Server started')
 * logger.info({ userId }, 'User logged in')
 * logger.warn({ attempts }, 'Rate limit approaching')
 * logger.error(err as object, 'Payment failed')
 */
export const logger: Logger = {
  debug: (obj: object, msg?: string) => getInstance().debug(obj, msg),
  info:  (obj: object, msg?: string) => getInstance().info(obj, msg),
  warn:  (obj: object, msg?: string) => getInstance().warn(obj, msg),
  error: (obj: object, msg?: string) => getInstance().error(obj, msg),
}

/**
 * Configure the global logger singleton BEFORE it is first used.
 * Call this before app.listen() to override defaults.
 * Returns the configured logger for immediate use.
 *
 * @example
 * import { configureLogger } from 'shapeguard'
 * const log = configureLogger({ level: 'warn', silent: process.env.NODE_ENV === 'test' })
 */
export function configureLogger(config: LoggerConfig): Logger {
  _config   = config
  _instance = createLogger(config)
  return _instance
}

/**
 * Get or create the internal logger with a specific config.
 * Used by shapeguard() middleware to share the singleton.
 * If user has already called configureLogger(), their config wins.
 *
 * @internal
 */
export function getOrCreateLogger(config: LoggerConfig): Logger {
  if (!_instance) {
    _config   = config
    _instance = createLogger(config)
  }
  return _instance
}

/**
 * Reset the singleton (for testing only).
 * @internal
 */
export function _resetLogger(): void {
  _instance = null
  _config   = {}
}

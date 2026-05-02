// ─────────────────────────────────────────────
// core/graceful-shutdown.ts — shapeguard
//
// Graceful shutdown — stops accepting new requests on SIGTERM/SIGINT,
// waits for in-flight requests to complete, runs cleanup hooks, then exits.
//
// Standalone: works without shapeguard() middleware.
// Compatible: when used with shapeguard(), the logger is reused automatically.
//
// Usage:
//   import { gracefulShutdown } from 'shapeguard'
//   const server = app.listen(3000)
//   gracefulShutdown(server, { drainMs: 30_000, onShutdown: () => db.close() })
// ─────────────────────────────────────────────

import type { Server } from 'http'

export interface GracefulShutdownOptions {
  /**
   * Maximum time in ms to wait for in-flight requests to complete.
   * After this, remaining connections are forcibly destroyed.
   * Default: 30_000 (30 seconds)
   */
  drainMs?: number

  /**
   * Additional time in ms to wait before forcing exit after drain.
   * Covers any lingering async ops (DB close, Redis disconnect, etc.)
   * Default: 5_000 (5 seconds)
   */
  forceExitMs?: number

  /**
   * Async cleanup hook — runs after all connections drained.
   * Close DB connections, flush queues, disconnect Redis, etc.
   * @example onShutdown: async () => { await db.close(); await redis.quit() }
   */
  onShutdown?: () => Promise<void> | void

  /**
   * Called when drain completes and all in-flight requests finished.
   * @example onDrained: () => logger.info({}, 'All requests drained')
   */
  onDrained?: () => void

  /**
   * Logger to use for shutdown events. Defaults to console.
   * Pass shapeguard's logger: gracefulShutdown(server, { logger })
   */
  logger?: {
    info:  (obj: object, msg?: string) => void
    warn:  (obj: object, msg?: string) => void
    error: (obj: object, msg?: string) => void
  }

  /**
   * Signals to listen for. Default: ['SIGTERM', 'SIGINT']
   */
  signals?: NodeJS.Signals[]
}

/**
 * Registers signal handlers for graceful shutdown.
 * Returns a cleanup function that removes the signal handlers (useful in tests).
 *
 * @example
 * const server = app.listen(3000)
 * const stopShutdown = gracefulShutdown(server, {
 *   drainMs:    30_000,
 *   onShutdown: async () => { await db.close(); await redis.quit() },
 *   onDrained:  () => logger.info({}, 'Server drained'),
 *   logger,
 * })
 *
 * // In tests — call stopShutdown() to deregister handlers between suites
 */
export function gracefulShutdown(
  server:  Server,
  options: GracefulShutdownOptions = {},
): () => void {
  const {
    drainMs    = 30_000,
    forceExitMs = 5_000,
    onShutdown,
    onDrained,
    logger     = console as GracefulShutdownOptions['logger'],
    signals    = ['SIGTERM', 'SIGINT'],
  } = options

  let isShuttingDown = false

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) return
    isShuttingDown = true

    logger!.info({ signal, drainMs }, `[shapeguard] Shutdown signal received — draining (${drainMs}ms max)`)

    // Stop accepting new connections
    server.close(async () => {
      logger!.info({}, '[shapeguard] HTTP server closed — no new connections accepted')
      if (onDrained) {
        try { onDrained() }
        catch (e) { logger!.warn({ error: String(e) }, '[shapeguard] onDrained hook threw') }
      }
    })

    // Force-close if drain takes too long
    const forceTimer = setTimeout(() => {
      logger!.warn({ drainMs }, '[shapeguard] Drain timeout — forcing server close')
      server.closeAllConnections?.()
    }, drainMs).unref()

    // Run cleanup hook
    if (onShutdown) {
      try {
        await Promise.resolve(onShutdown())
        logger!.info({}, '[shapeguard] Cleanup hook completed')
      } catch (e) {
        logger!.error({ error: String(e) }, '[shapeguard] Cleanup hook threw — continuing shutdown')
      }
    }

    clearTimeout(forceTimer)

    // Hard exit after forceExitMs to cover lingering async work
    setTimeout(() => {
      logger!.warn({ forceExitMs }, '[shapeguard] Force exit after timeout')
      process.exit(0)
    }, forceExitMs).unref()
  }

  const handlers = signals.map(sig => {
    const handler = () => { void shutdown(sig) }
    process.on(sig, handler)
    return { sig, handler }
  })

  // Return deregistration function for test cleanup
  return function deregister() {
    handlers.forEach(({ sig, handler }) => process.removeListener(sig, handler))
  }
}

import type { Server } from 'http'

export interface GracefulShutdownOptions {
  drainMs?:    number
  forceExitMs?: number
  onShutdown?: () => Promise<void> | void
  onDrained?:  () => void
  logger?: {
    info:  (obj: object, msg?: string) => void
    warn:  (obj: object, msg?: string) => void
    error: (obj: object, msg?: string) => void
  }
  signals?: NodeJS.Signals[]
}

export function gracefulShutdown(
  server:  Server,
  options: GracefulShutdownOptions = {},
): () => void {
  const {
    drainMs     = 30_000,
    forceExitMs = 5_000,
    onShutdown,
    onDrained,
    logger      = console as GracefulShutdownOptions['logger'],
    signals     = ['SIGTERM', 'SIGINT'],
  } = options

  let isShuttingDown = false

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) return
    isShuttingDown = true

    logger!.info({ signal, drainMs }, `[shapeguard] ${signal} received — draining connections (${drainMs}ms max)`)

    // Stop accepting new connections
    server.close(() => {
      logger!.info({}, '[shapeguard] HTTP server closed')
      onDrained?.()
    })

    // Force-close remaining connections after drain timeout
    const drainTimer = setTimeout(() => {
      logger!.warn({ drainMs }, '[shapeguard] Drain timeout — forcing connection close')
      server.closeAllConnections?.()
    }, drainMs).unref()

    // Run cleanup concurrently with drain — cleanup does not wait for drain
    if (onShutdown) {
      try {
        await Promise.resolve(onShutdown())
        logger!.info({}, '[shapeguard] Cleanup completed')
      } catch (err) {
        logger!.error({ error: String(err) }, '[shapeguard] Cleanup hook threw — continuing shutdown')
      }
    }

    clearTimeout(drainTimer)

    // Hard exit after forceExitMs to cover any lingering async ops
    setTimeout(() => {
      logger!.warn({ forceExitMs }, '[shapeguard] Force exit')
      process.exit(0)
    }, forceExitMs).unref()
  }

  const handlers = signals.map(sig => {
    const handler = () => { void shutdown(sig) }
    process.on(sig, handler)
    return { sig, handler }
  })

  return function deregister() {
    handlers.forEach(({ sig, handler }) => process.removeListener(sig, handler))
  }
}

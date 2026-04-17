// ─────────────────────────────────────────────
// core/circuit-breaker.ts — shapeguard
// Lightweight circuit breaker for external service calls.
// Protects your API from cascading failures when a dependency is down.
//
// States:
//   CLOSED   — normal operation, calls pass through
//   OPEN     — tripped, calls fail immediately with CircuitOpenError
//   HALF_OPEN — testing recovery, one probe call allowed
//
// Usage:
//   const db = circuitBreaker(async () => await pool.query('SELECT 1'), {
//     name:         'database',
//     threshold:    5,           // open after 5 consecutive failures
//     resetTimeout: 30_000,      // try again after 30s
//     onOpen:       (name) => logger.error({}, `Circuit ${name} opened`),
//   })
//
//   // In health check:
//   healthCheck({ checks: { db: db.probe } })
//
//   // In route handler:
//   const users = await db(() => UserRepo.findAll())
// ─────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerOptions {
  /**
   * Human-readable name — appears in logs and errors.
   */
  name: string

  /**
   * Number of consecutive failures before the circuit opens.
   * Default: 5
   */
  threshold?: number

  /**
   * Milliseconds to wait in OPEN state before trying a probe call.
   * Default: 30_000 (30 seconds)
   */
  resetTimeout?: number

  /**
   * Called when the circuit opens (first time it trips).
   * Use to alert PagerDuty, log to Sentry, increment a metric, etc.
   */
  onOpen?: (name: string, failureCount: number) => void

  /**
   * Called when the circuit closes after recovery.
   */
  onClose?: (name: string) => void

  /**
   * Called on every failure (whether or not the circuit opens).
   */
  onFailure?: (name: string, error: unknown) => void
}

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN'
  readonly circuitName: string

  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN — service unavailable. Retry after cooldown.`)
    this.name        = 'CircuitOpenError'
    this.circuitName = name
    Object.setPrototypeOf(this, CircuitOpenError.prototype)
  }
}

export interface CircuitBreaker {
  /**
   * Wrap a call through the circuit breaker.
   * Throws CircuitOpenError immediately when OPEN.
   * Throws the underlying error when the call fails.
   *
   * @example
   * const result = await db.call(() => pool.query('SELECT 1'))
   */
  call<T>(fn: () => Promise<T> | T): Promise<T>

  /**
   * Current circuit state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
   */
  readonly state: CircuitState

  /**
   * Consecutive failure count since last successful call.
   */
  readonly failures: number

  /**
   * Health check probe — use directly in healthCheck({ checks: { db: breaker.probe } })
   */
  probe: () => Promise<void>

  /**
   * Manually reset the circuit to CLOSED (e.g. after operator confirmation).
   */
  reset(): void

  /**
   * Manually trip the circuit to OPEN.
   */
  trip(): void
}

/**
 * Create a circuit breaker that wraps external service calls.
 *
 * @example
 * const stripe = circuitBreaker({
 *   name:         'stripe',
 *   threshold:    3,
 *   resetTimeout: 60_000,
 *   onOpen: (name) => Sentry.captureMessage(`Circuit ${name} opened`),
 * })
 *
 * // In your service:
 * const charge = await stripe.call(() =>
 *   stripeClient.charges.create({ amount: 999, currency: 'usd', source: token })
 * )
 */
export function circuitBreaker(opts: CircuitBreakerOptions): CircuitBreaker {
  const {
    name,
    threshold    = 5,
    resetTimeout = 30_000,
    onOpen,
    onClose,
    onFailure,
  } = opts

  let state:        CircuitState = 'CLOSED'
  let failures:     number       = 0
  let openedAt:     number | null = null
  let halfOpenLock: boolean       = false

  function trip(): void {
    if (state === 'OPEN') return
    state    = 'OPEN'
    openedAt = Date.now()
    onOpen?.(name, failures)
  }

  function close(): void {
    const wasOpen = state !== 'CLOSED'
    state        = 'CLOSED'
    failures     = 0
    openedAt     = null
    halfOpenLock = false
    if (wasOpen) onClose?.(name)
  }

  async function call<T>(fn: () => Promise<T> | T): Promise<T> {
    // OPEN — check if cooldown passed
    if (state === 'OPEN') {
      if (openedAt !== null && Date.now() - openedAt >= resetTimeout) {
        if (!halfOpenLock) {
          halfOpenLock = true
          state        = 'HALF_OPEN'
        } else {
          throw new CircuitOpenError(name)
        }
      } else {
        throw new CircuitOpenError(name)
      }
    }

    // CLOSED or HALF_OPEN — attempt the call
    try {
      const result = await Promise.resolve(fn())
      close()
      return result
    } catch (err) {
      failures++
      onFailure?.(name, err)
      if (state === 'HALF_OPEN' || failures >= threshold) {
        trip()
      }
      throw err
    }
  }

  const probe = async (): Promise<void> => {
    // probe() is designed for healthCheck({ checks: { db: breaker.probe } })
    // It reflects the circuit state: throws when OPEN, passes when CLOSED/HALF_OPEN
    if (state === 'OPEN') {
      // Give time context: when will it try to recover?
      const waitMs = openedAt !== null ? Math.max(0, resetTimeout - (Date.now() - openedAt)) : resetTimeout
      throw new Error(
        `Circuit "${name}" is OPEN (${failures} failures). Retrying in ~${Math.ceil(waitMs / 1000)}s.`
      )
    }
  }

  return {
    call,
    probe,
    get state()    { return state    },
    get failures() { return failures },
    reset: close,
    trip,
  }
}

// ─────────────────────────────────────────────
// core/health-check.ts — shapeguard
//
// Structured /health endpoint builder.
// Standalone: works without shapeguard() middleware.
// Each check runs independently with its own timeout.
// Response format is Kubernetes-compatible (200 = healthy, 503 = unhealthy).
//
// Usage:
//   import { healthCheck } from 'shapeguard'
//   app.use('/health', healthCheck({
//     checks: {
//       db:    () => db.query('SELECT 1'),
//       redis: () => redis.ping(),
//       mem:   healthCheck.memory({ maxPercent: 90 }),
//     }
//   }))
// ─────────────────────────────────────────────

import type { Request, Response, RequestHandler } from 'express'

export interface HealthCheckOptions {
  /**
   * Named async check functions. Each resolves (pass) or throws (fail).
   * They run in parallel. Each has its own timeout.
   */
  checks: Record<string, () => Promise<unknown> | unknown>

  /**
   * Per-check timeout in ms. Default: 5_000 (5 seconds).
   * Each check times out independently — one slow check doesn't block the others.
   */
  timeout?: number

  /**
   * HTTP status code when all checks pass. Default: 200.
   */
  healthyStatus?: number

  /**
   * HTTP status code when any check fails. Default: 503.
   * 503 is correct — load balancers and k8s use it to detect unhealthy pods.
   */
  unhealthyStatus?: number
}

export type CheckResult = 'ok' | 'timeout' | 'error'

export interface HealthCheckResponse {
  status:  'healthy' | 'degraded' | 'unhealthy'
  checks:  Record<string, CheckResult>
  uptime:  number  // process.uptime() in seconds
  version: string  // process.version (Node.js version)
  /** ISO 8601 timestamp of this response */
  time:    string
}

async function runCheck(
  fn:      () => Promise<unknown> | unknown,
  timeout: number,
): Promise<CheckResult> {
  const timer = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeout).unref()
  )
  try {
    const result = await Promise.race([
      Promise.resolve(fn()).then(() => 'ok' as const),
      timer,
    ])
    return result
  } catch {
    return 'error'
  }
}

/**
 * Creates a health-check middleware.
 * Mount at /health or /healthz — responds to GET with a structured status object.
 * Returns 200 when all checks pass, 503 when any fail.
 */
export function healthCheck(options: HealthCheckOptions): RequestHandler {
  const {
    checks,
    timeout        = 5_000,
    healthyStatus  = 200,
    unhealthyStatus = 503,
  } = options

  return async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
    // Run all checks in parallel — each times out independently
    const entries = Object.entries(checks)
    const results = await Promise.all(
      entries.map(([, fn]) => runCheck(fn, timeout))
    )

    const checkResults: Record<string, CheckResult> = {}
    let allHealthy = true
    entries.forEach(([name], i) => {
      checkResults[name] = results[i]!
      if (results[i] !== 'ok') allHealthy = false
    })

    const status: HealthCheckResponse['status'] = allHealthy ? 'healthy' : 'unhealthy'

    const body: HealthCheckResponse = {
      status,
      checks:  checkResults,
      uptime:  Math.round(process.uptime()),
      version: process.version,
      time:    new Date().toISOString(),
    }

    res.status(allHealthy ? healthyStatus : unhealthyStatus).json(body)
  }
}

// ── Built-in check factories ──────────────────────────────────────────────────

/**
 * Built-in memory check — fails when heap usage exceeds maxPercent.
 * @example healthCheck.memory({ maxPercent: 90 })
 */
healthCheck.memory = function(opts: { maxPercent?: number } = {}): () => void {
  const maxPercent = opts.maxPercent ?? 90
  return () => {
    const mem = process.memoryUsage()
    const usedMB  = Math.round(mem.heapUsed / 1024 / 1024)
    const totalMB = Math.round(mem.heapTotal / 1024 / 1024)
    const percent = totalMB > 0 ? (usedMB / totalMB) * 100 : 0
    if (percent > maxPercent) {
      throw new Error(`Heap usage ${percent.toFixed(1)}% exceeds limit of ${maxPercent}%`)
    }
  }
}

/**
 * Built-in uptime check — always passes (proves process is alive).
 * Useful as a liveness probe baseline.
 */
healthCheck.uptime = function(): () => void {
  return () => { /* always passes */ }
}

/**
 * Built-in environment check — fails when required env vars are missing.
 * @example healthCheck.env(['DATABASE_URL', 'REDIS_URL'])
 */
healthCheck.env = function(required: string[]): () => void {
  return () => {
    const missing = required.filter(k => !process.env[k])
    if (missing.length > 0) {
      throw new Error(`Missing required env vars: ${missing.join(', ')}`)
    }
  }
}

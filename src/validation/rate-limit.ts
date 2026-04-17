// ─────────────────────────────────────────────
// validation/rate-limit.ts — shapeguard
// In-memory + pluggable-store rate limiting.
// Standalone — no Express imports. Pure logic.
// ─────────────────────────────────────────────

import type { Request } from 'express'
import { AppError } from '../errors/AppError.js'

// ── Store types ───────────────────────────────
type RateLimitEntry = { count: number; reset: number }
export type SyncStore  = Map<string, RateLimitEntry>
export type AsyncStore = {
  get(k: string): Promise<RateLimitEntry | null>
  set(k: string, v: RateLimitEntry): Promise<void>
}

export interface RateLimitOpts {
  windowMs:       number
  max:            number
  message?:       string
  /**
   * Set true when shapeguard sits behind a trusted reverse proxy (nginx, AWS ALB, Cloudflare).
   * When true, the client IP is read from x-forwarded-for (set by the proxy).
   * When false (default), x-forwarded-for is ignored and socket.remoteAddress is used.
   *
   * WARNING: setting trustProxy: true without an actual reverse proxy allows attackers
   * to set their own x-forwarded-for header and bypass rate limiting entirely.
   *
   * @default false
   */
  trustProxy?:    boolean
  inMemoryStore?: SyncStore
  store?:         AsyncStore
  keyGenerator?:  (req: Request) => string
}

export async function checkRateLimit(req: Request, opts: RateLimitOpts): Promise<void> {
  // Guard: nonsensical config should never silently allow unlimited traffic
  if (!Number.isFinite(opts.max) || opts.max < 1) {
    throw new Error(`[shapeguard] rateLimit.max must be a positive integer, got: ${opts.max}`)
  }
  if (!Number.isFinite(opts.windowMs) || opts.windowMs < 1) {
    throw new Error(`[shapeguard] rateLimit.windowMs must be a positive number, got: ${opts.windowMs}`)
  }

  const ip = opts.trustProxy
    ? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress
      ?? 'unknown'
    : req.socket?.remoteAddress
      ?? 'unknown'
  const key = opts.keyGenerator ? opts.keyGenerator(req) : `${req.path}:${ip}`
  const now = Date.now()

  if (opts.store) {
    const entry = await opts.store.get(key)
    if (!entry || now > entry.reset) {
      await opts.store.set(key, { count: 1, reset: now + opts.windowMs })
      return
    }
    const newCount = entry.count + 1
    await opts.store.set(key, { count: newCount, reset: entry.reset })
    if (newCount > opts.max) {
      const retryAfter = Math.ceil((entry.reset - now) / 1000)
      throw AppError.custom('RATE_LIMIT_EXCEEDED', opts.message ?? 'Too many requests', 429, { retryAfter })
    }
    return
  }

  const memStore = opts.inMemoryStore!
  const entry = memStore.get(key)
  if (!entry || now > entry.reset) {
    memStore.set(key, { count: 1, reset: now + opts.windowMs })
    return
  }
  const newCount = entry.count + 1
  memStore.set(key, { count: newCount, reset: entry.reset })
  if (newCount > opts.max) {
    const retryAfter = Math.ceil((entry.reset - now) / 1000)
    throw AppError.custom('RATE_LIMIT_EXCEEDED', opts.message ?? 'Too many requests', 429, { retryAfter })
  }
}

/**
 * Creates an in-memory rate limit store with automatic expiry cleanup.
 * @param cleanupIntervalMs  How often to sweep expired entries. Default: 5 minutes.
 *   Reduce this for high-traffic APIs with short windows (e.g. windowMs: 1000).
 */
export function createRateLimitStore(cleanupIntervalMs = 5 * 60 * 1000): {
  store: SyncStore
  startCleanup: () => () => void
} {
  const store = new Map<string, RateLimitEntry>()
  return {
    store,
    startCleanup: () => {
      const interval = setInterval(() => {
        const now = Date.now()
        for (const [k, v] of store) {
          if (now > v.reset) store.delete(k)
        }
      }, cleanupIntervalMs)
      interval.unref()
      return () => clearInterval(interval)
    },
  }
}

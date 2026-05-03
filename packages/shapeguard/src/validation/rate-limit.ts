// ─────────────────────────────────────────────
// validation/rate-limit.ts — shapeguard
// In-memory + pluggable-store rate limiting.
// Standalone — no Express imports. Pure logic.
// ─────────────────────────────────────────────

import type { Request } from 'express'
import { AppError } from '../errors/AppError.js'

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
  inMemoryStore?: SyncStore
  store?:         AsyncStore
  keyGenerator?:  (req: Request) => string
  /**
   * Trust the X-Forwarded-For header for IP extraction.
   * ONLY enable if your server is behind a trusted reverse proxy (nginx, AWS ALB, Cloudflare).
   * When false (default), uses the direct socket address — safe even without a proxy.
   * Attackers can spoof X-Forwarded-For to bypass IP-based limits when this is true without a proxy.
   */
  trustProxy?:    boolean
}

export async function checkRateLimit(req: Request, opts: RateLimitOpts): Promise<void> {
  // Default: use socket address (safe). trustProxy:true opt-in reads X-Forwarded-For.
  // This prevents attackers from spoofing the header to bypass rate limits.
  const socketIp = req.socket?.remoteAddress ?? 'unknown'
  const ip = opts.trustProxy
    ? ((req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? socketIp)
    : socketIp
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

export function createRateLimitStore(): {
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
      }, 5 * 60 * 1000)
      interval.unref()
      return () => clearInterval(interval)
    },
  }
}

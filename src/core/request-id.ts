// ─────────────────────────────────────────────
// core/request-id.ts — shapeguard
// Time-ordered, sortable request ID — no external dep.
// Uses Node.js crypto (built-in since Node 18).
// Format: req_<timestamp_hex><random_hex>
// Sort by requestId = sort by time.
// ─────────────────────────────────────────────

import { randomBytes } from 'crypto'
import type { Request } from 'express'

const PREFIX = 'req_'

export function generateRequestId(): string {
  const ts  = Date.now().toString(16).padStart(12, '0')  // 12 hex chars of timestamp
  const rnd = randomBytes(8).toString('hex')              // 16 hex chars of random
  return PREFIX + ts + rnd
}

/**
 * Returns headers to forward to downstream HTTP calls so the same request ID
 * flows through all services in a distributed trace.
 *
 * @example
 * // In a controller or service:
 * const data = await fetch('https://payments.internal/charge', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     ...getRequestHeaders(req),
 *   },
 *   body: JSON.stringify(payload),
 * })
 *
 * @param req   The Express request — must have req.id set by shapeguard()
 * @param extra Additional headers to merge (they take precedence)
 */
export function getRequestHeaders(
  req:   Request,
  extra: Record<string, string> = {},
): Record<string, string> {
  const id = (req as Request & { id?: string }).id
  return {
    ...(id ? { 'x-request-id': id, 'x-correlation-id': id } : {}),
    ...extra,
  }
}

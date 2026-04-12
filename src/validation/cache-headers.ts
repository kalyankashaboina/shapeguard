// ─────────────────────────────────────────────
// validation/cache-headers.ts — shapeguard
// Cache-Control header builder. Standalone pure function.
// ─────────────────────────────────────────────

import type { Response } from 'express'

export type CacheOpts =
  | { noStore: true;  maxAge?: number; private?: boolean }
  | { maxAge: number; private?: boolean; noStore?: boolean; sMaxAge?: number; staleWhileRevalidate?: number }

export function applyCacheHeaders(res: Response, opts: CacheOpts): void {
  if ((opts as { noStore?: boolean }).noStore) {
    res.setHeader('Cache-Control', 'no-store')
    return
  }
  const o = opts as { maxAge?: number; private?: boolean; sMaxAge?: number; staleWhileRevalidate?: number }
  const maxAge = o.maxAge ?? 0
  const parts: string[] = [o.private ? 'private' : 'public', `max-age=${maxAge}`]
  if (o.sMaxAge              !== undefined) parts.push(`s-maxage=${o.sMaxAge}`)
  if (o.staleWhileRevalidate !== undefined) parts.push(`stale-while-revalidate=${o.staleWhileRevalidate}`)
  res.setHeader('Cache-Control', parts.join(', '))
}

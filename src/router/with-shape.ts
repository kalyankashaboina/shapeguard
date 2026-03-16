// ─────────────────────────────────────────────
// router/with-shape.ts — shapeguard
// Per-route response shape override.
// Used for health checks, metrics, legacy endpoints.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'

type ShapeMap = Record<string, string>  // { ok: '{data.ok}', uptime: '{data.uptime}' }
type ShapeMode = ShapeMap | 'raw'

export function withShape(shape: ShapeMode): RequestHandler {
  return function withShapeMiddleware(
    _req: Request,
    res:  Response,
    next: NextFunction,
  ): void {
    const originalJson = res.json.bind(res)

    res.json = function shapedJson(body: unknown) {
      if (shape === 'raw') {
        // Raw mode — if body is our envelope, unwrap data
        if (
          body !== null &&
          typeof body === 'object' &&
          'data' in (body as object)
        ) {
          originalJson((body as Record<string, unknown>)['data'])
        } else {
          originalJson(body)
        }
        return res
      }

      // Map mode — extract fields from envelope using token paths
      const mapped: Record<string, unknown> = {}
      for (const [outputKey, token] of Object.entries(shape)) {
        mapped[outputKey] = resolveToken(token, body)
      }
      originalJson(mapped)
      return res
    }

    next()
  }
}

// ── Resolve token like '{data.uptime}' from body ──
function resolveToken(token: string, body: unknown): unknown {
  const match = token.match(/^\{(.+)\}$/)
  if (!match || !match[1]) return token  // not a token — return literal

  const path   = match[1]
  const parts  = path.split('.')
  let   current: unknown = body

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

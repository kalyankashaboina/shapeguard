// ─────────────────────────────────────────────
// router/with-shape.ts — shapeguard
// Per-route response shape override.
// Used for health checks, metrics, legacy endpoints.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { isDev } from '../core/env.js'
import { VALIDATION_CONFIG_KEY } from '../validation/validate.js'

type ShapeMap = Record<string, string>  // { ok: '{data.ok}', uptime: '{data.uptime}' }
type ShapeMode = ShapeMap | 'raw'

// Resolve the configured data key name from res.locals config (mirrors getDataKey in validate.ts).
// Falls back to 'data' when no shape config is present.
function resolveDataKey(res: Response): string {
  const stored = (res.locals as Record<string, unknown> | undefined)?.[VALIDATION_CONFIG_KEY] as
    | { response?: { shape?: Record<string, string> } } | undefined
  const shape = stored?.response?.shape
  if (!shape) return 'data'
  for (const [newKey, token] of Object.entries(shape)) {
    if (token === '{data}') return newKey
  }
  return 'data'
}

export function withShape(shape: ShapeMode): RequestHandler {
  return function withShapeMiddleware(
    _req: Request,
    res:  Response,
    next: NextFunction,
  ): void {
    const originalJson = res.json.bind(res)

    res.json = function shapedJson(body: unknown) {
      if (shape === 'raw') {
        // BUG-M1 FIX: read the configured data key from res.locals instead of
        // hardcoding 'data'. When response.shape renames data → result, raw mode
        // must unwrap from 'result', not 'data'.
        const dataKey = resolveDataKey(res)
        if (
          body !== null &&
          typeof body === 'object' &&
          dataKey in (body as object)
        ) {
          originalJson((body as Record<string, unknown>)[dataKey])
        } else {
          originalJson(body)
        }
        return res
      }

      // Map mode — extract fields from envelope using token paths
      const mapped: Record<string, unknown> = {}
      for (const [outputKey, token] of Object.entries(shape)) {
        const value = resolveToken(token, body)
        // Warn in development when a token path does not exist in the response.
        // Silent undefined in prod is fine — noisy in dev catches typos early.
        if (isDev && value === undefined) {
          // dev-only warning — uses console.warn so tests can spy on it
          // eslint-disable-next-line no-console
          console.warn(
            `[shapeguard] withShape: key "${outputKey}" resolved to undefined. ` +
            `Token "${token}" does not exist in the response. Check the path.`
          )
        }
        mapped[outputKey] = value
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

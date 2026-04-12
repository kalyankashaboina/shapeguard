// ─────────────────────────────────────────────
// validation/response-strip.ts — shapeguard
// Patches res.json() to strip unknown fields from outgoing data
// using the route's response schema.
// ─────────────────────────────────────────────

import type { Response } from 'express'
import type { RouteSchema, ResponseConfig, SchemaAdapter } from '../types/index.js'
import type { ValidateOptions } from './validate.js'

// Resolve the configured data key name from shape config.
// When response.shape renames data → result, stripping must use 'result' not 'data'.
export function getDataKey(shape?: Record<string, string>): string {
  if (!shape) return 'data'
  for (const [newKey, token] of Object.entries(shape)) {
    if (token === '{data}') return newKey
  }
  return 'data'
}

// Patches res.json() to strip unknown response fields.
// BUG-M3 NOTE: strip() is async (Zod's safeParseAsync). This means res.json()
// returns 'res' before the HTTP response is sent. Express treats the request as
// handled once res.json() returns, so res.headersSent will be false until the
// .then() fires. In practice this is safe for normal Express usage because no
// middleware runs after the route handler, but any code that checks
// res.headersSent synchronously after calling res.json() will see stale state.
export function patchResponseStrip(
  res:            Response,
  schema:         RouteSchema | ValidateOptions,
  responseConfig?: ResponseConfig,
): void {
  const responseSchema: SchemaAdapter | undefined =
    (schema as { response?: SchemaAdapter }).response ??
    (schema as { sends?: SchemaAdapter }).sends

  if (!responseSchema) return

  const dataKey     = getDataKey(responseConfig?.shape)
  const originalJson = res.json.bind(res)

  res.json = function patchedJson(body: unknown) {
    if (body !== null && typeof body === 'object' && dataKey in (body as object)) {
      const envelope = { ...(body as Record<string, unknown>) }

      responseSchema.strip(envelope[dataKey])
        .then((stripped: unknown) => {
          if (res.headersSent) return
          envelope[dataKey] = stripped
          originalJson(envelope)
        })
        .catch((stripErr: unknown) => {
          if (res.headersSent) return
          // SECURITY: never send unstripped data on schema failure.
          // A failed strip may still contain passwordHash, tokens, etc.
          process.stderr.write(
            `[shapeguard] patchResponseStrip: strip() failed — sending 500 to prevent data leak. ` +
            `Error: ${stripErr instanceof Error ? stripErr.message : String(stripErr)}\n`
          )
          res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', details: null },
          })
        })

      return res
    }

    originalJson(body)
    return res
  }
}

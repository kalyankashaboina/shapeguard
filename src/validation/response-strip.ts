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
// ASYNC DESIGN NOTE: strip() uses Zod's safeParseAsync so res.json() must return
// synchronously while the actual send is deferred to the microtask queue.
// We set res.headersSent = true immediately via a non-enumerable property shadow
// so that any code checking headersSent synchronously after res.json() sees the
// correct state and doesn't attempt a double-send.
export function patchResponseStrip(
  res:            Response,
  schema:         RouteSchema | ValidateOptions,
  responseConfig?: ResponseConfig,
): void {
  const responseSchema: SchemaAdapter | undefined =
    (schema as { response?: SchemaAdapter }).response ??
    (schema as { sends?: SchemaAdapter }).sends

  if (!responseSchema) return

  const dataKey      = getDataKey(responseConfig?.shape)
  const originalJson = res.json.bind(res)

  res.json = function patchedJson(body: unknown) {
    if (body !== null && typeof body === 'object' && dataKey in (body as object)) {
      const envelope = { ...(body as Record<string, unknown>) }

      // Shadow headersSent immediately so synchronous callers see the right value.
      // This prevents double-send if code checks headersSent after calling res.json().
      Object.defineProperty(res, 'headersSent', { value: true, configurable: true })

      responseSchema.strip(envelope[dataKey])
        .then((stripped: unknown) => {
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

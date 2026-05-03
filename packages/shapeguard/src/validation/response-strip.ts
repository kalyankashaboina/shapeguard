import type { Response } from 'express'
import type { RouteSchema, ResponseConfig, SchemaAdapter } from '../types/index.js'
import type { ValidateOptions } from './validate.js'

export function getDataKey(shape?: Record<string, string>): string {
  if (!shape) return 'data'
  for (const [newKey, token] of Object.entries(shape)) {
    if (token === '{data}') return newKey
  }
  return 'data'
}

export function patchResponseStrip(
  res:             Response,
  schema:          RouteSchema | ValidateOptions,
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

      responseSchema.strip(envelope[dataKey])
        .then((stripped: unknown) => {
          if (res.headersSent) return
          envelope[dataKey] = stripped
          originalJson(envelope)
        })
        .catch((err: unknown) => {
          if (res.headersSent) return
          process.stderr.write(
            `[shapeguard] response strip failed — sending 500 to prevent data leak. ` +
            `Error: ${err instanceof Error ? err.message : String(err)}\n`
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

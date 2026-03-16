// ─────────────────────────────────────────────
// adapters/joi.ts — shapeguard
// Optional Joi adapter. Install joi separately.
// Import: import { joiAdapter } from 'shapeguard/adapters/joi'
// ─────────────────────────────────────────────

import type { SchemaAdapter, SafeParseResult } from '../types/index.js'

// Duck-typed — no joi import at build time
type JoiSchema = {
  validate(data: unknown, opts: object): {
    error?: { details: Array<{ path: Array<string | number>; message: string; type: string }> }
    value:  unknown
  }
}

export function joiAdapter<TOutput = unknown>(schema: JoiSchema): SchemaAdapter<TOutput> {
  return {
    library: 'joi',

    async parse(data: unknown): Promise<TOutput> {
      const { error, value } = schema.validate(data, { abortEarly: true, stripUnknown: false, allowUnknown: false })
      if (error) throw error
      return value as TOutput
    },

    async safeParse(data: unknown): Promise<SafeParseResult<TOutput>> {
      const { error, value } = schema.validate(data, { abortEarly: true, stripUnknown: false, allowUnknown: false })
      if (error) {
        return {
          success: false,
          errors:  error.details.map(d => ({
            field:   d.path.join('.') || 'root',
            message: d.message,
            code:    d.type,
          })),
        }
      }
      return { success: true, data: value as TOutput }
    },

    async strip(data: unknown): Promise<TOutput> {
      const { value } = schema.validate(data, { abortEarly: false, stripUnknown: true, allowUnknown: true })
      return value as TOutput
    },
  }
}

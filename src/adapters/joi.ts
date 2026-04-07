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

export interface JoiAdapterOptions {
  // Collect all validation errors instead of stopping at the first.
  // Maps to Joi's abortEarly option. Default: true (collect all errors).
  allErrors?: boolean
}

export function joiAdapter<TOutput = unknown>(
  schema: JoiSchema,
  opts:   JoiAdapterOptions = {},
): SchemaAdapter<TOutput> {
  // allErrors defaults to true (collect all errors). abortEarly is the inverse.
  // allErrors:true  → abortEarly:false (collect all) ✅
  // allErrors:false → abortEarly:true  (stop at first) ✅
  const abortEarly = !(opts.allErrors ?? true)

  return {
    library: 'joi',

    async parse(data: unknown): Promise<TOutput> {
      const { error, value } = schema.validate(data, { abortEarly, stripUnknown: false, allowUnknown: false })
      if (error) throw error
      return value as TOutput
    },

    async safeParse(data: unknown): Promise<SafeParseResult<TOutput>> {
      const { error, value } = schema.validate(data, { abortEarly, stripUnknown: false, allowUnknown: false })
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

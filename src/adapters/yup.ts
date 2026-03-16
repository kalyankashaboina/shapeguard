// ─────────────────────────────────────────────
// adapters/yup.ts — shapeguard
// Optional Yup adapter. Install yup separately.
// Import from 'shapeguard/adapters/yup'
// ─────────────────────────────────────────────

import type { SchemaAdapter, SafeParseResult, ValidationIssue } from '../types/index.js'

// Duck-typed yup schema — avoids requiring yup at build time
type YupSchema<T> = {
  validate(data: unknown, opts: object): Promise<T>
}

type YupValidationError = {
  inner?:  YupValidationError[]
  path?:   string
  message: string
  type?:   string
}

export function yupAdapter<TOutput = unknown>(
  schema: YupSchema<TOutput>
): SchemaAdapter<TOutput> {
  return {
    library: 'yup',

    async parse(data: unknown): Promise<TOutput> {
      return schema.validate(data, { abortEarly: true, stripUnknown: false })
    },

    async safeParse(data: unknown): Promise<SafeParseResult<TOutput>> {
      try {
        const value = await schema.validate(data, { abortEarly: true, stripUnknown: false })
        return { success: true, data: value as TOutput }
      } catch (err) {
        const yupErr = err as YupValidationError
        return { success: false, errors: mapYupErrors(yupErr) }
      }
    },

    async strip(data: unknown): Promise<TOutput> {
      return schema.validate(data, { abortEarly: false, stripUnknown: true })
    },
  }
}

function mapYupErrors(err: YupValidationError): ValidationIssue[] {
  if (err.inner && err.inner.length > 0) {
    return err.inner.map(e => ({
      field:   e.path ?? 'root',
      message: e.message,
      code:    e.type ?? 'invalid',
    }))
  }
  return [{ field: err.path ?? 'root', message: err.message, code: err.type ?? 'invalid' }]
}

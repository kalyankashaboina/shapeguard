// ─────────────────────────────────────────────
// adapters/zod.ts — shapeguard
// Zod is first-class. Pass z.object() directly — no wrapper needed.
// Duck-typed ZodType — does not import zod at runtime.
// ─────────────────────────────────────────────

import type { SchemaAdapter, SafeParseResult, ValidationIssue, ZodLike } from '../types/index.js'

// ZodIssue — internal shape returned by Zod's safeParseAsync error.issues
type ZodIssue = {
  path:    Array<string | number>
  message: string
  code:    string
}

export function zodAdapter<TOutput = unknown>(schema: ZodLike<TOutput>): SchemaAdapter<TOutput> {
  return {
    library: 'zod',

    async parse(data: unknown): Promise<TOutput> {
      return schema.parseAsync(data)
    },

    async safeParse(data: unknown): Promise<SafeParseResult<TOutput>> {
      const result = await schema.safeParseAsync(data)
      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, errors: mapZodErrors(result.error.issues) }
    },

    async strip(data: unknown): Promise<TOutput> {
      const stripped = await schema.strip().safeParseAsync(data)
      if (stripped.success) return stripped.data
      return data as TOutput
    },
  }
}

function mapZodErrors(issues: ZodIssue[]): ValidationIssue[] {
  return issues.map(issue => ({
    field:   issue.path.join('.') || 'root',
    message: issue.message,
    code:    issue.code,
  }))
}

export function isZodSchema(schema: unknown): schema is ZodLike {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    typeof (schema as Record<string, unknown>)['safeParseAsync'] === 'function'
  )
}

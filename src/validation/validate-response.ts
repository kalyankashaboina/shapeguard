// ─────────────────────────────────────────────
// validation/validate-response.ts — shapeguard
// validateResponse() — strip and validate an outgoing response object
// against a schema, outside of the full route lifecycle.
//
// Useful for:
//   - Unit testing response shapes without HTTP
//   - Validating data before caching
//   - Sanitizing data before storing to a log
//
// Usage:
//   const clean = await validateResponse(userData, UserResponseSchema)
//   // clean has sensitive fields stripped, schema-validated
// ─────────────────────────────────────────────

import type { SchemaAdapter, ZodLike } from '../types/index.js'
import { zodAdapter, isZodSchema } from '../adapters/zod.js'

/**
 * Strip and validate an object against a response schema.
 * Returns the stripped + validated data, or throws if validation fails.
 *
 * Useful for:
 * - Testing response shapes without standing up HTTP
 * - Validating data before caching (never cache dirty data)
 * - Sanitizing before logging (strip PII from audit logs)
 *
 * @example
 * const UserResponse = z.object({ id: z.string(), email: z.string() })
 *
 * // In a unit test:
 * const clean = await validateResponse(rawUser, UserResponse)
 * expect(clean.password).toBeUndefined()
 *
 * // Before caching:
 * const safe = await validateResponse(apiResponse, CacheableSchema)
 * await cache.set(key, safe)
 */
export async function validateResponse<T = unknown>(
  data:   unknown,
  schema: SchemaAdapter<T> | ZodLike<T>,
): Promise<T> {
  const adapter: SchemaAdapter<T> = isZodSchema(schema)
    ? zodAdapter(schema as ZodLike<T>)
    : schema as SchemaAdapter<T>

  return adapter.strip(data)
}

/**
 * Check whether data matches the response schema without throwing.
 * Returns { success: true, data } or { success: false, errors }.
 *
 * @example
 * const result = await checkResponse(rawUser, UserSchema)
 * if (!result.success) {
 *   logger.warn({ errors: result.errors }, 'Response does not match schema')
 * }
 */
export async function checkResponse<T = unknown>(
  data:   unknown,
  schema: SchemaAdapter<T> | ZodLike<T>,
): Promise<{ success: true; data: T } | { success: false; errors: Array<{ field: string; message: string; code: string }> }> {
  const adapter: SchemaAdapter<T> = isZodSchema(schema)
    ? zodAdapter(schema as ZodLike<T>)
    : schema as SchemaAdapter<T>

  return adapter.safeParse(data)
}

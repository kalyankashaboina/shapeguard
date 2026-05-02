// ─────────────────────────────────────────────
// validation/define-route.ts — shapeguard
// Bundles all schemas for a route into one object.
// defineRoute() is Zod-first — auto-wraps zod schemas.
// For Joi/Yup, pass the adapter directly.
// ─────────────────────────────────────────────

import type { RouteSchema, RouteDefinition, SchemaAdapter, ZodLike } from '../types/index.js'
import { zodAdapter, isZodSchema }                   from '../adapters/zod.js'

type SchemaInput = SchemaAdapter | ZodLike

export interface DefineRouteInput {
  body?:      SchemaInput
  params?:    SchemaInput
  query?:     SchemaInput
  headers?:   SchemaInput
  response?:  SchemaInput
  /**
   * Transform hook — runs AFTER validation, BEFORE the handler.
   * Use for hashing passwords, normalising fields, enriching data.
   * Keeps your service layer pure — it receives already-transformed data.
   *
   * @example
   * defineRoute({
   *   body:      CreateUserDTO,
   *   response:  UserResponseSchema,
   *   transform: async (data) => ({
   *     ...data,
   *     password: await bcrypt.hash(data.password, 10),
   *   }),
   * })
   */
  transform?: (data: unknown) => Promise<unknown> | unknown

  /**
   * Rate limiting — built-in, no extra package needed.
   * Applies to this route only.
   *
   * @example
   * defineRoute({
   *   body:      CreateUserDTO,
   *   rateLimit: { windowMs: 60_000, max: 10, message: 'Too many requests' }
   * })
   */
  rateLimit?: {
    windowMs:   number    // time window in ms (e.g. 60_000 = 1 minute)
    max:        number    // max requests per window per IP
    message?:   string    // response message when limit exceeded
    // Advanced — plug in Redis or any external store
    store?: {
      get(key: string): Promise<{ count: number; reset: number } | null>
      set(key: string, value: { count: number; reset: number }): Promise<void>
    }
    // Customise the key — default is IP+path, override for user-based limiting
    keyGenerator?: (req: import('express').Request) => string
  }

  /**
   * Cache hints — sets Cache-Control header on responses.
   *
   * Use `noStore: true` alone to disable caching entirely (maxAge not required).
   * Use `maxAge` for standard browser/CDN caching with optional CDN-specific directives.
   *
   * @example
   * defineRoute({ cache: { maxAge: 60, private: true } })
   * // CDN-optimised:
   * defineRoute({ cache: { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 60 } })
   * // Never cache:
   * defineRoute({ cache: { noStore: true } })
   */
  cache?: { noStore: true; maxAge?: number; private?: boolean } | { maxAge: number; private?: boolean; noStore?: boolean; sMaxAge?: number; staleWhileRevalidate?: number }

  /**
   * Per-route request timeout in milliseconds.
   * If the handler has not responded within this time, shapeguard sends a 408.
   * @example defineRoute({ body: CreateUserDTO, timeout: 5000 })
   */
  timeout?: number
}

// RouteDefinition is defined in types/index.ts and re-exported here for backwards compatibility
export type { RouteDefinition } from '../types/index.js'
// @deprecated local definition kept for reference only — do not use directly
interface _RouteDefinitionLocal extends RouteSchema {
  transform?: (data: unknown) => Promise<unknown> | unknown
  rateLimit?: {
    windowMs:      number
    max:           number
    message?:      string
    store?:        { get(k: string): Promise<{ count: number; reset: number } | null>; set(k: string, v: { count: number; reset: number }): Promise<void> }
    keyGenerator?: (req: import('express').Request) => string
  }
  cache?:     { noStore: true; maxAge?: number; private?: boolean } | { maxAge: number; private?: boolean; noStore?: boolean; sMaxAge?: number; staleWhileRevalidate?: number }
}

export function defineRoute(input: DefineRouteInput): RouteDefinition {
  const schema: RouteDefinition = {}
  if (input.body)      schema.body      = normalise(input.body)
  if (input.params)    schema.params    = normalise(input.params)
  if (input.query)     schema.query     = normalise(input.query)
  if (input.headers)   schema.headers   = normalise(input.headers)
  if (input.response)  schema.response  = normalise(input.response)
  if (input.transform) schema.transform = input.transform
  if (input.rateLimit) schema.rateLimit = input.rateLimit
  if (input.cache)     schema.cache     = input.cache
  if (input.timeout)   schema.timeout   = input.timeout
  return schema
}

// Auto-wrap zod-like schemas into zodAdapter.
// DTOs from createDTO() and pre-wrapped adapters pass through unchanged.
function normalise(schema: SchemaInput): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  return schema as SchemaAdapter
}

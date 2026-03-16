// ─────────────────────────────────────────────
// validation/define-route.ts — shapeguard
// Bundles all schemas for a route into one object.
// defineRoute() is Zod-first — auto-wraps zod schemas.
// For Joi/Yup, pass the adapter directly.
// ─────────────────────────────────────────────

import type { RouteSchema, SchemaAdapter, ZodLike } from '../types/index.js'
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
   * @example
   * defineRoute({
   *   params:   UserParamsSchema,
   *   response: UserResponseSchema,
   *   cache:    { maxAge: 60, private: true }
   * })
   */
  cache?: {
    maxAge:   number   // seconds
    private?: boolean  // Cache-Control: private
    noStore?: boolean  // Cache-Control: no-store (overrides maxAge)
  }
}

export interface RouteDefinition extends RouteSchema {
  transform?: (data: unknown) => Promise<unknown> | unknown
  rateLimit?: {
    windowMs:      number
    max:           number
    message?:      string
    store?:        { get(k: string): Promise<{ count: number; reset: number } | null>; set(k: string, v: { count: number; reset: number }): Promise<void> }
    keyGenerator?: (req: import('express').Request) => string
  }
  cache?:     { maxAge: number; private?: boolean; noStore?: boolean }
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
  return schema
}

// Auto-wrap zod-like schemas into zodAdapter.
// DTOs from createDTO() and pre-wrapped adapters pass through unchanged.
function normalise(schema: SchemaInput): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  return schema as SchemaAdapter
}

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
}

export interface RouteDefinition extends RouteSchema {
  transform?: (data: unknown) => Promise<unknown> | unknown
}

export function defineRoute(input: DefineRouteInput): RouteDefinition {
  const schema: RouteDefinition = {}
  if (input.body)      schema.body      = normalise(input.body)
  if (input.params)    schema.params    = normalise(input.params)
  if (input.query)     schema.query     = normalise(input.query)
  if (input.headers)   schema.headers   = normalise(input.headers)
  if (input.response)  schema.response  = normalise(input.response)
  if (input.transform) schema.transform = input.transform
  return schema
}

// Auto-wrap zod-like schemas into zodAdapter.
// DTOs from createDTO() and pre-wrapped adapters pass through unchanged.
function normalise(schema: SchemaInput): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  return schema as SchemaAdapter
}

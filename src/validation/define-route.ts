// ─────────────────────────────────────────────
// validation/define-route.ts — shapeguard
// Bundles all schemas for a route into one object.
// defineRoute() is Zod-first — auto-wraps zod schemas.
// For Joi/Yup, pass the adapter directly.
// ─────────────────────────────────────────────

import type { RouteSchema, SchemaAdapter } from '../types/index.js'
import { zodAdapter, isZodSchema } from '../adapters/zod.js'

// ZodLike — same duck type used in zod adapter (no import needed)
type ZodLike = {
  safeParseAsync(data: unknown): Promise<unknown>
}

type SchemaInput = SchemaAdapter | ZodLike

interface DefineRouteInput {
  body?:     SchemaInput
  params?:   SchemaInput
  query?:    SchemaInput
  headers?:  SchemaInput
  response?: SchemaInput
}

export function defineRoute(input: DefineRouteInput): RouteSchema {
  const schema: RouteSchema = {}
  if (input.body)     schema.body     = normalise(input.body)
  if (input.params)   schema.params   = normalise(input.params)
  if (input.query)    schema.query    = normalise(input.query)
  if (input.headers)  schema.headers  = normalise(input.headers)
  if (input.response) schema.response = normalise(input.response)
  return schema
}

// Auto-wrap zod-like schemas into zodAdapter. Pre-wrapped adapters pass through unchanged.
function normalise(schema: SchemaInput): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  return schema as SchemaAdapter
}

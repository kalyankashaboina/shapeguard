// ─────────────────────────────────────────────
// openapi/index.ts — shapeguard
// Auto-generate OpenAPI 3.1 spec from defineRoute()
// definitions. No manual schema duplication.
// ─────────────────────────────────────────────

import type { RouteDefinition } from '../validation/define-route.js'

export interface OpenAPIConfig {
  title:        string
  version:      string
  description?: string
  servers?:     Array<{ url: string; description?: string }>
  routes:       Record<string, RouteDefinition>
}

export interface OpenAPISpec {
  openapi:  '3.1.0'
  info:     { title: string; version: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  paths:    Record<string, Record<string, OpenAPIOperation>>
}

interface OpenAPIOperation {
  summary?:     string
  parameters?:  OpenAPIParameter[]
  requestBody?: { required: boolean; content: Record<string, { schema: Record<string, unknown> }> }
  responses:    Record<string, { description: string; content?: Record<string, { schema: Record<string, unknown> }> }>
}

interface OpenAPIParameter {
  name:     string
  in:       'path' | 'query' | 'header'
  required: boolean
  schema:   Record<string, unknown>
}

/**
 * Generates an OpenAPI 3.1 spec from defineRoute() definitions.
 *
 * @example
 * const spec = generateOpenAPI({
 *   title:   'My API',
 *   version: '1.0.0',
 *   routes: {
 *     'POST /users':     CreateUserRoute,
 *     'GET  /users/:id': GetUserRoute,
 *     'GET  /users':     ListUsersRoute,
 *     'PUT  /users/:id': UpdateUserRoute,
 *     'DELETE /users/:id': DeleteUserRoute,
 *   }
 * })
 * app.get('/docs/openapi.json', (_req, res) => res.json(spec))
 */
export function generateOpenAPI(config: OpenAPIConfig): OpenAPISpec {
  const paths: Record<string, Record<string, OpenAPIOperation>> = {}

  for (const [routeKey, route] of Object.entries(config.routes)) {
    const parts   = routeKey.trim().split(/\s+/)
    const method  = (parts[0] ?? 'GET').toLowerCase()
    const rawPath = parts[1] ?? '/'
    // Convert Express :param → OpenAPI {param}
    const oaPath  = rawPath.replace(/:([^/]+)/g, '{$1}')

    if (!paths[oaPath]) paths[oaPath] = {}

    const operation: OpenAPIOperation = {
      responses: {
        '200': { description: 'Success' },
        '422': { description: 'Validation error' },
        '500': { description: 'Internal server error' },
      }
    }

    // Path params
    const pathParams = [...rawPath.matchAll(/:([^/]+)/g)].map(m => m[1]!)
    if (pathParams.length > 0) {
      operation.parameters = pathParams.map(name => ({
        name, in: 'path', required: true, schema: { type: 'string' },
      }))
    }

    // Query params
    if (route.query) {
      const shape = extractShape(route.query)
      const qParams: OpenAPIParameter[] = Object.entries(shape).map(([name, s]) => ({
        name, in: 'query', required: !isOptional(s), schema: toJsonSchema(s),
      }))
      operation.parameters = [...(operation.parameters ?? []), ...qParams]
    }

    // Request body
    if (route.body && method !== 'get') {
      operation.requestBody = {
        required: true,
        content:  { 'application/json': { schema: adapterToJsonSchema(route.body) } },
      }
    }

    // Response
    operation.responses['200'] = {
      description: 'Success',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string' },
              data:    route.response ? adapterToJsonSchema(route.response) : { type: 'object' },
            },
          }
        }
      }
    }

    paths[oaPath]![method] = operation
  }

  const spec: OpenAPISpec = {
    openapi: '3.1.0',
    info:    { title: config.title, version: config.version, description: config.description },
    paths,
  }
  if (config.servers) spec.servers = config.servers
  return spec
}

// ── Internal helpers ──────────────────────────

// Typed accessor for Zod internals — avoids as any throughout
// Zod attaches _def at runtime; we type it minimally here
interface ZodDef {
  typeName?:  string
  innerType?: unknown
  schema?:    unknown
  type?:      unknown
  values?:    string[]
  checks?:    Array<{ kind: string; value?: number }>
  shape?:     (() => Record<string, unknown>) | Record<string, unknown>
}

function zodDef(schema: unknown): ZodDef {
  if (schema !== null && typeof schema === 'object' && '_def' in schema) {
    return (schema as { _def: ZodDef })._def
  }
  return {}
}

function zodSchema(adapter: unknown): unknown {
  if (adapter !== null && typeof adapter === 'object' && 'schema' in adapter) {
    return (adapter as { schema: unknown }).schema
  }
  return adapter
}

function adapterToJsonSchema(adapter: unknown): Record<string, unknown> {
  const shape = extractShape(adapter)
  if (Object.keys(shape).length > 0) {
    return {
      type:       'object',
      properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, toJsonSchema(v)])),
    }
  }
  return { type: 'object' }
}

function extractShape(adapter: unknown): Record<string, unknown> {
  try {
    const schema = zodSchema(adapter)
    const def    = zodDef(schema)
    const shape  = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {})
    return typeof shape === 'object' && shape !== null ? shape as Record<string, unknown> : {}
  } catch { return {} }
}

function toJsonSchema(z: unknown): Record<string, unknown> {
  try {
    const def      = zodDef(z)
    const typeName = def.typeName ?? ''
    switch (typeName) {
      case 'ZodString':   return buildStringSchema(def)
      case 'ZodNumber':   return { type: 'number' }
      case 'ZodBoolean':  return { type: 'boolean' }
      case 'ZodDate':     return { type: 'string', format: 'date-time' }
      case 'ZodArray':    return { type: 'array', items: toJsonSchema(def.type) }
      case 'ZodEnum':     return { type: 'string', enum: def.values ?? [] }
      case 'ZodOptional': return toJsonSchema(def.innerType)
      case 'ZodNullable': return { ...toJsonSchema(def.innerType), nullable: true }
      case 'ZodDefault':  return toJsonSchema(def.innerType)
      case 'ZodCoerce':   return toJsonSchema(def.schema)
      case 'ZodObject':   return adapterToJsonSchema(z)
      case 'ZodUUID':     return { type: 'string', format: 'uuid' }
      default:            return { type: 'string' }
    }
  } catch { return { type: 'string' } }
}

function buildStringSchema(def: ZodDef): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'string' }
  for (const check of def.checks ?? []) {
    if (check.kind === 'email')    schema['format']    = 'email'
    if (check.kind === 'uuid')     schema['format']    = 'uuid'
    if (check.kind === 'url')      schema['format']    = 'uri'
    if (check.kind === 'datetime') schema['format']    = 'date-time'
    if (check.kind === 'min')      schema['minLength'] = check.value
    if (check.kind === 'max')      schema['maxLength'] = check.value
  }
  return schema
}

function isOptional(z: unknown): boolean {
  const t = zodDef(z).typeName ?? ''
  return t === 'ZodOptional' || t === 'ZodDefault'
}

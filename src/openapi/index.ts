// ─────────────────────────────────────────────
// openapi/index.ts — shapeguard v0.5.0
// Auto-generate OpenAPI 3.1 spec from defineRoute() definitions.
// Fixes: 422/500 schemas, operationId, tags, summary, prefix, duplicate detection, trailing slash.
// ─────────────────────────────────────────────

import type { RouteDefinition } from '../validation/define-route.js'

export interface OpenAPIConfig {
  title:        string
  version:      string
  description?: string
  servers?:     Array<{ url: string; description?: string }>
  prefix?:      string  // Bug 19: applied to all route paths automatically e.g. '/api/v1'
  routes:       Record<string, RouteDefinition | InlineRouteDefinition>
}

// Bug 19 / v0.5.0 Feature: inline schema for existing Express apps
export interface InlineRouteDefinition {
  summary?:  string
  tags?:     string[]
  body?:     unknown
  response?: unknown
  params?:   unknown
  query?:    unknown
}

export interface OpenAPISpec {
  openapi:  '3.1.0'
  info:     { title: string; version: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  paths:    Record<string, Record<string, OpenAPIOperation>>
}

interface OpenAPIOperation {
  operationId?: string
  summary?:     string
  tags?:        string[]
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

// Bug 17: shared error envelope schema for 422 and 500 responses
const ERROR_ENVELOPE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string' },
    error: {
      type: 'object',
      properties: {
        code:    { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
    },
  },
}

export function generateOpenAPI(config: OpenAPIConfig): OpenAPISpec {
  const paths:  Record<string, Record<string, OpenAPIOperation>> = {}
  const prefix  = config.prefix ? normalizePath(config.prefix) : ''
  const seen    = new Set<string>()   // Bug 20: duplicate detection

  for (const [routeKey, route] of Object.entries(config.routes)) {
    const parts   = routeKey.trim().split(/\s+/)
    const method  = (parts[0] ?? 'GET').toLowerCase()
    const rawPath = parts[1] ?? '/'

    // Bug 21: strip trailing slash, Bug 19: prepend prefix
    const normalRaw = normalizePath(rawPath)
    const oaPath    = prefix + normalRaw.replace(/:([^/]+)/g, '{$1}')

    // Bug 20: warn and skip duplicates
    const dedupeKey = `${method}:${oaPath}`
    if (seen.has(dedupeKey)) {
      console.warn(
        `[shapeguard] generateOpenAPI: duplicate route "${method.toUpperCase()} ${oaPath}" — ` +
        `first definition kept, second ignored.`
      )
      continue
    }
    seen.add(dedupeKey)

    if (!paths[oaPath]) paths[oaPath] = {}

    // Bug 18: read summary and tags from route definition
    const r        = route as Record<string, unknown>
    const summary  = typeof r['summary'] === 'string' ? r['summary'] : undefined
    const tags     = Array.isArray(r['tags']) ? r['tags'] as string[] : undefined

    // Bug 18: auto-generate stable operationId e.g. POST /users/:id → postUsersId
    const operationId = generateOperationId(method, normalRaw)

    const operation: OpenAPIOperation = {
      operationId,
      responses: {
        '200': { description: 'Success' },
        // Bug 17: full error envelope schema on both error responses
        '422': {
          description: 'Validation error',
          content: { 'application/json': { schema: ERROR_ENVELOPE_SCHEMA } },
        },
        '500': {
          description: 'Internal server error',
          content: { 'application/json': { schema: ERROR_ENVELOPE_SCHEMA } },
        },
      },
    }

    if (summary) operation.summary = summary
    if (tags)    operation.tags    = tags

    // Path params from URL pattern
    const pathParams = [...normalRaw.matchAll(/:([^/]+)/g)].map(m => m[1]!)
    if (pathParams.length > 0) {
      operation.parameters = pathParams.map(name => ({
        name, in: 'path', required: true, schema: { type: 'string' },
      }))
    }

    // Query params
    if (route.query) {
      const shape   = extractShape(route.query)
      const qParams: OpenAPIParameter[] = Object.entries(shape).map(([name, s]) => ({
        name, in: 'query', required: !isOptional(s), schema: toJsonSchema(s),
      }))
      operation.parameters = [...(operation.parameters ?? []), ...qParams]
    }

    // Request body (not for GET)
    if (route.body && method !== 'get') {
      operation.requestBody = {
        required: true,
        content:  { 'application/json': { schema: adapterToJsonSchema(route.body) } },
      }
    }

    // Bug 16 (confirmed): response schema populates data field in 200 envelope
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
          },
        },
      },
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

// ── Path normalisation ────────────────────────
function normalizePath(path: string): string {
  if (!path.startsWith('/')) path = '/' + path
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
}

// ── operationId generation ────────────────────
function generateOperationId(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map(s => s.startsWith(':') ? s.slice(1) : s)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
  return method.toLowerCase() + (segments.join('') || 'Root')
}

// ── Zod introspection helpers ─────────────────

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

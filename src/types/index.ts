// ─────────────────────────────────────────────
// types/index.ts — shapeguard public API types
// ─────────────────────────────────────────────

import type { Request } from 'express'

// ── Shared ZodLike duck-type ─────────────────
// Used across adapters, define-route, create-dto, handle.
// No direct zod import — keeps zod as a peer dep, not a bundled dep.
export type ZodLike<T = unknown> = {
  safeParseAsync(data: unknown): Promise<
    | { success: true;  data: T }
    | { success: false; error: { issues: Array<{ path: Array<string|number>; message: string; code: string }> } }
  >
  parseAsync(data: unknown): Promise<T>
  strip():                   ZodLike<T>
  _output?: T  // Zod attaches this — used for type inference only
}

// ── Schema adapter contract ───────────────────
export interface SchemaAdapter<TOutput = unknown> {
  parse(data: unknown):     Promise<TOutput>
  safeParse(data: unknown): Promise<SafeParseResult<TOutput>>
  strip(data: unknown):     Promise<TOutput>
  readonly library: 'zod' | 'joi' | 'yup'
}

export type SafeParseResult<T> =
  | { success: true;  data: T }
  | { success: false; errors: ValidationIssue[] }

export interface ValidationIssue {
  field:   string
  message: string
  code:    string
}

// ── Route schema definition ───────────────────
export interface RouteSchema {
  body?:     SchemaAdapter
  params?:   SchemaAdapter
  query?:    SchemaAdapter
  headers?:  SchemaAdapter
  response?: SchemaAdapter
}

// ── Infer output types from RouteSchema ───────
type InferAdapter<T> = T extends SchemaAdapter<infer O> ? O : never

export type InferBody<T extends RouteSchema>    = T['body']    extends SchemaAdapter ? InferAdapter<T['body']>    : unknown
export type InferParams<T extends RouteSchema>  = T['params']  extends SchemaAdapter ? InferAdapter<T['params']>  : Record<string, string>
export type InferQuery<T extends RouteSchema>   = T['query']   extends SchemaAdapter ? InferAdapter<T['query']>   : Record<string, string>
export type InferHeaders<T extends RouteSchema> = T['headers'] extends SchemaAdapter ? InferAdapter<T['headers']> : Record<string, string>

// ── Response envelopes ────────────────────────
export interface SuccessEnvelope<T = unknown> {
  readonly success: true
  readonly message: string
  readonly data:    T
}

export interface ErrorEnvelope {
  readonly success: false
  readonly message: string
  readonly error: {
    readonly code:    string
    readonly message: string
    readonly details: ValidationIssue | ValidationIssue[] | Record<string, unknown> | string | null
  }
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope

export interface PaginatedData<T> {
  items: T[]
  total: number
  page:  number
  limit: number
  pages: number
}

// ── res helpers ───────────────────────────────
export interface ShapeguardResponse {
  ok(opts: ResOkOpts):              void
  created(opts: ResOkOpts):         void
  accepted(opts: ResOkOpts):        void
  noContent():                      void
  paginated(opts: ResPaginatedOpts): void
  fail(opts: ResFailOpts):          void
}

export interface ResOkOpts {
  data?:    unknown
  message?: string
  status?:  number
}

export interface ResPaginatedOpts {
  data:     unknown[]
  total:    number
  page:     number
  limit:    number
  message?: string
}

export interface ResFailOpts {
  code:     string
  message:  string
  details?: unknown
  status?:  number
}

// ── RequestIdConfig — control how request IDs are generated and used ──
export interface RequestIdConfig {
  // Generate a unique ID for every request (default: true).
  // Set false to disable entirely — req.id will be an empty string.
  enabled?: boolean

  // Incoming header to read the request ID from BEFORE generating one.
  // Useful when a load balancer / API gateway / CDN already set a trace ID.
  // Example: 'x-request-id', 'x-trace-id', 'x-correlation-id'
  // (default: 'x-request-id' — reads from upstream if present)
  header?: string

  // Custom generator function. Replaces the built-in req_<ts><random> format.
  // Must return a non-empty string. Called once per request.
  // Example: () => `trace-${crypto.randomUUID()}`
  generator?: () => string
}

// ── shapeguard() master config ────────────────
export interface ShapeguardConfig {
  debug?:      boolean
  requestId?:  RequestIdConfig
  logger?:     LoggerConfig
  validation?: ValidationConfig
  response?:   ResponseConfig
  errors?:     ErrorsConfig
}

// ── LoggerConfig — full control over request logging ──
export interface LoggerConfig {
  // Bring your own logger (pino, winston, etc.)
  instance?:        Logger

  // Log level: debug | info | warn | error  (default: debug in dev, warn in prod)
  level?:           LogLevel

  // Pretty-print logs (default: true in dev, false in prod)
  pretty?:          boolean

  // Log every request, not just errors + slow (default: true in dev, false in prod)
  logAllRequests?:  boolean

  // Log time in ms after which a request is flagged as SLOW (default: disabled in dev, 1000ms in prod)
  // Set to 0 to disable slow-request detection entirely.
  slowThreshold?:   number

  // Log the incoming request body (default: false — security risk, enable carefully)
  logRequestBody?:  boolean

  // Log the outgoing response body (default: false — security risk, enable carefully)
  logResponseBody?: boolean

  // Append [req_id] to every log line: "← 201  POST /api/v1/users  12ms  [req_abc123]"
  // Keeps request ID visible in log tails without needing a log aggregator.
  // (default: true — set false to hide req ID from log output)
  logRequestId?: boolean

  // Extra field paths to redact from pino logs (shapeguard always redacts passwords, tokens, cookies)
  redact?:          string[]

  // Suppress ALL log output — useful for test environments
  // Default: false
  silent?:          boolean
}

export interface ValidationConfig {
  // Global string transforms — applied to every string field in every schema.
  // Saves repeating .trim() / .toLowerCase() on each field individually.
  strings?: {
    trim?:      boolean  // auto-trim whitespace from all string fields (default: false)
    lowercase?: boolean  // auto-lowercase all string fields (default: false)
  }

  // Expose the field name in error responses (default: true)
  exposeFieldName?:  boolean

  // Expose the human-readable error message (default: true)
  exposeMessage?:    boolean

  // Expose enum values in error messages like "Expected 'admin' | 'user'" (default: true in dev, false in prod)
  exposeEnumValues?: boolean

  // Expose raw Zod error codes like "invalid_type" (default: false — leaks schema internals)
  exposeZodCodes?:   boolean

  // Override default pre-parse limits globally
  limits?: {
    maxDepth?:        number   // default: 20
    maxArrayLength?:  number   // default: 1000
    maxStringLength?: number   // default: 10_000
  }
}

export interface ResponseConfig {
  // Rename envelope fields globally: { status: '{success}', result: '{data}' }
  shape?:            Record<string, string>

  // Override default HTTP status codes per method
  statusCodes?:      Partial<Record<HttpMethod, number>>

  // Include X-Request-Id header in every response (default: false)
  includeRequestId?: boolean
}

export interface ErrorsConfig {
  // Message shown to clients for non-operational (programmer) errors in prod (default: 'Something went wrong')
  fallbackMessage?: string

  // Hook called for every error before the response is sent — use for Sentry, alerting, etc.
  onError?: (err: unknown, req: Request) => void
}

// ── Logger interface ──────────────────────────
export interface Logger {
  info:  (obj: object, msg?: string) => void
  warn:  (obj: object, msg?: string) => void
  error: (obj: object, msg?: string) => void
  debug: (obj: object, msg?: string) => void
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// ── Error codes ───────────────────────────────
export const ErrorCode = {
  VALIDATION_ERROR:     'VALIDATION_ERROR',
  NOT_FOUND:            'NOT_FOUND',
  UNAUTHORIZED:         'UNAUTHORIZED',
  FORBIDDEN:            'FORBIDDEN',
  CONFLICT:             'CONFLICT',
  INTERNAL_ERROR:       'INTERNAL_ERROR',
  METHOD_NOT_ALLOWED:   'METHOD_NOT_ALLOWED',
  BODY_TOO_DEEP:        'BODY_TOO_DEEP',
  BODY_ARRAY_TOO_LARGE: 'BODY_ARRAY_TOO_LARGE',
  STRING_TOO_LONG:      'STRING_TOO_LONG',
  INVALID_CONTENT_TYPE: 'INVALID_CONTENT_TYPE',
  PARAM_POLLUTION:      'PARAM_POLLUTION',
  PROTO_POLLUTION:       'PROTO_POLLUTION',
  RATE_LIMIT_EXCEEDED:   'RATE_LIMIT_EXCEEDED',
} as const

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode]

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

// ── Express augmentation ──────────────────────
declare global {
  namespace Express {
    interface Request {
      id: string
    }
    interface Response extends ShapeguardResponse {}
  }
}

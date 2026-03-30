// ─────────────────────────────────────────────
// index.ts — shapeguard public API
// Everything exported from here. Fully tree-shakeable.
// ─────────────────────────────────────────────

// ── Core middleware ───────────────────────────
export { shapeguard }           from './shapeguard.js'

// ── Validation ────────────────────────────────
export { validate }             from './validation/validate.js'
export type { ValidateOptions } from './validation/validate.js'
export { defineRoute }          from './validation/define-route.js'
export type { RouteDefinition } from './validation/define-route.js'
export { handle }               from './validation/handle.js'
export { createDTO }            from './validation/create-dto.js'
export type { DTOResult }       from './validation/create-dto.js'

// ── OpenAPI ───────────────────────────────────
export { generateOpenAPI, createDocs }      from './openapi/index.js'
export type { OpenAPIConfig, OpenAPISpec, DocsConfig, SecuritySchemeType, InlineRouteDefinition } from './openapi/index.js'


// ── Zod adapter (first-class) ─────────────────
export { zodAdapter, isZodSchema } from './adapters/zod.js'

// ── Errors ────────────────────────────────────
export { AppError, isAppError }          from './errors/AppError.js'
export { errorHandler }                  from './errors/error-handler.js'
export { notFoundHandler, asyncHandler } from './errors/not-found.js'

// ── Router ────────────────────────────────────
export { createRouter } from './router/create-router.js'
export { withShape }    from './router/with-shape.js'

// ── Types — all public ────────────────────────
export type {
  // Config
  ShapeguardConfig,
  RequestIdConfig,
  LoggerConfig,
  ValidationConfig,
  ResponseConfig,
  ErrorsConfig,

  // Schema
  SchemaAdapter,
  RouteSchema,
  SafeParseResult,
  ValidationIssue,

  // Type inference helpers
  InferBody,
  InferParams,
  InferQuery,
  InferHeaders,

  // Response
  SuccessEnvelope,
  ErrorEnvelope,
  Envelope,
  PaginatedData,
  CursorPaginatedData,
  ShapeguardResponse,

  // Res helper options
  ResOkOpts,
  ResFailOpts,
  ResPaginatedOpts,
  ResCursorPaginatedOpts,

  // Logger
  Logger,
  LogLevel,

  // Utils
  HttpMethod,
  ZodLike,
} from './types/index.js'

// ── Error codes — stable string constants ─────
export { ErrorCode } from './types/index.js'

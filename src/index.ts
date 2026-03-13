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
  // Usage: type Body = InferBody<typeof MyRoute>
  InferBody,
  InferParams,
  InferQuery,
  InferHeaders,

  // Response
  SuccessEnvelope,
  ErrorEnvelope,
  Envelope,
  PaginatedData,
  ShapeguardResponse,

  // Res helper options
  ResOkOpts,
  ResFailOpts,
  ResPaginatedOpts,

  // Logger
  Logger,
  LogLevel,

  // Utils
  HttpMethod,
} from './types/index.js'

// ── Error codes — stable string constants ─────
export { ErrorCode } from './types/index.js'

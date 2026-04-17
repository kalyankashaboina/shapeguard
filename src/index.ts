// ─────────────────────────────────────────────
// index.ts — shapeguard public API
// Everything exported from here. Fully tree-shakeable.
// ─────────────────────────────────────────────

// ── Core middleware ───────────────────────────
export { shapeguard }           from './shapeguard.js'

// ── Logger singleton — use anywhere in your app ──
// Same instance used by shapeguard() middleware. Auto-selects pino → winston → fallback.
export { logger, configureLogger, _resetLogger as resetLoggerForTesting } from './logging/singleton.js'

// ── Validation ────────────────────────────────
export { validate }             from './validation/validate.js'
export type { ValidateOptions } from './validation/validate.js'
export { defineRoute, mergeRoutes } from './validation/define-route.js'
export type { RouteDefinition }     from './validation/define-route.js'
export { handle }               from './validation/handle.js'
export { createDTO }            from './validation/create-dto.js'
export type { DTOResult }       from './validation/create-dto.js'

// ── OpenAPI — spec generation ─────────────────
export { generateOpenAPI, createDocs }      from './openapi/index.js'
export type { OpenAPIConfig, OpenAPISpec, DocsConfig, SecuritySchemeType, InlineRouteDefinition } from './openapi/index.js'

// ── OpenAPI — docs UIs (CDN-based, zero install) ──
// serveScalar: modern UI with code snippets + persistent auth (default)
// serveSwaggerUI: classic Swagger UI, enhanced with dark mode + snippets
// serveRedoc: read-only public portal (Stripe-style)
// serveDocs: mount all endpoints at once
export { serveScalar, serveSwaggerUI, serveRedoc, serveDocs } from './openapi/index.js'
export type { ScalarOptions, SwaggerUIOptions, RedocOptions, ServeDocsOptions } from './openapi/index.js'

// ── OpenAPI — API client exports (pure functions, no deps) ─
// toPostman: Postman Collection v2.1 · toInsomnia: Insomnia v4 · toBruno: Bruno
export { toPostman, toInsomnia, toBruno } from './openapi/index.js'

export { verifyWebhook, inMemoryDeduplicator } from './security/webhook.js'
export type { WebhookConfig, DeliveryDeduplicator } from './security/webhook.js'

export { safeJsonParse } from './core/pre-parse.js'
export { validateResponse, checkResponse } from './validation/validate-response.js'

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
  ErrorContext,

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
  RequestLogContext,

  // Utils
  HttpMethod,
  ZodLike,
} from './types/index.js'

// ── Error codes — stable string constants ─────
export { ErrorCode } from './types/index.js'

// ── Internal contract keys — useful for custom middleware that integrates with shapeguard ──
export { SG_LOGGER_KEY, SG_CONFIG_KEY } from './core/constants.js'

// ── Resilience + production utilities ─────────────────────────────────────────
export { gracefulShutdown } from './core/graceful-shutdown.js'
export type { GracefulShutdownOptions } from './core/graceful-shutdown.js'

export { healthCheck } from './core/health-check.js'
export type { HealthCheckOptions, HealthCheckResponse, CheckResult } from './core/health-check.js'

export { getRequestHeaders } from './core/request-id.js'

// ── Composable middleware ─────────────────────
export { pipe } from './core/pipe.js'

// ── Typed per-request context store ──────────
export { setContext, getContext, requireContext, getFullContext, contextMiddleware } from './core/context.js'

// ── Server-Sent Events (SSE) ──────────────────
export { sseStream, enableSSE, onClientDisconnect } from './core/sse.js'
export type { SSEEvent, SSEStream } from './core/sse.js'

// ── Circuit breaker ───────────────────────────
export { circuitBreaker, CircuitOpenError } from './core/circuit-breaker.js'
export type { CircuitBreaker, CircuitBreakerOptions, CircuitState } from './core/circuit-breaker.js'

// ── Route groups ──────────────────────────────
export { defineGroup } from './router/define-group.js'
export type { RouteGroupOptions } from './router/define-group.js'

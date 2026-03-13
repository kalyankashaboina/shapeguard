# Changelog

All notable changes to shapeguard are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-03-13 — Initial public release

### Core middleware

- `shapeguard()` — main middleware factory, mount once in `app.ts`
- Auto-detects `NODE_ENV` — no manual `debug` flag needed
- `requestId` config block — full control over request ID generation:
  - `enabled` — disable entirely (default: `true`)
  - `header` — read trace ID from upstream first, e.g. load balancer's `x-request-id` (default: `'x-request-id'`)
  - `generator` — custom ID function, e.g. `() => crypto.randomUUID()`

### Validation

- `validate()` — validates `req.body`, `req.params`, `req.query`, `req.headers`
- `validate({ allErrors: true })` — collect all field issues in one response
- `validate({ limits })` — per-route pre-parse limit overrides
- `validate({ sanitize })` — per-route error exposure config
- `defineRoute()` — bundle all schemas into one reusable definition
- Auto-wraps raw Zod schemas — no manual `zodAdapter()` call needed
- `zodAdapter()`, `joiAdapter()`, `yupAdapter()` — explicit adapters
- `isZodSchema()` — detect zod schemas at runtime

### Type inference

- `InferBody<T>`, `InferParams<T>`, `InferQuery<T>`, `InferHeaders<T>` — infer types from `defineRoute()` output

### Pre-parse guards (always on, before schema)

- Proto pollution blocking — `__proto__`, `constructor`, `prototype` stripped
- Unicode sanitization — null bytes (`\u0000`), zero-width chars (`\u200B`), RTL override (`\u202E`) removed
- Object depth limit — default 20 levels, configurable
- Array length limit — default 1000 items, configurable
- String length limit — default 10,000 chars, configurable
- Content-Type enforcement — POST/PUT/PATCH with a body requires valid Content-Type

### Errors

- `AppError` — single error class with `isOperational` flag (operational vs programmer errors)
- `AppError.notFound()`, `.unauthorized()`, `.forbidden()`, `.conflict()`, `.validation()`, `.internal()`, `.custom()`, `.fromLegacy()`
- `isAppError()` — type guard, works across module boundaries
- `errorHandler()` — centralised error middleware, always mount last
- `notFoundHandler()` — 404 for unmatched routes
- `asyncHandler()` — catches async errors in Express 4

### Logging

- FastAPI-style request logging — one clean line per event:
  ```
  09:44:57.123  [DEBUG]  >>  POST    /api/v1/users                  [req_019c...]
  09:44:57.125  [INFO]   <<  201  POST    /api/v1/users       2ms   [req_019c...]
  09:44:57.900  [ERROR]  <<  500  GET     /api/v1/crash       1ms   [req_019c...]
  09:44:57.800  [WARN]   <<  200  GET     /api/v1/data     1523ms   [req_019c...]  SLOW
  ```
- `>>` = request arriving, `<<` = response leaving — pure ASCII, safe on all terminals including Windows
- Color-coded level badges: `[DEBUG]` cyan · `[INFO]` green · `[WARN]` yellow · `[ERROR]` red
- Colors only activate when `process.stdout.isTTY` — no escape codes in CI pipes or file redirects
- `logRequestId` — toggle `[req_id]` on/off in log lines (default: `true`)
- Built-in pino integration (optional peer dep — auto-detected, no crash if absent)
- Console fallback logger with identical format and redaction when pino is not installed
- `logRequestBody` / `logResponseBody` — include sanitized body in logs (off by default)
- `slowThreshold` — SLOW warning on responses over N ms (default: disabled in dev, 1000ms in prod)
- `logAllRequests` — log every request, not just errors (default: true in dev, false in prod)
- Structured JSON payload field: `duration_ms` (self-documenting units)
- Always-redacted: `password`, `passwordHash`, `token`, `secret`, `accessToken`, `refreshToken`, `apiKey`, `cardNumber`, `cvv`, `ssn`, `pin`, `authorization` header, `cookie` header
- Production JSON output: one line per event — Datadog / CloudWatch / Loki ready

### Response helpers

- `res.ok()`, `res.created()`, `res.accepted()`, `res.noContent()`, `res.paginated()`, `res.fail()` — injected on every route
- `withShape()` — per-route response shape override (`'raw'` or field map)
- `response.shape` — global envelope field renaming
- `response.statusCodes` — configurable default status per HTTP method
- Consistent envelope: `{ success, message, data }` / `{ success, message, error }`

### Router

- `createRouter()` — drop-in for `express.Router()`
- Automatic 405 Method Not Allowed with `Allow` header
- Works correctly for parameterised routes (`/users/:id` 405s for wrong method)

### Types

- Full TypeScript types exported: `ShapeguardConfig`, `RequestIdConfig`, `LoggerConfig`, `ValidationConfig`, `ResponseConfig`, `ErrorsConfig`, `SchemaAdapter`, `RouteSchema`, `SuccessEnvelope`, `ErrorEnvelope`, `Envelope`, `PaginatedData`, `Logger`, `LogLevel`, `HttpMethod`, `ValidationIssue`, `SafeParseResult`
- Express augmentation: `req.id` typed as `string`, all `res.*` helpers typed

### Error codes

`VALIDATION_ERROR` · `NOT_FOUND` · `UNAUTHORIZED` · `FORBIDDEN` · `CONFLICT` · `INTERNAL_ERROR` · `METHOD_NOT_ALLOWED` · `BODY_TOO_DEEP` · `BODY_ARRAY_TOO_LARGE` · `STRING_TOO_LONG` · `INVALID_CONTENT_TYPE` · `PARAM_POLLUTION` · `PROTO_POLLUTION`

### Build

- ESM output (`dist/index.mjs`)
- TypeScript declarations for all exports (`dist/index.d.ts`)
- `sideEffects: false` — fully tree-shakeable
- Zero runtime dependencies — pino, joi, yup lazy-loaded only if installed
- Node.js 18+

---

## [Unreleased]

Nothing yet.

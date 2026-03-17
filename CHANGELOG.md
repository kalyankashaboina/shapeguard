<!-- Keep a Changelog — https://keepachangelog.com/en/1.0.0/ -->
<!-- Semantic Versioning — https://semver.org/spec/v2.0.0.html -->

# Changelog

All notable changes to shapeguard are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

> No unreleased changes.

---

## [0.3.1] — 2026-03-17

> **Theme: Bug fixes.** Six correctness issues found in v0.3.0 audit.
> Fully backwards-compatible — no API changes.

### Fixed

- **CJS support** (`package.json`) — added `"require"` condition to all `exports` entries and a top-level `"main"` field pointing to `dist/index.cjs`; CJS users no longer receive `ERR_REQUIRE_ESM` when calling `require('shapeguard')`
- **`allErrors:true` now returns all issues** (`AppError.validation()`) — previously only the first issue was stored in `details`; now the full array is stored when more than one issue is provided, giving clients visibility into every validation failure
- **`createDTO()` docs examples** (`README.md`, `docs/VALIDATION.md`) — examples showed a plain object being passed to `createDTO()`; the function requires a `z.object(...)` call; all examples corrected
- **Transform hook no longer swallows `AppError`** (`validate.ts`) — a `throw AppError.conflict()` (or any `AppError`) inside a `transform` function was being caught and re-thrown as a generic 500; it is now re-thrown as-is so the correct status and code reach the client
- **`slowThreshold` default fixed in dev** (`request-log.ts`) — default was `0ms` in development, making `0 > 0` always false and the `SLOW` badge never visible; default is now `500ms` in dev (`1000ms` in prod unchanged)
- **`setMaxListeners` leak removed** (`logger.ts`) — `process.setMaxListeners(getMaxListeners() + 1)` was called on every `shapeguard()` mount; with 10+ test instances this caused `MaxListenersExceededWarning`; pino v8 does not require this call and the line has been removed

---

## [0.3.0] — 2026-03-16

> **Theme: Production power.** Features serious apps need in production.
> Existing v0.2.x code is fully compatible — no breaking changes.

### Added

- `generateOpenAPI()` — auto-generate an OpenAPI 3.1 spec from `defineRoute()` definitions; zero manual schema duplication; serve as `/docs/openapi.json`
- `shapeguard/testing` — `mockRequest()`, `mockResponse()`, `mockNext()` helpers; unit-test controllers without spinning up Express or making HTTP requests
- Per-route `rateLimit` on `defineRoute()` — built-in rate limiting, no extra package; in-memory per-IP store with configurable window and max requests
- Per-route `cache` on `defineRoute()` — declarative `Cache-Control` headers (`maxAge`, `private`, `noStore`)
- `ErrorCode.RATE_LIMIT_EXCEEDED` — new stable error code for rate limit responses
- `examples/with-openapi` — working example showing OpenAPI generation + swagger-ui-express
- `examples/with-testing` — working example showing controller unit tests with test helpers
- `docs/OPENAPI.md` — full OpenAPI generation docs
- `docs/TESTING.md` — full testing utilities docs

### Changed

- `joi` and `yup` removed from `devDependencies` — they are optional peer deps, not dev deps
- Repository URL corrected in `package.json`
- `tsup.config.ts` — added `testing/index` as separate entry point for tree-shaking

---

## [0.2.0] — 2026-03-16

> **Theme: Developer experience.** Same power, significantly less code.
> Existing v0.1.x code is fully compatible — no breaking changes.

### Added

- `handle(route, handler)` — combines `validate()` + `asyncHandler()` into a single function; eliminates the two-element array pattern on every route
- `createDTO(fields)` — thin wrapper around `z.object()` that auto-infers the TypeScript input type; removes manual `z.infer<typeof ...>` on every schema definition
- Transform hook on `defineRoute()` — optional `transform(data) => data` async function that runs after validation and before the handler; use for password hashing, field normalisation, sanitization — keeps service layer pure
- Global string transforms config — `validation.strings.trim` and `validation.strings.lowercase` options in `shapeguard()`; apply `.trim()` / `.toLowerCase()` to all string fields without repeating per-field in every schema
- `logger.silent: true` — suppresses all log output; designed for test environments so `npm test` output is clean
- `examples/basic-crud-api/` — complete working Express + shapeguard app showing all v0.2.0 features end-to-end: `handle()`, `createDTO()`, transform hook, `createRouter()`, `AppError`, `res.paginated()`
- `MIGRATION.md` — upgrade guide from v0.1.x to v0.2.0

### Changed

- Joi and Yup adapters now documented with full usage examples in `README.md` and `docs/VALIDATION.md`; previously only mentioned in the types export
- `res.paginated()` now documented with a full example in `README.md`; previously only existed as a type (`PaginatedData`) with no visible usage example
- `docs/VALIDATION.md` — new sections for `handle()`, `createDTO()`, transform hook, global string transforms, and params/query/headers examples promoted to Quick Start level
- `docs/CONFIGURATION.md` — new `validation.strings` section documenting global string transform config

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

- FastAPI-style request logging — one clean line per event
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

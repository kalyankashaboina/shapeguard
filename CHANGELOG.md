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

## [0.8.1] — 2026-03-31

> **Patch:** Docker reorganisation, standalone Swagger docs, test fixes, and enterprise CI.
> Fully backwards-compatible — no breaking changes.

### Fixed

- **8 test failures** in v0.8.0-features.test.ts and v0.6.1-bugfixes.test.ts
  - `zodAdapter()` now exposes `schema` property — `generateOpenAPI()` Zod type mapping now works (ZodLiteral, ZodUnion, ZodNumber checks, ZodString format, `required[]` array)
  - `makeReq()` test mock now includes `headers: {}` and `socket` — shapeguard() unit tests no longer crash
  - BUG#5 logger precedence test rewritten to correctly distinguish errorHandler calls from request-logger calls

### Changed

- **Docker files moved to `docker/` folder** — `docker/Dockerfile`, `docker/docker-compose.yml`, `docker/.dockerignore`
- `docker-compose.yml` now uses 3-stage build (deps/builder/example), named services, Redis auth on Commander
- All `npm run docker:*` scripts updated to use `-f docker/docker-compose.yml`
- `docker:clean` script added to remove volumes and local images

### Added

- **`createDocs()` / `generateOpenAPI()` standalone docs** — README and OPENAPI.md now lead with the 3-line minimum case. No `defineRoute()`, no `shapeguard()` middleware required.
- **Docker badge** in README
- **`auto-merge.yml`** — auto-merges Dependabot patch/minor PRs after CI passes
- **`lock.yml`** — locks closed issues/PRs after 30 days inactivity
- **`greet.yml`** — welcomes first-time contributors with next-steps guidance
- **`release-drafter.yml`** + `.github/release-drafter.yml` — auto-drafts release notes from merged PR titles
- **`release.yml` improvements**: pre-release npm tag (`next`), failure notification with recovery instructions, bundle size guard before publish
- **`ci.yml` fix**: coverage collected (`npm run test:coverage`) before Codecov upload
- `validate-release.ps1` now referenced in `CONTRIBUTING.md` release process
- `shapeguard-versions.svg` updated — includes v0.6.1, v0.7.0, v0.8.0
- `shapeguard-comparison.svg` updated — includes verifyWebhook, cursorPaginated, AppError.define()

### Removed

- `release.ps1` and `setup-project.ps1` — replaced by `validate-release.ps1`
- Stale images removed from README (`shapeguard-logging.svg`, `shapeguard-response-shapes.svg`)

---
## [0.8.0] — 2026-03-28

> **Theme: Enterprise completeness.** Production-grade createDocs(), cursor pagination, webhook verification, and typed error factories. shapeguard now covers every feature gap vs NestJS/tsoa/Hono in the areas it targets.
> Fully backwards-compatible — no breaking changes.

### Added

#### `createDocs()` — enterprise Swagger UI (major upgrade from v0.7.0)

- **`validatorUrl: 'none'`** — disables external validator.swagger.io calls (all competitor libraries do this; we now do too — eliminates noisy console warnings in browser)
- **`docExpansion`** — `'none' | 'list' | 'full'` — controls how operations render on load (default: `'list'`)
- **`defaultModelsExpandDepth`** — controls how deeply schema models expand (default: 1; set -1 to collapse all)
- **`defaultModelExpandDepth`** — controls individual model expansion depth
- **`operationsSorter`** — `'alpha' | 'method' | 'none'` — sort operations alphabetically or by HTTP method
- **`tagsSorter`** — `'alpha' | 'none'` — sort tag groups
- **`showExtensions`** — show `x-*` vendor extensions in the UI (default: false)
- **`showCommonExtensions`** — show `x-nullable`, `x-example`, etc.
- **`displayOperationId`** — show operationId badges on each operation
- **`maxDisplayedTags`** — limit visible tag groups
- **`requestInterceptor`** — JavaScript function string injected as Swagger UI's `requestInterceptor`. Use to auto-inject auth headers, request IDs, or log outgoing requests. Example: `"request.headers['X-Trace'] = crypto.randomUUID(); return request;"`
- **`responseInterceptor`** — JavaScript function string for response inspection/logging
- **`withCredentials`** — send cookies on Try-It-Out requests
- **`oauth2RedirectUrl`** — OAuth2 redirect callback URL
- **`logo`** — `{ url, altText?, backgroundColor? }` — custom logo above the Swagger UI topbar
- **`headHtml`** — raw HTML injected before `</head>` — use for analytics scripts, custom fonts
- **`csp`** — Content-Security-Policy header value. Default: auto-generated safe policy covering CDN scripts and styles. Pass `false` to disable. Production APIs should leave this as default.
- **Security headers** — `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` set on every docs response

#### `generateOpenAPI()` — spec generation improvements

- **`deprecated` flag** — set `deprecated: true` on any route definition; renders as a strikethrough in Swagger UI
- **`description` per route** — separate from `summary`; shown as expanded operation description
- **`externalDocs` per route** — link to external documentation from any operation
- **`extensions`** — `Record<string, unknown>` of `x-*` vendor extensions merged onto the operation object
- **`bodyType`** — `'json' | 'multipart' | 'form'` — controls the `requestBody` content type:
  - `'multipart'` generates `multipart/form-data` with automatic file field detection (fields named `file`, `image`, `avatar`, `attachment`, etc. get `format: binary`)
  - `'form'` generates `application/x-www-form-urlencoded`
  - `'json'` (default) is unchanged
- **`responseHeaders`** — document response headers in the 200 schema (e.g. `X-Request-Id`, `Retry-After`)
- **Top-level `tags` array** — define tag objects with descriptions and externalDocs at the spec level
- **Top-level `externalDocs`** — link to external API documentation at the spec level
- **`termsOfService`, `contact`, `license`** in spec `info` block
- **Extended number/integer schemas** — `z.number().min().max()` and `z.number().multipleOf()` now produce `minimum`, `maximum`, `multipleOf` in the schema
- **`ZodReadonly`** — produces `readOnly: true`
- **`ZodTuple` with rest element** — variadic tuples map correctly to `prefixItems` + `items`
- **All-literal union optimization** — `z.union([z.literal('a'), z.literal('b')])` produces `{ enum: ['a', 'b'] }` instead of `{ oneOf: [...] }`
- **`ZodPipeline`** — maps to the `out` schema (what consumers receive)
- **`ZodSymbol`**, **`ZodFunction`** — safe fallbacks instead of crashes
- **String format additions**: `base64` → `byte`, `jwt` (pattern), `nanoid` (pattern), `cidr`, `includes` → pattern

#### `res.cursorPaginated()` — cursor-based pagination

Cursor pagination is the enterprise standard for large datasets and infinite scroll. Offset pagination (`res.paginated()`) breaks when data changes between pages — cursors don't.

```ts
res.cursorPaginated({
  data:       users,
  nextCursor: users.at(-1)?.id ?? null,
  prevCursor: req.query.cursor ?? null,
  hasMore:    users.length === limit,
  total:      1000,            // optional
})
// Response:
// { success: true, data: { items: [...], nextCursor: 'user_abc', prevCursor: null, hasMore: true } }
```

#### `verifyWebhook()` — HMAC webhook signature middleware

Zero-dependency webhook verification. Uses `crypto.timingSafeEqual()` to prevent timing attacks. Supports replay attack prevention (timestamp tolerance window).

```ts
import { verifyWebhook } from 'shapeguard'

router.post('/webhooks/stripe',
  verifyWebhook({ provider: 'stripe', secret: process.env.STRIPE_SECRET! }),
  handler,
)
```

Built-in presets: `stripe` (timestamp + replay protection), `github` (sha256=), `shopify` (base64 HMAC), `twilio` (sha1 base64), `svix` (timestamp + replay protection).

Custom providers:
```ts
verifyWebhook({
  secret:    process.env.MY_SECRET!,
  algorithm: 'sha256',
  headerName: 'x-my-signature',
  prefix:     'sha256=',
  encoding:   'hex',
  onFailure: (req, reason) => alerting.notify(reason),
})
```

#### `AppError.define()` — typed error factory

Define reusable, TypeScript-safe error constructors once. No more `Record<string, unknown>` guessing.

```ts
const RateLimitError = AppError.define<{ retryAfter: number; limit: number }>(
  'RATE_LIMIT_EXCEEDED', 429, 'Too many requests'
)
throw RateLimitError({ retryAfter: 30, limit: 100 })
//                    ^-- TypeScript error if fields wrong or missing

const PaymentError = AppError.define<{ amount: number; currency: string }>(
  'PAYMENT_FAILED', 402
)
throw PaymentError({ amount: 9.99, currency: 'USD' }, 'Payment declined')
```

### Exported

- `verifyWebhook` and `WebhookConfig` from main `shapeguard` entry
- `CursorPaginatedData` and `ResCursorPaginatedOpts` types from `shapeguard`

---

## [0.7.0] — 2026-03-28

> **Theme: Swagger docs that actually work.** Two P0 feature gaps closed — security schemes so the padlock button functions, and a built-in `createDocs()` endpoint so zero extra packages are needed. Extended Zod type coverage and automatic 400/401/403/429 responses round out enterprise-grade OpenAPI output.
> Fully backwards-compatible — no breaking changes.

### Added

- **`security` option in `generateOpenAPI()`** — define named security schemes once (bearer JWT, API key, basic, OAuth2); the Swagger UI padlock button is now fully functional. Previously the padlock rendered but did nothing.

  ```ts
  generateOpenAPI({
    security: {
      bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey:  { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    defaultSecurity: ['bearer'],
    routes: { ... },
  })
  ```

- **`defaultSecurity` option** — applies the listed schemes to every operation automatically; override per-route via `route.security: ['otherScheme']` or mark as public with `route.security: []`.

- **Per-route `security` override on inline route definitions** — `security: string[] | null` on any route definition; `[]` generates `security: []` in the spec (explicit public endpoint).

- **`createDocs()` — built-in Swagger UI endpoint** — mounts a fully themed, auth-enabled Swagger UI at any path. No `swagger-ui-express` or other extra package needed. CDN-loaded assets, persistent authorization, dark/light/auto theme.

  ```ts
  import { createDocs } from 'shapeguard'
  app.use('/docs', createDocs({ spec, title: 'My API', theme: 'dark' }))
  // → http://localhost:3000/docs — works immediately
  ```

- **`DocsConfig`, `SecuritySchemeType`, `InlineRouteDefinition` exported** from both `shapeguard` and `shapeguard/openapi`.

- **Automatic 400 response** on all operations — pre-parse guard errors (repeated query param, body too deep, string too long) now appear in the spec.

- **Automatic 401 + 403 responses** on secured operations — generated whenever `defaultSecurity` or per-route `security` includes at least one scheme.

- **Automatic 429 response** on rate-limited routes — generated whenever the route definition includes a `rateLimit` option; schema includes the `retryAfter` field.

- **Extended Zod type mapping** — `toJsonSchema()` now covers: `ZodInteger`/`ZodInt`, `ZodBigInt` (`int64`), `ZodNull`, `ZodLiteral` (with `const` + `enum`), `ZodUnion`/`ZodDiscriminatedUnion` (`oneOf`), `ZodIntersection` (`allOf`), `ZodTuple` (`prefixItems`), `ZodRecord` (`additionalProperties`), `ZodSet` (`uniqueItems`), `ZodNaN`, `ZodAny`, `ZodUnknown`, `ZodVoid`, `ZodNever` (`not: {}`), `ZodBranded`, `ZodPipeline`, `ZodCatch`, `ZodLazy`. Previously these all fell back to `{ type: 'string' }`.

- **`required` array in object schemas** — properties that are not `ZodOptional` or `ZodDefault` are now listed in the JSON Schema `required` array, making validators and SDK generators behave correctly.

- **Extended string format mapping** — `z.string().date()` → `format: date`, `.time()` → `format: time`, `.ip()` → `format: ipv4`, `.cuid()`, `.cuid2()`, `.ulid()`, `.startsWith()`, `.endsWith()`, `.emoji()` all produce correct schema annotations.

- **`createDocs` exported from `shapeguard/openapi` subpath** — importable from both the main entry and the subpath.

### Changed

- **`with-openapi` example updated** — now uses `createDocs()` and `security` schemes; shows public vs protected route split; demonstrates `rateLimit` producing a 429 entry in the spec.

- **`docs/OPENAPI.md` rewritten** — new sections: Security schemes, createDocs() API reference, per-route security override, supported scheme types, extended response table.

---

## [0.6.1] — 2026-03-28

> **Theme: Security and correctness patch.** All 12 confirmed bugs from the v0.6.0 audit fixed.
> Zero breaking changes — all existing APIs remain compatible.

### Security

- **[CRITICAL] PARAM_POLLUTION now actually thrown** (`validate.ts`) — the `PARAM_POLLUTION` error code was declared, documented, and mapped to HTTP 400, but never fired. Express parses `?role=admin&role=user` as `role: ['admin','user']` — a scalar field receiving an unexpected array. Shapeguard now walks all `req.query` entries before schema validation and throws `PARAM_POLLUTION` (400) on the first array-valued parameter. Closes the query-pollution attack vector that previously fell through to a generic 422.

- **[CRITICAL] Response stripping no longer silently disabled when shape config renames `data`** (`validate.ts`, `shapeguard.ts`) — when `response.shape` was configured to rename the `data` envelope key (e.g. `result: '{data}'`), `patchResponseStrip` checked for `'data' in body` which always failed on the already-shaped response. Sensitive fields (`passwordHash`, `stripeId`, etc.) leaked to the client with no error or warning. Fixed by threading `ResponseConfig` through to `patchResponseStrip` and resolving the actual data key via a new `getDataKey()` helper.

### Fixed

- **[HIGH] `./openapi` subpath import now resolves** (`package.json`) — `import { generateOpenAPI } from 'shapeguard/openapi'` previously threw `MODULE_NOT_FOUND` at runtime despite the entry point being built by tsup. Added the missing `"./openapi"` export condition pointing to `dist/openapi/index.*`.

- **[HIGH] Rate limit in-memory store no longer leaks memory** (`validate.ts`) — expired entries were never removed from `_rlStore`. On a long-running server with many unique client IPs the Map grew without bound. Stale entries are now deleted before a fresh window entry is written.

- **[HIGH] `errorHandler()` auto-discovers `shapeguard()`'s logger** (`shapeguard.ts`, `error-handler.ts`) — `shapeguard()` now stores its logger on `req.app.locals['__sg_logger__']`. `errorHandler()` reads it as a fallback when no explicit `logger` option is passed, so 5xx errors are logged through the same structured logger without any manual wiring. Existing explicit `logger:` option still takes precedence — zero API change.

- **[MEDIUM] Cache-Control headers no longer set before validation result is known** (`validate.ts`) — `applyCacheHeaders()` was called before `validateRequest()` ran, so CDNs (Cloudflare, Fastly, CloudFront) could cache 422 validation-error responses. Headers are now set only after `validateRequest()` resolves successfully.

- **[MEDIUM] Rate limit store isolated per route** (`validate.ts`) — `_rlStore` was a module-level singleton shared across every `validate()` call in the same process. Two app instances (e.g. dev + prod in integration tests) shared rate limit counters. Each `validate()` call now closes over its own `Map`, fully isolating counters per route and per app instance. `_clearRateLimitStore()` kept for backward compatibility.

- **[MEDIUM] `logResponseBody` captures post-strip body** (`request-log.ts`) — clarified and documented the capture ordering: `captureResponseBody` registers as the inner wrapper; `patchResponseStrip` registers as the outer wrapper. The inner wrapper is called from inside the strip `.then()`, so the captured body is always the already-stripped payload (what the client receives), not the pre-strip data.

- **[LOW] `winston` added to tsup `external` list** (`tsup.config.ts`) — previously absent, which meant downstream bundlers could accidentally inline the entire winston package into their output bundle.

- **[LOW] Route-level `allErrors` now controls Joi/Yup error collection** (`validate.ts`) — `validate({ allErrors: true })` now correctly threads through to Joi/Yup adapter instances via `normalise()`. A new `makeAllErrorsAdapter()` wrapper respects the route-level flag regardless of how the adapter was created.

- **[LOW] `winston` moved from `peerDependencies` to `optionalDependencies`** (`package.json`) — winston was listed as a peer dependency (causing `npm install` warnings for users who don't use it). Moved to `optionalDependencies` alongside joi, yup, pino.

- **[LOW] `withShape()` + `validate()` middleware ordering documented** (`docs/RESPONSE.md`) — the required mount order (`validate()` before `withShape()`) is now documented with working and broken examples. Includes an explanation of why the wrong order silently skips field stripping.

### Improved

- **`Retry-After` HTTP header set on 429 responses** (`validate.ts`) — the retry window was previously only in the response body (`details.retryAfter`). RFC 7231 requires the `Retry-After` header on 429 responses. Load balancers, API gateways, and retry libraries (axios-retry, etc.) read this header natively. Both the header and body field are now set.

- **`cache` option: discriminated union — `noStore` no longer requires `maxAge`** (`validate.ts`, `define-route.ts`) — `cache: { noStore: true }` is now the complete and correct way to disable caching. Previously TypeScript required `maxAge` even though it was ignored when `noStore` was set.

- **`cache` option: CDN directives `sMaxAge` and `staleWhileRevalidate` supported** (`validate.ts`, `define-route.ts`) — teams using CDN-fronted APIs can now set separate browser and CDN TTLs: `cache: { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 60 }` produces `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60`.

- **Testing: async strip behaviour documented** (`docs/TESTING.md`) — added a dedicated section explaining why unit tests asserting on stripped response bodies must `await Promise.resolve()` after calling the handler, with correct and incorrect examples, and a note that supertest integration tests are unaffected.

---

## [0.6.0] — 2026-03-17

> **Theme: Logger control.** Four new options giving teams precise control over what appears in terminal and log files. Every option is independent — use one, some, or all. Zero config change needed for existing apps.

### Added

- **`logIncoming: false`** (`LoggerConfig`) — hides the `>>` request arrival lines entirely while keeping `<<` response lines; useful when you want response times and status codes but not the extra arrival noise in busy terminals
- **`shortRequestId: true`** (`LoggerConfig`) — shows only the last 8 characters of the request ID on log lines (e.g. `[req_019cfa6f...]` → `[3a3045a]`); the full ID is still generated and forwarded in headers, only the terminal display is shortened
- **`logClientIp: true`** (`LoggerConfig`) — logs the client IP address on each response line; reads `x-forwarded-for` first (load balancer / proxy), then falls back to `socket.remoteAddress`; IP is also included in the structured JSON payload as `ip`
- **`lineColor: 'level'`** (`LoggerConfig`) — colours the entire log line (method + status) based on the response status level (`2xx`=green, `4xx`=yellow, `5xx`=red) instead of the default HTTP method colour (`GET`=green, `POST`=cyan, `DELETE`=red); only affects dev/pretty output — JSON prod logs are unaffected

---

## [0.5.0] — 2026-03-17

> **Theme: OpenAPI overhaul.** Five bugs fixed, three new capabilities added.
> Fully backwards-compatible — no breaking changes.

### Added

- **`prefix` option in `generateOpenAPI()`** — pass `prefix: '/api/v1'` once and it is prepended to every route path automatically; no more repeating the prefix on every key
- **`operationId` auto-generated** — every operation now gets a stable, SDK-friendly `operationId` derived from its method and path (e.g. `POST /users/:id` → `postUsersId`); SDK generators no longer produce unnamed operations
- **`tags` and `summary` per route** — add `tags` and `summary` directly to any `defineRoute()` result or inline route definition; Swagger UI groups and labels operations correctly
- **Inline route definitions** (`InlineRouteDefinition`) — existing Express apps can now describe schemas directly inside `generateOpenAPI()` without using `defineRoute()` at all; unlocks Swagger for apps that don't want to change their routes

### Fixed

- **422 and 500 responses now include the full error envelope schema** — previously both had only a `description` string; now each includes the complete `{ success, message, error: { code, message, details } }` shape that `errorHandler()` actually sends
- **Duplicate route keys warned and skipped** — two routes resolving to the same method + path now emit a `console.warn` and keep the first definition; previously the second silently overwrote the first with no indication
- **Trailing slash creates duplicate paths** — `GET /users` and `GET /users/` now normalise to the same `/users` path in the spec; previously they appeared as two separate paths
- **`ZodBoolean`, `ZodNumber`, `ZodArray`, `ZodEnum`, `ZodObject` type mapping** — all Zod types now map correctly to their JSON Schema equivalents *(already fixed in v0.4.0 codebase, confirmed and tested in v0.5.0)*
- **Response schema used in 200 envelope** — the `response` field in `defineRoute()` now populates the `data` property of the 200 response schema *(already fixed in v0.4.0 codebase, confirmed and tested in v0.5.0)*

---

## [0.4.0] — 2026-03-17

> **Theme: Correctness and extensibility.** Eight bugs fixed, Winston adapter shipped.
> Fully backwards-compatible — no breaking changes.

### Added

- `shapeguard/adapters/winston` — ships a `winstonAdapter()` function that bridges Winston's argument order (`msg, meta`) to shapeguard's Logger interface (`meta, msg`); import and pass to `logger.instance` — no manual wrapper needed

### Fixed

- **Logger instance validated at mount time** (`logger.ts`) — passing a logger without `.debug()`, `.info()`, `.warn()`, or `.error()` now throws a clear error immediately listing the missing methods, rather than crashing with a `TypeError` on the first request; error message explicitly mentions `shapeguard/adapters/winston`
- **`withShape` warns on undefined tokens** (`with-shape.ts`) — in development, a `console.warn` is emitted when a template token (e.g. `{data.uptime}`) does not exist in the response; catches path typos immediately rather than silently sending `undefined` to clients
- **Global config no longer shared between `shapeguard()` instances** (`validate.ts`, `shapeguard.ts`) — removed the `setFallbackValidationConfig` module-level singleton; config is now scoped exclusively via `res.locals` per request, so two app instances running in the same process (e.g. integration tests with dev + prod apps) can no longer overwrite each other's validation config
- **Joi/Yup `allErrors` option** (`adapters/joi.ts`, `adapters/yup.ts`) — both adapters now respect the `allErrors` option passed to `joiAdapter()` and `yupAdapter()`; previously `abortEarly` was hardcoded to `true` so `allErrors` had zero effect *(already fixed in v0.3.1 codebase, confirmed and tested in v0.4.0)*
- **`router.route()` 405 tracking** (`router/create-router.ts`) — `router.route('/users').get().post()` pattern is now intercepted by the proxy and tracked for 405 Method Not Allowed responses *(already fixed in v0.3.1 codebase, confirmed and tested in v0.4.0)*
- **`Object.freeze` scoped to envelope only** (`core/response.ts`) — `res.created({ data: user })` no longer deep-freezes the caller's `user` variable; only the response envelope wrapper is frozen *(already fixed in v0.3.1 codebase, confirmed and tested in v0.4.0)*
- **`mockRequest` socket, ip, and `req.get`** (`testing/index.ts`) — `socket.remoteAddress`, `ip`, and `get(header)` are now present; rate limiter tests no longer share a single bucket due to unknown IP *(already fixed in v0.3.1 codebase, confirmed and tested in v0.4.0)*

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

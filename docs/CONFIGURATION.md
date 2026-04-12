# Configuration — shapeguard

> Every config option. Global vs scoped. Defaults. Override patterns.

---

## Table of contents

- [Global vs scoped](#global-vs-scoped)
- [shapeguard() config reference](#shapeguard-config)
- [validate() config reference](#validate-config)
- [errorHandler() config](#errorhandler-config)
- [notFoundHandler() config](#notfound-config)
- [createRouter() config](#router-config)
- [Quick reference table](#reference)

---

## Global vs scoped <a name="global-vs-scoped"></a>

```
GLOBAL — set once in shapeguard(), applies everywhere
  logger behaviour (level, pretty, body logging, redaction)
  validation limits and error exposure
  response shape and status codes
  error fallback message and hooks

SCOPED — set per-route in validate() or withShape()
  which schemas to validate on this route
  per-route limit overrides (larger/smaller than global)
  per-route sanitize config
  response shape for this route only
```

```ts
// GLOBAL — in app.ts
app.use(shapeguard({
  logger:     { level: 'warn', slowThreshold: 1000 },
  validation: { exposeEnumValues: false },
  response:   { includeRequestId: true },
  errors:     { fallbackMessage: 'Something went wrong' },
}))

// SCOPED — per route
validate({ body: CreateUserBodySchema, limits: { maxStringLength: 500 } })
```

---

## shapeguard() config reference <a name="shapeguard-config"></a>

```ts
app.use(shapeguard({

  // ── debug mode ─────────────────────────────────────────────────
  // Controls error detail exposure and log verbosity.
  // Default: auto-detected from NODE_ENV
  //   NODE_ENV !== 'production' → debug: true
  //   NODE_ENV === 'production'  → debug: false
  debug: false,

  // ── global request timeout ──────────────────────────────────────
  // Applies to ALL routes unless overridden by defineRoute({ timeout }).
  // Handler must respond within this time or a 408 is returned.
  // Default: no timeout.
  timeout: 30_000,  // 30 seconds

  // ── request ID ─────────────────────────────────────────────────
  // Controls how req.id is generated and where it comes from.
  requestId: {
    // Generate a unique ID for every request (default: true).
    // Set false to disable — req.id will be '' and [req_id] won't appear in logs.
    enabled: true,

    // Header to read the request ID from BEFORE generating one.
    // Use this when a load balancer / API gateway already set a trace ID
    // so the same ID flows through all your services.
    // Default: 'x-request-id'. Also common: 'x-trace-id', 'x-correlation-id'.
    // Falls back to generating a fresh ID if the header is absent.
    header: 'x-request-id',

    // Custom ID generator — replaces the built-in req_<timestamp><random> format.
    // Must return a non-empty string. Called once per request.
    // generator: () => `trace-${crypto.randomUUID()}`,
  },

  // ── logger ─────────────────────────────────────────────────────
  logger: {

    // Bring your own — any { info, warn, error, debug } interface.
    // pino, winston, console all work.
    // When provided, all other logger options are ignored.
    instance: yourLoggerInstance,

    // Log level. Default: 'debug' dev / 'warn' prod.
    level: 'warn',                   // 'debug' | 'info' | 'warn' | 'error'

    // Pretty-print (pino-pretty). Default: true dev / false prod.
    pretty: false,

    // Log every request including successful 2xx.
    // Default: true dev / false prod
    // false = only errors (4xx/5xx) and slow requests are logged
    logAllRequests: false,

    // Show >> arrival lines (default: true).
    // false = hide arrival lines, keep only << response lines
    logIncoming: false,

    // Show [req_id] on every log line.
    // Default: true — set false to hide request ID from log output.
    // (separate from response.includeRequestId which controls the HTTP header)
    logRequestId: true,

    // Show only last 8 characters of request ID in log output.
    // Full ID still generated and forwarded in X-Request-Id header.
    // Default: false
    shortRequestId: true,

    // Log client IP on each response line.
    // Reads x-forwarded-for first, then socket.remoteAddress.
    // Default: false
    logClientIp: true,

    // Line colour mode in dev/pretty output.
    // 'method' (default): GET=green, POST=cyan, DELETE=red
    // 'level':            2xx=green, 4xx=yellow, 5xx=red
    lineColor: 'level',

    // Flag requests slower than this many milliseconds.
    // 0 = disabled entirely.
    // Default: 500 dev / 1000 prod
    slowThreshold: 1000,

    // Include req.body in the request log entry.
    // Sensitive keys (password, token, secret etc) always redacted.
    // Default: false — bodies often contain PII, enable with care
    logRequestBody: false,

    // Include the response JSON body in the log entry.
    // Default: false — may contain PII or large payloads
    logResponseBody: false,

    // Additional field paths to redact from logs.
    // Appended to built-in list — never replaces it.
    // Always-redacted: password, passwordHash, token, secret, accessToken,
    //                  refreshToken, apiKey, cardNumber, cvv, ssn,
    //                  req.headers.authorization, req.headers.cookie
    redact: [
      'req.body.dateOfBirth',
      'req.body.nationalId',
    ],
  },

  // ── validation ─────────────────────────────────────────────────
  validation: {

    // Global string transforms — applied to every string field in every schema.
    // Saves repeating .trim() / .toLowerCase() on each field individually.
    // Default: both false
    strings: {
      trim:      true,   // auto-trim whitespace from every string field
      lowercase: false,  // auto-lowercase every string field
    },

    // Show the field name in validation errors.
    // Default: true always (field names are client input — safe to show)
    exposeFieldName: true,

    // Show the human-readable error message.
    // Default: true always
    exposeMessage: true,

    // Show enum option values in errors like "Expected 'admin' | 'user'".
    // Default: false prod / true dev (enum values can reveal your data model)
    exposeEnumValues: false,

    // Show raw Zod error codes like 'invalid_type', 'too_small'.
    // Default: false always (reveals internal schema library)
    exposeZodCodes: false,

    // Pre-parse limits — apply before any schema runs.
    // These protect against DoS and proto pollution.
    limits: {
      maxDepth:        20,           // object nesting levels
      maxArrayLength:  1000,         // items in any array
      maxStringLength: 10_000,       // characters in any string field
    },
  },

  // ── response ───────────────────────────────────────────────────
  response: {

    // Rename envelope fields globally.
    // Available tokens: {success}, {data}, {message}
    shape: {
      status:  '{success}',          // success → status
      result:  '{data}',             // data    → result
      msg:     '{message}',          // message → msg
    },

    // Override default HTTP status code per method.
    statusCodes: {
      POST:   201,                   // default
      GET:    200,                   // default
      PUT:    200,                   // default
      PATCH:  200,                   // default
      DELETE: 200,                   // default
    },

    // Add X-Request-Id header to every response.
    // Useful for client-side error reporting.
    // Default: false
    includeRequestId: false,
  },

  // ── errors ─────────────────────────────────────────────────────
  errors: {

    // Message shown to clients for programmer errors (5xx non-AppError) in prod.
    // Default: 'Something went wrong'
    fallbackMessage: 'Something went wrong',

    // Hook called after every error, before response is sent.
    // Use for Sentry, Datadog, PagerDuty, alerting.
    // Never throws — if the hook throws, it is silently ignored.
    onError: (err: AppError, req: Request) => {
      Sentry.captureException(err, {
        extra: { requestId: req.id, path: req.path }
      })
    },
  },

}))
```

---

## validate() config reference <a name="validate-config"></a>

Scoped to one route. Never affects other routes.

```ts
// full route bundle from defineRoute()
validate(CreateUserRoute)

// individual schemas
validate({
  body:    CreateUserBodySchema,
  params:  UserParamsSchema,
  query:   UserQuerySchema,
  headers: UserHeadersSchema,
  sends:   UserResponseSchema,   // strips response fields
})

// return all validation errors in one part, not just the first
validate({
  body:      CreateUserBodySchema,
  allErrors: true,
})

// override pre-parse limits for this route only
validate({
  body:   FileUploadSchema,
  limits: { maxStringLength: 500_000 },   // larger for file routes
})

// override validation error exposure for this route
validate({
  body:     LoginSchema,
  sanitize: { exposeEnumValues: false },  // hide enum values on this route
})
```

### validate() options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `body` | `ZodSchema \| SchemaAdapter` | — | Validate + type `req.body` |
| `params` | `ZodSchema \| SchemaAdapter` | — | Validate + type `req.params` |
| `query` | `ZodSchema \| SchemaAdapter` | — | Validate + type `req.query` |
| `headers` | `ZodSchema \| SchemaAdapter` | — | Validate headers |
| `sends` / `response` | `ZodSchema \| SchemaAdapter` | — | Strip response fields |
| `allErrors` | `boolean` | `false` | Return all errors in one part |
| `limits.maxDepth` | `number` | global (20) | Per-route nesting limit |
| `limits.maxArrayLength` | `number` | global (1000) | Per-route array limit |
| `limits.maxStringLength` | `number` | global (10000) | Per-route string limit |
| `sanitize.exposeFieldName` | `boolean` | global (true) | Show field in error |
| `sanitize.exposeMessage` | `boolean` | global (true) | Show message in error |
| `sanitize.exposeEnumValues` | `boolean` | global | Show enum options |
| `sanitize.exposeZodCodes` | `boolean` | global (false) | Show Zod codes |

---

## errorHandler() config <a name="errorhandler-config"></a>

```ts
app.use(errorHandler({
  // message for programmer errors in prod
  fallbackMessage: 'Something went wrong',

  // hook fires after every error, before response sent
  onError: (err: AppError, req: Request) => {
    if (err.statusCode >= 500) alertingService.critical(err)
  },
}))
```

> **Note:** `errorHandler()` has its own config separate from `shapeguard()`.
> The `errors:` block in `shapeguard({ errors: {...} })` configures shapeguard's
> internal middleware. You still pass separate config to `errorHandler()`.

---

## notFoundHandler() config <a name="notfound-config"></a>

```ts
// basic — message includes method + path
app.use(notFoundHandler())
// "Cannot GET /api/unknown"

// custom fixed message
app.use(notFoundHandler({ message: 'Route not found' }))
```

---

## createRouter() config <a name="router-config"></a>

Drop-in for `express.Router()`. Accepts all Express router options.

```ts
const router = createRouter()
const router = createRouter({ strict: false, mergeParams: true })
```

Automatically returns 405 with `Allow` header for registered paths used
with wrong HTTP method. Works with parameterized routes like `/:id`.

---

## Quick reference table <a name="reference"></a>

### shapeguard() — requestId options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requestId.enabled` | `boolean` | `true` | Generate request IDs |
| `requestId.header` | `string` | `'x-request-id'` | Upstream header to read first |
| `requestId.generator` | `() => string` | built-in | Custom ID generator |

### shapeguard() — logger options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger.instance` | `Logger` | built-in | Custom logger |
| `logger.level` | `string` | `'debug'` dev / `'warn'` prod | Log level |
| `logger.pretty` | `boolean` | `true` dev / `false` prod | pino-pretty format |
| `logger.logAllRequests` | `boolean` | `true` dev / `false` prod | Log every 2xx |
| `logger.logIncoming` | `boolean` | `true` | Show `>>` arrival lines |
| `logger.logRequestId` | `boolean` | `true` | Show [req_id] in log lines |
| `logger.shortRequestId` | `boolean` | `false` | Show last 8 chars of req ID only |
| `logger.logClientIp` | `boolean` | `false` | Log client IP on response lines |
| `logger.lineColor` | `'method' \| 'level'` | `'method'` | Line colour mode |
| `logger.slowThreshold` | `number` | `500` dev / `1000` prod | Slow warn ms (0=off) |
| `logger.logRequestBody` | `boolean` | `false` | Log req.body (redacted) |
| `logger.logResponseBody` | `boolean` | `false` | Log response JSON (redacted) |
| `logger.redact` | `string[]` | `[]` | Extra redact paths |

### shapeguard() — validation options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `validation.strings.trim` | `boolean` | `false` | Auto-trim all string fields |
| `validation.strings.lowercase` | `boolean` | `false` | Auto-lowercase all string fields |
| `validation.exposeFieldName` | `boolean` | `true` | Field name in errors |
| `validation.exposeMessage` | `boolean` | `true` | Message in errors |
| `validation.exposeEnumValues` | `boolean` | `false` prod | Enum values in errors |
| `validation.exposeZodCodes` | `boolean` | `false` | Zod codes in errors |
| `validation.limits.maxDepth` | `number` | `20` | Max nesting depth |
| `validation.limits.maxArrayLength` | `number` | `1000` | Max array size |
| `validation.limits.maxStringLength` | `number` | `10000` | Max string chars |

### shapeguard() — response options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `response.shape` | `object` | default envelope | Rename envelope fields |
| `response.statusCodes` | `object` | `{POST:201,*:200}` | Status per method |
| `response.includeRequestId` | `boolean` | `false` | X-Request-Id header |

### shapeguard() — errors options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `errors.fallbackMessage` | `string` | `'Something went wrong'` | 5xx message in prod |
| `errors.onError` | `function` | — | Hook for Sentry / alerting |

### AppError factories

| Factory | Status | Code |
|---------|--------|------|
| `AppError.notFound(resource?)` | 404 | `NOT_FOUND` |
| `AppError.unauthorized(msg?)` | 401 | `UNAUTHORIZED` |
| `AppError.forbidden(msg?)` | 403 | `FORBIDDEN` |
| `AppError.conflict(resource?)` | 409 | `CONFLICT` |
| `AppError.validation(issues)` | 422 | `VALIDATION_ERROR` |
| `AppError.internal(msg?)` | 500 | `INTERNAL_ERROR` |
| `AppError.custom(code,msg,status,details?)` | any | any |
| `AppError.fromUnknown(err)` | varies | varies |
| `AppError.fromLegacy({code,message,statusCode})` | any | any |

### res helpers

| Helper | Status | Notes |
|--------|--------|-------|
| `res.ok(opts)` | 200 (configurable) | General success |
| `res.created(opts)` | 201 (always) | POST created |
| `res.accepted(opts)` | 202 (always) | Async job accepted |
| `res.noContent()` | 204 (always) | No body |
| `res.paginated(opts)` | 200 | List with pagination metadata |
| `res.fail(opts)` | 400 (configurable) | Inline error response |

---

## Per-route rate limiting — `rateLimit` <a name="ratelimit"></a>

> Available on `defineRoute()`

Built-in rate limiting. No extra package needed. Applied per IP + route path by default.

> ⚠️ **Single-process only.** The built-in store is an in-memory Map per route. In multi-process deployments (PM2 cluster, Kubernetes pods), each process maintains its own counter — effective limit is `max × processes`. For distributed rate limiting, pass a Redis store: `defineRoute({ rateLimit: { windowMs, max, store: myRedisStore } })`
>
> ⚠️ **IP spoofing without trust proxy.** The default key uses `x-forwarded-for`, which is spoofable. Set `app.set('trust proxy', 1)` before `shapeguard()` for correct IP detection behind a load balancer.

```ts
defineRoute({
  body:      CreateUserDTO,
  rateLimit: {
    windowMs:  60_000,  // time window in milliseconds (60s here)
    max:       10,       // max requests per window per key
    message:   'Too many requests — please try again later',  // optional

    // ── Advanced: plug in Redis or any external store ──────────
    // Default is in-memory (single instance). For multi-instance
    // production apps, provide a Redis-backed store:
    store: {
      async get(key: string) {
        const raw = await redis.get(key)
        return raw ? JSON.parse(raw) : null
      },
      async set(key: string, value: { count: number; reset: number }) {
        const ttl = Math.ceil((value.reset - Date.now()) / 1000)
        await redis.set(key, JSON.stringify(value), 'EX', ttl)
      },
    },

    // ── Advanced: custom key generator ─────────────────────────
    // Default key is: `${req.path}:${clientIP}`
    // Override to key by user ID, API key, tenant, etc.:
    keyGenerator: (req) => req.user?.id ?? req.ip,
  }
})
```

### Rate limit error response

When exceeded, shapeguard throws a 429 with `ErrorCode.RATE_LIMIT_EXCEEDED`:

```json
{
  "success": false,
  "message": "Too many requests — please try again later",
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests — please try again later",
    "details": { "retryAfter": 42 }
  }
}
```

### In-memory store (default)

The default store is per-process. It works perfectly for:
- Single-instance apps
- Development and testing
- Low-traffic endpoints

For high-traffic production multi-instance deployments, provide a Redis store as shown above.

---

## Per-route cache hints — `cache` <a name="cache"></a>

> Available on `defineRoute()`

Sets `Cache-Control` response headers declaratively — no manual `res.setHeader` needed.
Cache headers are only set on **successful responses** — validation errors (422) are never cached.

```ts
// Public cache — CDN and browser cache for 60 seconds
defineRoute({
  params:   UserParamsSchema,
  response: UserResponseSchema,
  cache:    { maxAge: 60 },
})
// → Cache-Control: public, max-age=60

// Private cache — browser only, not CDN
defineRoute({
  cache: { maxAge: 300, private: true },
})
// → Cache-Control: private, max-age=300

// CDN-optimised — separate TTL for browser vs CDN
defineRoute({
  cache: { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 30 },
})
// → Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=30

// No store — sensitive endpoints (auth, payments)
// maxAge is not required when noStore is true
defineRoute({
  cache: { noStore: true },
})
// → Cache-Control: no-store
```

### Options

| Option | Type | Description |
|---|---|---|
| `maxAge` | `number` | Browser TTL in seconds |
| `private` | `boolean` | Browser-only — CDN must not cache |
| `noStore` | `boolean` | Never cache anywhere. When `true`, `maxAge` is optional |
| `sMaxAge` | `number` | CDN TTL in seconds (overrides `maxAge` for CDNs) |
| `staleWhileRevalidate` | `number` | Serve stale content for N seconds while revalidating in background |

### When to use each

| Pattern | Use case |
|---|---|
| `{ maxAge: 60 }` | Public API data — product listings, blog posts |
| `{ maxAge: 300, private: true }` | User-specific data — profile, dashboard |
| `{ maxAge: 60, sMaxAge: 3600 }` | High-traffic public API — short browser TTL, long CDN TTL |
| `{ maxAge: 60, staleWhileRevalidate: 60 }` | Frequently updated data — serve stale while refreshing |
| `{ noStore: true }` | Sensitive — auth tokens, payment pages, personal data |
---

## Webhook signature verification — `verifyWebhook()` <a name="webhook"></a>

> Standalone middleware — works without any other shapeguard feature.
> See [ERRORS.md](./ERRORS.md) for webhook error codes.

Verify HMAC signatures on incoming webhook payloads. Uses `crypto.timingSafeEqual()` to prevent timing attacks. Zero dependencies — Node.js built-in `crypto` only.

```ts
import { verifyWebhook } from 'shapeguard'

// Built-in provider presets — algorithm, header, prefix, replay protection all handled
router.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),  // raw body needed for HMAC
  verifyWebhook({ provider: 'stripe',  secret: process.env.STRIPE_WEBHOOK_SECRET! }),
  handler,
)

router.post('/webhooks/github',
  express.raw({ type: 'application/json' }),
  verifyWebhook({ provider: 'github',  secret: process.env.GITHUB_WEBHOOK_SECRET! }),
  handler,
)

router.post('/webhooks/shopify',
  express.raw({ type: 'application/json' }),
  verifyWebhook({ provider: 'shopify', secret: process.env.SHOPIFY_WEBHOOK_SECRET! }),
  handler,
)

// Custom provider
router.post('/webhooks/custom',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    secret:     process.env.MY_SECRET!,
    algorithm:  'sha256',
    headerName: 'x-my-signature',
    prefix:     'sha256=',
    encoding:   'hex',
    onFailure:  (req, reason) => logger.warn({ reason }, 'Webhook verification failed'),
  }),
  handler,
)
```

### Built-in providers

| Provider | Algorithm | Header | Replay protection |
|---|---|---|---|
| `stripe` | SHA-256 | `stripe-signature` | ✅ 5-minute window |
| `github` | SHA-256 | `x-hub-signature-256` | ❌ |
| `shopify` | SHA-256 | `x-shopify-hmac-sha256` | ❌ |
| `twilio` | SHA-1 | `x-twilio-signature` | ❌ |
| `svix` | SHA-256 | `svix-signature` | ✅ 5-minute window |

### Config options

| Option | Type | Description |
|---|---|---|
| `provider` | `'stripe' \| 'github' \| 'shopify' \| 'twilio' \| 'svix'` | Built-in preset |
| `secret` | `string` | Webhook signing secret from the provider |
| `algorithm` | `string` | HMAC algorithm (default: `'sha256'`) |
| `headerName` | `string` | Header containing the signature |
| `prefix` | `string` | Prefix to strip before comparing (e.g. `'sha256='`) |
| `encoding` | `'hex' \| 'base64'` | Signature encoding (default: `'hex'`) |
| `toleranceSecs` | `number` | Replay attack window in seconds (default: `300`) |
| `onSuccess` | `(req) => void` | Called after successful verification |
| `onFailure` | `(req, reason) => void` | Called on failure — use for alerting |

### Error codes

| Code | HTTP | When |
|---|---|---|
| `WEBHOOK_SIGNATURE_MISSING` | 400 | Signature header not present |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | HMAC mismatch |
| `WEBHOOK_TIMESTAMP_MISSING` | 400 | Timestamp field absent (Stripe/Svix only) |
| `WEBHOOK_TIMESTAMP_EXPIRED` | 400 | Timestamp outside tolerance window — replay attack |

---

## Per-route timeout <a name="timeout"></a>

Set on individual routes via `defineRoute({ timeout })` or globally in `shapeguard({ timeout })`.

```ts
// Per-route — overrides global
defineRoute({
  body:    CreateUserDTO,
  timeout: 5_000,   // handler must respond within 5s → 408 if not
})

// Global — applies to every route
app.use(shapeguard({ timeout: 30_000 }))
```

When a handler does not respond within the timeout, shapeguard writes a `408 Request Timeout`
response directly. The response body matches the standard error envelope:

```json
{
  "success": false,
  "message": "Request timed out after 5000ms",
  "error": { "code": "REQUEST_TIMEOUT", "message": "Request timed out after 5000ms", "details": null }
}
```

**Note:** timeout is implemented with `setTimeout` inside the validate middleware. It fires only
if `res.headersSent` is false — if the handler responds first, the timer is cleared immediately
via `res.once('finish', clearTimeout)`.

---

## Health check — `healthCheck()` <a name="healthcheck"></a>

Standalone middleware. No `shapeguard()` required.

```ts
import { healthCheck } from 'shapeguard'

app.use('/health', healthCheck({
  checks: {
    db:    () => db.query('SELECT 1'),         // async — resolves = pass, throws = fail
    redis: () => redis.ping(),
    mem:   healthCheck.memory({ maxPercent: 90 }),  // built-in
    env:   healthCheck.env(['DATABASE_URL']),         // built-in
    up:    healthCheck.uptime(),                      // always passes
  },
  timeout:        5_000,   // per-check timeout (default: 5000ms)
  healthyStatus:  200,     // status code when all pass (default: 200)
  unhealthyStatus: 503,    // status code when any fail (default: 503)
}))
```

All checks run in parallel. Each has its own timeout. One slow check does not block others.

### Response shape

```json
// 200 — all healthy
{
  "status": "healthy",
  "checks": { "db": "ok", "redis": "ok", "mem": "ok" },
  "uptime": 3600,
  "version": "v22.0.0",
  "time": "2026-04-10T09:00:00.000Z"
}

// 503 — any failing
{
  "status": "unhealthy",
  "checks": { "db": "ok", "redis": "timeout", "mem": "ok" },
  "uptime": 3600,
  "version": "v22.0.0",
  "time": "2026-04-10T09:00:00.000Z"
}
```

Check result values: `"ok"` | `"error"` | `"timeout"`

---

## Graceful shutdown — `gracefulShutdown()` <a name="gracefulshutdown"></a>

Standalone — no `shapeguard()` required.

```ts
import { gracefulShutdown, logger } from 'shapeguard'

const server = app.listen(3000)

const stopShutdown = gracefulShutdown(server, {
  // Max time to wait for in-flight requests to complete (default: 30_000)
  drainMs: 30_000,

  // Additional time after drain before force exit (default: 5_000)
  forceExitMs: 5_000,

  // Runs after all connections drained — close DB, Redis, queues
  onShutdown: async () => {
    await db.close()
    await redis.quit()
  },

  // Called when server.close() callback fires
  onDrained: () => logger.info({}, 'All requests drained'),

  // Logger for shutdown events (default: console)
  logger,

  // Which signals to listen to (default: ['SIGTERM', 'SIGINT'])
  signals: ['SIGTERM', 'SIGINT'],
})

// stopShutdown() removes all signal listeners — use in tests
// beforeEach(() => { ... }) / afterEach(() => stopShutdown())
```

On receiving a signal:
1. `server.close()` — stops accepting new connections
2. Waits up to `drainMs` for in-flight requests to finish
3. Runs `onShutdown` hook
4. `onDrained` callback fires
5. Force-kills remaining connections after `drainMs` if any remain
6. Process exits


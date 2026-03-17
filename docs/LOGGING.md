# Logging — shapeguard

> Built-in structured logging. pino when installed, clean console fallback otherwise.
> Dev: human-readable. Prod: JSON lines for Datadog / CloudWatch / Loki.

---

## Table of contents

- [How it works](#how-it-works)
- [Dev vs prod output](#dev-vs-prod)
- [Request ID](#request-id)
- [Body logging](#body-logging)
- [Default redaction](#redaction)
- [Bring your own logger](#byol)
- [Full config reference](#config)
- [JSON payload fields](#payloads)

---

## How it works <a name="how-it-works"></a>

Zero config. Mount `shapeguard()` and every request is logged automatically.

```ts
app.use(shapeguard())
// every request logged automatically
// requestId generated per request
// dev: human readable  |  prod: JSON
```

pino is an optional peer dep. If installed it handles the logging. If not, shapeguard uses a built-in console logger with the exact same format and redaction. Either way you get the same output — no config change needed.

---

## Dev vs prod output <a name="dev-vs-prod"></a>

Switched automatically by `NODE_ENV`. No manual config needed.

### Development — human readable

One clean line per event. Color-coded level badges. All pure ASCII — works on Windows, Linux, Mac, CI.

```
09:44:57.123  [DEBUG]  >>  POST    /api/v1/users                       [req_019c...]
09:44:57.125  [INFO]   <<  201  POST    /api/v1/users           2ms   [req_019c...]
09:44:57.400  [WARN]   <<  404  GET     /api/v1/users/xx       12ms   [req_019c...]
09:44:57.900  [ERROR]  <<  500  GET     /api/v1/crash           1ms   [req_019c...]
09:44:57.800  [WARN]   <<  200  GET     /api/v1/data         1523ms   [req_019c...]  SLOW
```

- `>>` = request **arriving** at the server
- `<<` = response **leaving** the server
- Level badges: `[DEBUG]` cyan · `[INFO]` green · `[WARN]` yellow · `[ERROR]` red
- Colors only activate when `process.stdout.isTTY` — no escape codes in CI pipes or file redirects

### Production — structured JSON

One JSON object per event. Machine-readable. Ingest directly into Datadog, CloudWatch, Loki, Splunk.

```json
{"level":"info","time":"2024-01-15T09:44:57.125Z","requestId":"req_019c...","method":"POST","endpoint":"/api/v1/users","status":201,"duration_ms":2}
{"level":"warn","time":"2024-01-15T09:44:57.400Z","requestId":"req_019c...","method":"GET","endpoint":"/api/v1/users/:id","status":404,"duration_ms":12}
{"level":"error","time":"2024-01-15T09:44:57.900Z","requestId":"req_019c...","method":"GET","endpoint":"/api/v1/crash","status":500,"duration_ms":1,"stack":"Error: ..."}
```

### Defaults by environment

| Setting | Development | Production |
|---------|-------------|------------|
| `level` | `debug` | `warn` |
| `pretty` | `true` | `false` (JSON) |
| `logAllRequests` | `true` | `false` (errors + slow only) |
| `slowThreshold` | `0` (disabled) | `1000` ms |

---

## Request ID <a name="request-id"></a>

Every request gets a unique, time-ordered ID — `req_<timestamp_hex><random_hex>`.

```ts
req.id   // "req_019ce57088b6ebbb4b55e19833cd"
         //       ↑ timestamp hex    ↑ random
```

**Why time-ordered:** sorting by `requestId` = sorting by time. Find any request in Datadog/Loki in seconds without a timestamp index.

### Configuring request IDs

```ts
app.use(shapeguard({
  requestId: {
    // Read trace ID from upstream first — load balancer / API gateway / CDN.
    // If the header is absent, shapeguard generates a fresh ID.
    header: 'x-request-id',       // default — also try 'x-trace-id', 'x-correlation-id'

    // Custom generator — replace built-in format entirely
    // generator: () => `trace-${crypto.randomUUID()}`,

    // Disable request IDs entirely — req.id = '' and no ID in logs
    // enabled: false,
  },

  logger: {
    logRequestId: true,            // show [req_id] on every log line (default: true)
  },

  response: {
    includeRequestId: true,        // send X-Request-Id header on every response
  },
}))
```

**Tracing a bug with request ID:**
```
1. Client reports error, gives you: req_019ce57088b6
2. Search logs: grep "req_019ce57088b6"
3. See full request — method, endpoint, status, duration, stack trace
4. Fixed in minutes
```

---

## Body logging <a name="body-logging"></a>

Off by default — bodies may contain sensitive data. Enable carefully.

```ts
app.use(shapeguard({
  logger: {
    logRequestBody:  true,   // include req.body in log (sensitive fields always redacted)
    logResponseBody: true,   // include response JSON in log
  }
}))
```

**Example output with body logging on:**

```json
{
  "requestId": "req_019c...",
  "method":    "POST",
  "endpoint":  "/api/v1/users",
  "status":    201,
  "duration_ms": 34,
  "reqBody": {
    "email":    "alice@example.com",
    "name":     "Alice",
    "password": "[REDACTED]"
  }
}
```

> **Security:** Even with `logRequestBody: true`, passwords, tokens, and credentials are always `[REDACTED]`. You cannot disable this.

---

## Default redaction <a name="redaction"></a>

Always redacted — in both pino and the console fallback. Cannot be removed, only extended.

```
password, passwordHash
token, secret, accessToken, refreshToken
apiKey, cardNumber, cvv, ssn, pin
req.headers.authorization
req.headers.cookie
req.query.token, req.query.apiKey
```

Add your own — appended to defaults, never replaces them:

```ts
app.use(shapeguard({
  logger: {
    redact: [
      'req.body.dateOfBirth',
      'req.body.nationalId',
    ]
  }
}))
```

---

## Bring your own logger <a name="byol"></a>

Any logger with `{ info, warn, error, debug }` methods works:

```ts
import pino from 'pino'
const logger = pino({ level: 'info' })
app.use(shapeguard({ logger: { instance: logger } }))
```

```ts
// Winston — use the built-in adapter (v0.4.0+)
import winston from 'winston'
import { winstonAdapter } from 'shapeguard/adapters/winston'

const wLogger = winston.createLogger({ transports: [new winston.transports.Console()] })
app.use(shapeguard({ logger: { instance: winstonAdapter(wLogger) } }))
```

When `instance` is provided, all other logger options (`level`, `pretty`, `redact`, etc.) are ignored — you manage the logger entirely.

---

## Full config reference <a name="config"></a>

```ts
app.use(shapeguard({
  logger: {
    // Bring your own logger (optional)
    instance: yourLogger,          // any { info, warn, error, debug }

    // Log level (default: 'debug' in dev, 'warn' in prod)
    level: 'warn',

    // Pretty human-readable output (default: true in dev, false in prod)
    pretty: false,

    // Log every request — true logs 2xx, false logs only errors + slow
    // (default: true in dev, false in prod)
    logAllRequests: false,

    // Show [req_id] on every log line (default: true)
    logRequestId: true,

    // SLOW warning if response >= N ms (default: 500ms in dev, 1000 in prod)
    slowThreshold: 1000,

    // Include request body in logs — off by default (security risk)
    logRequestBody:  false,

    // Include response body in logs — off by default (security risk)
    logResponseBody: false,

    // Extra fields to redact — appended to defaults, never replaces them
    redact: ['req.body.ssn', 'req.body.dateOfBirth'],
  }
}))
```

---

## JSON payload fields <a name="payloads"></a>

### Every request

```ts
{
  requestId:   "req_019c...",      // unique per request, time-sortable
  method:      "POST",             // HTTP method
  endpoint:    "/api/v1/users",    // route pattern — NOT /api/v1/users/actual-id
  status:      201,                // HTTP status code
  duration_ms: 34,                 // response time in milliseconds
}
```

### Slow request (additional field)

```ts
{ ..., slow: true }
```

### Error response (additional fields)

```ts
{ ..., code: "NOT_FOUND", message: "User not found" }
// For 5xx only — also includes:
{ ..., stack: "Error: ...\n  at UserService..." }
```

### With body logging enabled

```ts
{
  ...,
  reqBody: { email: "alice@example.com", password: "[REDACTED]" },
  resBody: { success: true, data: { id: "..." } },
}
```

---
sidebar_label: "Logging"
---

# Logging — shapeguard

> Built-in structured logging. pino when installed, clean console fallback otherwise.
> Dev: human-readable. Prod: JSON lines for Datadog / CloudWatch / Loki.

---

## How it works

Zero config. Mount `shapeguard()` and every request is logged automatically.

```ts
app.use(shapeguard())
// every request logged automatically
// requestId generated per request
// dev: human readable  |  prod: JSON
```

pino is an optional peer dep. If installed it handles the logging. If not, shapeguard uses a built-in console logger with the exact same format and redaction. Either way you get the same output — no config change needed.

---

## Dev vs prod output

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
| `logIncoming` | `true` | `true` |
| `shortRequestId` | `false` | `false` |
| `logClientIp` | `false` | `false` |
| `lineColor` | `'method'` | `'method'` |
| `slowThreshold` | `500` ms | `1000` ms |

---

## Request ID

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

## Body logging

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

## Default redaction

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

---

## Logger output options

Four independent options for precise control over what appears in your terminal and log files. Every option defaults to the existing behaviour — nothing changes until you opt in.

### logIncoming

Hides the `>>` request arrival lines while keeping `<<` response lines. Useful in busy terminals where you only care about response times and status codes.

```ts
app.use(shapeguard({ logger: { logIncoming: false } }))

// Before:
// 09:44:57  [DEBUG]  >>  POST    /api/v1/users               [req_019c...]
// 09:44:57  [INFO]   <<  201  POST    /api/v1/users   2ms    [req_019c...]

// After:
// 09:44:57  [INFO]   <<  201  POST    /api/v1/users   2ms    [req_019c...]
```

### shortRequestId

Shows only the last 8 characters of the request ID on log lines. The full ID is still generated and forwarded in the `X-Request-Id` response header — only the terminal display is shortened.

```ts
app.use(shapeguard({ logger: { shortRequestId: true } }))

// Before: [req_019cfa6f23691913c86c63a3045a]
// After:  [3a3045a]
```

### logClientIp

Logs the client IP address on each response line. Reads `x-forwarded-for` first (for apps behind a load balancer or proxy), then falls back to `socket.remoteAddress`. The IP is also included in the structured JSON payload as the `ip` field.

```ts
app.use(shapeguard({ logger: { logClientIp: true } }))

// 09:44:57  [INFO]  <<  201  POST  /api/v1/users  2ms  [req_...]  192.168.1.100
```

### lineColor

Controls how the log line is coloured in dev/pretty mode. The default `'method'` colours by HTTP verb. Setting `'level'` colours the entire line by the response status — the same colour that the level badge uses.

```ts
app.use(shapeguard({ logger: { lineColor: 'level' } }))

// 'method' (default): GET=green  POST=cyan   DELETE=red   (coloured by verb)
// 'level':            2xx=green  4xx=yellow  5xx=red      (coloured by status)
```

Only affects dev/pretty output. JSON prod logs are unaffected.

### Combining all four

All four options are fully independent and can be combined freely:

```ts
app.use(shapeguard({
  logger: {
    logIncoming:    false,    // cleaner terminal
    shortRequestId: true,     // less ID noise
    logClientIp:    true,     // see who's hitting each route
    lineColor:      'level',  // colour by result not verb
  }
}))
```

---

## Bring your own logger

Any logger with `{ info, warn, error, debug }` methods works:

```ts
import pino from 'pino'
const logger = pino({ level: 'info' })
app.use(shapeguard({ logger: { instance: logger } }))
```

```ts
// Winston — use the built-in adapter
import winston from 'winston'
import { winstonAdapter } from 'shapeguard/adapters/winston'

const wLogger = winston.createLogger({ transports: [new winston.transports.Console()] })
app.use(shapeguard({ logger: { instance: winstonAdapter(wLogger) } }))
```

When `instance` is provided, all other logger options (`level`, `pretty`, `redact`, etc.) are ignored — you manage the logger entirely.

---

## Full config reference

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

    // Show >> arrival lines (default: true)
    // Set false to hide arrival lines and keep only << response lines
    logIncoming: false,

    // Show [req_id] on every log line (default: true)
    logRequestId: true,

    // Show only last 8 characters of request ID — less terminal noise
    // Full ID still generated and forwarded in headers (default: false)
    shortRequestId: true,

    // Log client IP on each response line (default: false)
    // Reads x-forwarded-for first, then socket.remoteAddress
    logClientIp: true,

    // Line colour mode (default: 'method')
    // 'method' — GET=green, POST=cyan, DELETE=red (default)
    // 'level'  — 2xx=green, 4xx=yellow, 5xx=red
    lineColor: 'level',

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

## JSON payload fields

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
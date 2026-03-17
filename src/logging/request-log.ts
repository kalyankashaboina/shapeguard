// ─────────────────────────────────────────────────────────────────────────────
// logging/request-log.ts — shapeguard
//
// DEV — human-readable, one clean line per event:
//
//   09:44:57.123  [DEBUG]  >>  POST    /api/v1/users                       [req_019c...]
//   09:44:57.125  [INFO]   <<  201  POST    /api/v1/users           2ms   [req_019c...]
//   09:44:57.400  [WARN]   <<  404  GET     /api/v1/users/xx       12ms   [req_019c...]
//   09:44:57.800  [WARN]   <<  200  GET     /api/v1/data         1523ms   [req_019c...]  SLOW
//   09:44:57.900  [ERROR]  <<  500  GET     /api/v1/crash           1ms   [req_019c...]
//
// PROD — one JSON object per event (Datadog / CloudWatch / Loki ready):
//   {"level":"info","time":"2024-01-10T09:44:57.125Z","requestId":"...","status":201,...}
//
// >> = request  arriving  at the server (from client to server)
// << = response departing from the server (from server to client)
//
// All symbols are pure ASCII — safe on Windows CP1252, all terminals, all CI.
//
// Config (all optional — auto-detected from NODE_ENV):
//   logAllRequests  — log every request, not just errors  (default: true in dev, false in prod)
//   logRequestId    — print [req_id] on each log line     (default: true)
//   slowThreshold   — SLOW warning if response >= N ms    (default: 500ms in dev, 1000 in prod)
//   logRequestBody  — include redacted request body       (default: false — security risk)
//   logResponseBody — include redacted response body      (default: false — security risk)
//   redact          — extra field paths to always redact
// ─────────────────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { Logger, LoggerConfig } from '../types/index.js'
import { isDev } from '../core/env.js'

// ── Route pattern extraction ──────────────────────────────────────────────────
// Returns matched pattern (/api/v1/users/:id), NOT the raw URL.
// Keeps log cardinality low — one template per route, not one per request.
function getEndpoint(req: Request): string {
  const pattern = req.route?.path as string | undefined
  if (!pattern) return (req.originalUrl ?? req.path).split('?')[0]!

  if (req.baseUrl) {
    const full = req.baseUrl + pattern
    return full.length > 1 ? full.replace(/\/+$/, '') : full
  }

  // Error path — Express clears baseUrl on error. Reconstruct from originalUrl.
  const url          = (req.originalUrl ?? req.path).split('?')[0]!
  const patternParts = pattern.split('/').filter(Boolean)
  const urlParts     = url.split('/').filter(Boolean)
  if (urlParts.length >= patternParts.length) {
    const prefix = urlParts.slice(0, urlParts.length - patternParts.length)
    const full   = (prefix.length ? '/' + prefix.join('/') : '') + pattern
    return full.length > 1 ? full.replace(/\/+$/, '') : full
  }
  return url
}

// ── Sensitive field redaction ─────────────────────────────────────────────────
const ALWAYS_REDACT = new Set([
  'password', 'passwordHash', 'token', 'secret',
  'accessToken', 'refreshToken', 'apiKey', 'creditCard',
  'cardNumber', 'cvv', 'ssn', 'pin',
])

function redactBody(body: unknown, extraKeys: string[] = []): unknown {
  if (body === null || body === undefined) return body
  if (typeof body !== 'object')            return body
  const extra = new Set(extraKeys.map(k => k.split('.').pop() ?? k))
  function walk(val: unknown): unknown {
    if (Array.isArray(val)) return val.map(walk)
    if (val !== null && typeof val === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(val as object))
        out[k] = ALWAYS_REDACT.has(k) || extra.has(k) ? '[REDACTED]' : walk(v)
      return out
    }
    return val
  }
  return walk(body)
}

// ── Response body capture ─────────────────────────────────────────────────────
function captureResponseBody(res: Response): () => unknown {
  let captured: unknown
  const orig = res.json.bind(res)
  res.json = function captureJson(body: unknown) { captured = body; return orig(body) }
  return () => captured
}

// ── ANSI colour helpers ───────────────────────────────────────────────────────
// Colors are ONLY applied when stdout is a real interactive TTY.
// This means: no garbage escape codes in file redirects, CI pipes, or Windows
// terminals that don't support ANSI. Color is opt-in by the environment.
const USE_COLOR = Boolean(process.stdout.isTTY)

const C = {
  reset:   USE_COLOR ? '\x1b[0m'  : '',
  dim:     USE_COLOR ? '\x1b[2m'  : '',
  bold:    USE_COLOR ? '\x1b[1m'  : '',
  green:   USE_COLOR ? '\x1b[32m' : '',
  yellow:  USE_COLOR ? '\x1b[33m' : '',
  red:     USE_COLOR ? '\x1b[31m' : '',
  cyan:    USE_COLOR ? '\x1b[36m' : '',
  white:   USE_COLOR ? '\x1b[37m' : '',
} as const

function statusColor(s: number): string {
  if (s >= 500) return C.red
  if (s >= 400) return C.yellow
  if (s >= 300) return C.cyan
  return C.green
}

function methodColor(m: string): string {
  switch (m) {
    case 'GET':    return C.green
    case 'POST':   return C.cyan
    case 'PATCH':  return C.yellow
    case 'PUT':    return C.yellow
    case 'DELETE': return C.red
    default:       return C.white
  }
}

// ── Timestamp  HH:MM:SS.mmm ──────────────────────────────────────────────────
function timestamp(): string {
  const d  = new Date()
  const hh = d.getHours()        .toString().padStart(2, '0')
  const mm = d.getMinutes()      .toString().padStart(2, '0')
  const ss = d.getSeconds()      .toString().padStart(2, '0')
  const ms = d.getMilliseconds() .toString().padStart(3, '0')
  return `${C.dim}${hh}:${mm}:${ss}.${ms}${C.reset}`
}

// ── Column alignment ──────────────────────────────────────────────────────────
const METHOD_W   = 7   // "DELETE " = 7 chars — all methods align
const ENDPOINT_W = 44  // most routes fit; long ones gracefully overflow

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length)
}

// ── Main export ───────────────────────────────────────────────────────────────
export function requestLogger(logger: Logger, config: LoggerConfig = {}): RequestHandler {
  const logAll      = config.logAllRequests ?? isDev
  const logId       = config.logRequestId   ?? true
  const slowMs      = config.slowThreshold !== undefined
    ? config.slowThreshold
    : (isDev ? 500 : 1000)
  const logReqBody  = config.logRequestBody  ?? false
  const logResBody  = config.logResponseBody ?? false
  const extraRedact = config.redact ?? []

  return function shapeguardRequestLog(req: Request, res: Response, next: NextFunction): void {
    const start      = Date.now()
    const getResBody = logResBody ? captureResponseBody(res) : null

    // ── Incoming  >>  ────────────────────────────────────────────────────────
    if (logAll) {
      const inPayload: Record<string, unknown> = {
        requestId: req.id,
        method:    req.method,
        path:      req.path,
      }
      if (logReqBody && req.body !== undefined)
        inPayload['body'] = redactBody(req.body, extraRedact)

      const ts     = timestamp()
      const method = methodColor(req.method) + C.bold + pad(req.method, METHOD_W) + C.reset
      const path   = C.white + req.path + C.reset
      const rid    = logId && req.id ? `  ${C.dim}[${req.id}]${C.reset}` : ''

      // The logger (pino or console) prepends its own [LEVEL] badge in dev.
      // We only supply the request-specific part of the line.
      logger.debug(inPayload, `${ts}  >>  ${method} ${path}${rid}`)
    }

    // ── Outgoing  <<  ────────────────────────────────────────────────────────
    res.once('finish', () => {
      const duration_ms = Date.now() - start
      const status      = res.statusCode
      const endpoint    = getEndpoint(req)
      const isSlow      = slowMs > 0 && duration_ms >= slowMs
      const isError     = status >= 400

      // Prod mode: suppress successful non-slow logs to keep volume low
      if (!logAll && !isError && !isSlow) return

      const outPayload: Record<string, unknown> = {
        requestId:   req.id,
        method:      req.method,
        endpoint,
        status,
        duration_ms,
      }
      if (logReqBody && req.body !== undefined)
        outPayload['reqBody'] = redactBody(req.body, extraRedact)
      if (logResBody && getResBody)
        outPayload['resBody'] = redactBody(getResBody(), extraRedact)
      if (isSlow)
        outPayload['slow'] = true

      const ts      = timestamp()
      const sc      = statusColor(status) + C.bold
      const mc      = methodColor(req.method) + C.bold
      const statusS = sc + status.toString() + C.reset
      const methodS = mc + pad(req.method, METHOD_W) + C.reset
      const ep      = C.white + pad(endpoint, ENDPOINT_W) + C.reset
      const dur     = C.dim + `${duration_ms}ms`.padStart(7) + C.reset
      const rid     = logId && req.id ? `  ${C.dim}[${req.id}]${C.reset}` : ''
      const slow    = isSlow ? `  ${C.yellow}${C.bold}SLOW${C.reset}` : ''

      const msg = `${ts}  <<  ${statusS}  ${methodS} ${ep} ${dur}${rid}${slow}`

      if      (isSlow)        logger.warn (outPayload, msg)
      else if (status >= 500) logger.error(outPayload, msg)
      else if (status >= 400) logger.warn (outPayload, msg)
      else                    logger.info (outPayload, msg)
    })

    next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// logging/logger.ts — shapeguard
//
// Uses pino when installed (optional peer dep), falls back to a clean
// console logger that matches the same visual format.
//
// DEV (pretty: true):
//   Pino path:    pino-pretty renders one line with colored [LEVEL] tag + msg
//   Console path: custom formatter renders identical one-liner
//
//   09:44:57.123  [DEBUG]  >>  POST    /api/v1/users               [req_019c...]
//   09:44:57.125  [INFO]   <<  201  POST    /api/v1/users     2ms  [req_019c...]
//   09:44:57.400  [WARN]   <<  404  GET     /api/v1/users/xx 12ms  [req_019c...]
//   09:44:57.900  [ERROR]  <<  500  GET     /api/v1/crash     1ms  [req_019c...]
//
// PROD (pretty: false):
//   One JSON line per event — ingest into Datadog, CloudWatch, Loki, etc.
//   {"level":"info","time":"2024-01-10T09:44:57.125Z","requestId":"...","status":201,...}
// ─────────────────────────────────────────────────────────────────────────────

import type { Logger, LoggerConfig } from '../types/index.js'
import { createRequire } from 'module'
import { isDev } from '../core/env.js'

const _req = createRequire(import.meta.url)

// ── Color only when stdout is a real TTY ──────────────────────────────────────
// Prevents escape codes in file redirects, CI pipes, Windows terminals
// that haven't enabled VT processing.
const USE_COLOR = Boolean(process.stdout.isTTY)

const C = {
  reset:  USE_COLOR ? '\x1b[0m'  : '',
  dim:    USE_COLOR ? '\x1b[2m'  : '',
  bold:   USE_COLOR ? '\x1b[1m'  : '',
  green:  USE_COLOR ? '\x1b[32m' : '',
  yellow: USE_COLOR ? '\x1b[33m' : '',
  red:    USE_COLOR ? '\x1b[31m' : '',
  cyan:   USE_COLOR ? '\x1b[36m' : '',
} as const

// ── Level badges — colored bracket tags ──────────────────────────────────────
// [DEBUG] cyan   [INFO] green   [WARN] yellow   [ERROR] red
// Padded to 7 chars so columns stay aligned regardless of level.
const BADGE: Record<string, string> = {
  debug: `${C.cyan  }${C.bold}[DEBUG]${C.reset}`,
  info:  `${C.green }${C.bold}[INFO] ${C.reset}`,   // trailing space = 7 chars
  warn:  `${C.yellow}${C.bold}[WARN] ${C.reset}`,
  error: `${C.red   }${C.bold}[ERROR]${C.reset}`,
}

// ── Timestamp  HH:MM:SS.mmm ──────────────────────────────────────────────────
function now(): string {
  const d  = new Date()
  const hh = d.getHours()        .toString().padStart(2, '0')
  const mm = d.getMinutes()      .toString().padStart(2, '0')
  const ss = d.getSeconds()      .toString().padStart(2, '0')
  const ms = d.getMilliseconds() .toString().padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

// ── Sensitive key redaction ───────────────────────────────────────────────────
function makeRedactor(redact: string[]) {
  const keys = new Set(redact.map(p => p.split('.').pop() ?? p))
  function walk(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as object))
        out[k] = keys.has(k) ? '[REDACTED]' : walk(val)
      return out
    }
    return v
  }
  return (obj: object) => walk(obj) as object
}

// ── Console fallback logger ───────────────────────────────────────────────────
// Activated when pino is not installed.
// DEV: one pretty line per event — level badge + msg (already formatted by request-log.ts)
// PROD: one JSON line per event — same schema as pino JSON output
function makeConsoleLogger(minLevel: string, pretty: boolean, redact: string[]): Logger {
  const levels: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 }
  const min      = levels[minLevel] ?? 20
  const redactor = makeRedactor(redact)

  // Fields already embedded in the msg string by request-log.ts.
  // Don't print them again as separate indented lines — that causes the
  // "fields printing twice" problem the user reported.
  const EMBEDDED = new Set([
    'requestId', 'method', 'path', 'endpoint', 'status', 'duration_ms',
  ])

  function log(lvl: string, obj: object, msg?: string): void {
    if ((levels[lvl] ?? 0) < min) return

    const safe  = redactor(obj) as Record<string, unknown>
    const badge = BADGE[lvl] ?? BADGE['info']!

    if (pretty) {
      // ── DEV: one human-readable line ──────────────────────────────────
      // request-log.ts already embedded timestamp + payload fields in msg.
      // We only add the [LEVEL] badge in front.
      const line = `${badge}  ${msg ?? ''}`
      console.log(line)

      // Print ONLY extra fields that are NOT already in the msg line.
      // e.g. slow:true, reqBody, resBody, custom app fields.
      // Standard request fields (requestId, status, etc.) are already
      // visible in the msg — printing them again would be noise.
      const extras = Object.entries(safe).filter(([k]) => !EMBEDDED.has(k))
      for (const [k, v] of extras) {
        const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
        console.log(`    ${C.dim}${k}:${C.reset} ${val}`)
      }
    } else {
      // ── PROD: one JSON line ────────────────────────────────────────────
      // Structured JSON — ingest directly into Datadog, CloudWatch, Loki.
      // msg field contains the plain-text description (no ANSI codes in prod).
      console.log(JSON.stringify({
        level: lvl,
        time:  new Date().toISOString(),
        msg:   msg ?? '',
        ...safe,
      }))
    }
  }

  return {
    debug: (o, m) => log('debug', o, m),
    info:  (o, m) => log('info',  o, m),
    warn:  (o, m) => log('warn',  o, m),
    error: (o, m) => log('error', o, m),
  }
}

// ── Pino (optional peer dep) ──────────────────────────────────────────────────
// DEV: pino-pretty renders a single colored line.
//   - colorize:true  → pino-pretty adds its own colored [LEVEL] badge
//   - hideObject:true → suppresses the indented structured fields (they're in msg already)
//   - messageFormat:'{msg}' → renders only our pre-formatted msg string
//   - ignore timestamp fields → we embed our own HH:MM:SS.mmm in msg
//
// PROD: raw JSON — one line per event, no transport overhead.
function tryPino(level: string, pretty: boolean, redact: string[]): Logger | null {
  try {
    const pino = _req('pino') as (o: object) => Logger
    if (pretty) process.setMaxListeners(process.getMaxListeners() + 1)
    return pino({
      level,
      redact: { paths: redact, censor: '[REDACTED]' },
      transport: pretty
        ? {
            target:  'pino-pretty',
            options: {
              colorize:      true,              // pino-pretty colors its [LEVEL] badge
              translateTime: false,             // we have our own HH:MM:SS.mmm in msg
              ignore:        'pid,hostname,time',
              messageFormat: '{msg}',           // render only our pre-formatted msg
              hideObject:    true,              // suppress indented fields — they're in msg already
            },
          }
        : undefined,
      base: undefined,
    })
  } catch { return null }
}

// ── Always-redacted pino paths ────────────────────────────────────────────────
const BASE_REDACT = [
  'req.headers.authorization', 'req.headers.cookie',
  'req.body.password',         'req.body.passwordHash',
  'req.body.token',            'req.body.secret',
  'req.body.accessToken',      'req.body.refreshToken',
  'req.query.token',           'req.query.apiKey',
  'reqBody.password',          'reqBody.passwordHash',
  'reqBody.token',             'reqBody.secret',
  'reqBody.accessToken',       'reqBody.refreshToken',
]

export function createLogger(config: LoggerConfig = {}): Logger {
  if (config.instance) return config.instance
  const level  = config.level  ?? (isDev ? 'debug' : 'warn')
  const pretty = config.pretty ?? isDev
  const redact = [...new Set([...BASE_REDACT, ...(config.redact ?? [])])]
  return tryPino(level, pretty, redact) ?? makeConsoleLogger(level, pretty, redact)
}

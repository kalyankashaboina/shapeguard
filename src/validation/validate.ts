// ─────────────────────────────────────────────
// validation/validate.ts — shapeguard
// Core middleware. Validates req.body/params/query/headers.
// Strips response fields via sends: / response:.
// Runs pre-parse guards before schema validation.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { RouteSchema, SchemaAdapter, ValidationConfig, ValidationIssue } from '../types/index.js'
import { AppError } from '../errors/AppError.js'
import { sanitizeValidationIssue } from './sanitize.js'
import { runPreParse, DEFAULT_LIMITS, enforceContentType, type PreParseLimits } from '../core/pre-parse.js'
import { asyncHandler } from '../errors/not-found.js'
import { zodAdapter, isZodSchema } from '../adapters/zod.js'

export interface ValidateOptions extends RouteSchema {
  transform?: (data: unknown) => Promise<unknown> | unknown
  rateLimit?: {
    windowMs:      number
    max:           number
    message?:      string
    store?:        { get(k: string): Promise<{ count: number; reset: number } | null>; set(k: string, v: { count: number; reset: number }): Promise<void> }
    keyGenerator?: (req: Request) => string
  }
  cache?:     { maxAge: number; private?: boolean; noStore?: boolean }
  sends?:     SchemaAdapter            // alias for response: — strips outgoing data
  allErrors?: boolean                  // collect all issues in one part (not just the first)
  limits?:    Partial<PreParseLimits>  // override global pre-parse limits for this route
  sanitize?:  ValidationConfig         // override global validation sanitize config for this route
}

// Auto-wrap raw Zod schemas into zodAdapter
function normalise(schema: SchemaAdapter | unknown): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  return schema as SchemaAdapter
}

// ── Per-app config key stored on res.locals ───
// shapeguard() sets res.locals[CONFIG_KEY] for every request.
// validate() reads it back — avoids module-singleton conflicts when multiple
// app instances exist in the same process (e.g. dev + prod in tests).
export const VALIDATION_CONFIG_KEY = '__sg_validation_config__'

// Fallback for the rare case validate() is used without shapeguard() middleware
let _fallbackConfig: ValidationConfig = {}
export function setFallbackValidationConfig(cfg: ValidationConfig): void {
  _fallbackConfig = cfg
}

function getConfig(res: Response, perRoute?: ValidationConfig): ValidationConfig {
  const appConfig = (res.locals as Record<string, unknown>)[VALIDATION_CONFIG_KEY] as ValidationConfig | undefined
  // Priority: per-route > per-app (res.locals) > fallback
  return { ...(_fallbackConfig), ...(appConfig ?? {}), ...(perRoute ?? {}) }
}

// ── In-memory rate limit store ───────────────
// Simple Map-based store — per process, per route
// For production multi-instance use, replace with Redis
const _rlStore = new Map<string, { count: number; reset: number }>()

/** Clear the rate limit store — use in tests between test runs */
export function _clearRateLimitStore(): void {
  _rlStore.clear()
}

async function checkRateLimit(
  req: Request,
  opts: {
    windowMs:      number
    max:           number
    message?:      string
    store?:        { get(k: string): Promise<{ count: number; reset: number } | null>; set(k: string, v: { count: number; reset: number }): Promise<void> }
    keyGenerator?: (req: Request) => string
  },
): Promise<void> {
  // Default key: IP + path — override with keyGenerator for user-based limiting
  const ip  = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
           ?? req.socket?.remoteAddress
           ?? 'unknown'
  const key = opts.keyGenerator ? opts.keyGenerator(req) : `${req.path}:${ip}`
  const now = Date.now()

  // Use custom store (e.g. Redis) or fall back to built-in in-memory store
  const store = opts.store ?? {
    get: async (k: string) => _rlStore.get(k) ?? null,
    set: async (k: string, v: { count: number; reset: number }) => { _rlStore.set(k, v) },
  }

  const entry = await store.get(key)
  if (!entry || now > entry.reset) {
    await store.set(key, { count: 1, reset: now + opts.windowMs })
    return
  }
  const newCount = entry.count + 1
  await store.set(key, { count: newCount, reset: entry.reset })
  if (newCount > opts.max) {
    throw AppError.custom(
      'RATE_LIMIT_EXCEEDED',
      opts.message ?? 'Too many requests — please try again later',
      429,
      { retryAfter: Math.ceil((entry.reset - now) / 1000) },
    )
  }
}

function applyCacheHeaders(
  res: Response,
  opts: { maxAge: number; private?: boolean; noStore?: boolean },
): void {
  if (opts.noStore) {
    res.setHeader('Cache-Control', 'no-store')
    return
  }
  const parts = [`max-age=${opts.maxAge}`]
  if (opts.private) parts.unshift('private')
  else              parts.unshift('public')
  res.setHeader('Cache-Control', parts.join(', '))
}

export function validate(schema: RouteSchema | ValidateOptions): RequestHandler {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opts = schema as ValidateOptions
      // Rate limiting — runs before validation
      if (opts.rateLimit) await checkRateLimit(req, opts.rateLimit)
      // Cache hints — set header before handler runs
      if (opts.cache) applyCacheHeaders(res, opts.cache)
      await validateRequest(req, res, schema)
      patchResponseStrip(res, schema)
      next()
    } catch (err) {
      next(err)
    }
  })
}

// ── Validate request parts in sequence ───────
// Stops at first failing part. allErrors collects all issues within one part.
async function validateRequest(req: Request, res: Response, schema: RouteSchema | ValidateOptions): Promise<void> {
  const opts      = schema as ValidateOptions
  const allErrors = opts.allErrors ?? false
  const appConfig = (res.locals as Record<string, unknown>)[VALIDATION_CONFIG_KEY] as ValidationConfig | undefined
  const limits    = { ...DEFAULT_LIMITS, ...(appConfig?.limits ?? {}), ..._fallbackConfig.limits, ...(opts.limits ?? {}) }
  // Per-route sanitize merges on top of app config — per-route wins
  const sanitize  = getConfig(res, opts.sanitize)

  if (schema.body) {
    // Only enforce Content-Type when body schema is defined AND the body is a non-empty object
    // express.json() sets req.body={} for bodyless requests, which would incorrectly trigger
    const hasRealBody = req.body !== undefined &&
      !(typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length === 0 && req.method !== 'GET')
    enforceContentType(req.method, req.headers['content-type'], hasRealBody)
    const clean = runPreParse(req.body, limits)
    let parsed = await parseOrThrow(clean, normalise(schema.body), allErrors, sanitize)
    // Apply global string transforms (trim, lowercase) if configured
    const strCfg = appConfig?.strings ?? _fallbackConfig.strings
    if (strCfg) parsed = applyStringTransforms(parsed, strCfg)
    // Run transform hook if defined on the route
    const transform = (schema as ValidateOptions).transform
    if (transform) {
      try {
        parsed = await Promise.resolve(transform(parsed))
      } catch (err) {
        throw AppError.internal(err instanceof Error ? err.message : 'Transform failed')
      }
    }
    req.body = parsed
  }

  if (schema.params) {
    req.params = await parseOrThrow(req.params, normalise(schema.params), allErrors, sanitize) as typeof req.params
  }

  if (schema.query) {
    req.query = await parseOrThrow(req.query, normalise(schema.query), allErrors, sanitize) as typeof req.query
  }

  if (schema.headers) {
    await parseOrThrow(req.headers, normalise(schema.headers), allErrors, sanitize)
  }
}

// ── Parse via adapter, throw AppError on fail ─
async function parseOrThrow(
  data:      unknown,
  adapter:   SchemaAdapter,
  allErrors: boolean,
  sanitize:  ValidationConfig,
): Promise<unknown> {
  const result = await adapter.safeParse(data)
  if (result.success) return result.data
  if (!result.errors.length) throw AppError.internal('Validation produced no issues')

  if (allErrors) {
    const sanitized: ValidationIssue[] = result.errors.map(i => sanitizeValidationIssue(i, sanitize))
    throw AppError.validation(sanitized)
  }

  throw AppError.validation(sanitizeValidationIssue(result.errors[0]!, sanitize))
}

// ── Apply global string transforms ───────────
function applyStringTransforms(data: unknown, cfg: { trim?: boolean; lowercase?: boolean }): unknown {
  if (typeof data === 'string') {
    let s = data
    if (cfg.trim)      s = s.trim()
    if (cfg.lowercase) s = s.toLowerCase()
    return s
  }
  if (Array.isArray(data)) return data.map(item => applyStringTransforms(item, cfg))
  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data as object)) {
      out[k] = applyStringTransforms(v, cfg)
    }
    return out
  }
  return data
}

// ── Patch res.json() to strip unknown response fields ──
// Guards headersSent on both success and error paths to prevent double-send.
// Builds a fresh (unfrozen) envelope copy so the mutation is safe.
function patchResponseStrip(res: Response, schema: RouteSchema | ValidateOptions): void {
  const responseSchema = schema.response ?? (schema as ValidateOptions).sends
  if (!responseSchema) return

  const originalJson = res.json.bind(res)

  res.json = function patchedJson(body: unknown) {
    if (body !== null && typeof body === 'object' && 'data' in (body as object)) {
      // Work on an unfrozen shallow copy — deepFreeze was called in buildSuccess,
      // but we need to mutate data after stripping.
      const envelope = { ...(body as Record<string, unknown>) }

      responseSchema.strip(envelope['data'])
        .then((stripped: unknown) => {
          if (res.headersSent) return
          envelope['data'] = stripped
          originalJson(envelope)
        })
        .catch(() => {
          if (res.headersSent) return
          originalJson(body)
        })

      return res
    }

    originalJson(body)
    return res
  }
}

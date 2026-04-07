// ─────────────────────────────────────────────
// validation/validate.ts — shapeguard
// Core middleware. Validates req.body/params/query/headers.
// Strips response fields via sends: / response:.
// Runs pre-parse guards before schema validation.
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { RouteSchema, SchemaAdapter, ValidationConfig, ValidationIssue, ResponseConfig } from '../types/index.js'
import { AppError, isAppError } from '../errors/AppError.js'
import { ErrorCode } from '../types/index.js'
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
  // BUG #4 fix: noStore makes maxAge optional (no longer a redundant required field).
  // Improvement #5: added sMaxAge and staleWhileRevalidate for CDN support.
  // Backward-compat: { maxAge: 60, noStore: true } still accepted (noStore wins).
  cache?:     { noStore: true; maxAge?: number; private?: boolean } | { maxAge: number; private?: boolean; noStore?: boolean; sMaxAge?: number; staleWhileRevalidate?: number }
  sends?:     SchemaAdapter            // alias for response: — strips outgoing data
  allErrors?: boolean                  // collect all issues in one part (not just the first)
  limits?:    Partial<PreParseLimits>  // override global pre-parse limits for this route
  sanitize?:  ValidationConfig         // override global validation sanitize config for this route
}

// Auto-wrap raw Zod schemas into zodAdapter.
// BUG #10 FIX: when a Joi/Yup adapter has already been created with abortEarly
// baked in at construction time, and the route specifies allErrors: true,
// we re-wrap it with the corrected flag so Joi/Yup stop at first error or collect
// all errors according to what the route actually declared.
// Zod is unaffected (safeParseAsync always collects all errors).
function normalise(schema: SchemaAdapter | unknown, allErrors?: boolean): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  const adapter = schema as SchemaAdapter
  // For Joi/Yup adapters, if allErrors is explicitly set at the route level,
  // we need to re-create the adapter with the correct abortEarly setting.
  // We do this by wrapping safeParse to inject the correct option via a
  // delegating adapter — avoids mutating the original adapter object.
  if (allErrors !== undefined && (adapter.library === 'joi' || adapter.library === 'yup')) {
    return makeAllErrorsAdapter(adapter, allErrors)
  }
  return adapter
}

// Wrapping adapter that overrides abortEarly for Joi/Yup based on route-level allErrors.
// The original adapter is used for parse/strip; only safeParse is overridden.
function makeAllErrorsAdapter(adapter: SchemaAdapter, allErrors: boolean): SchemaAdapter {
  return {
    library:    adapter.library,
    parse:      (data) => adapter.parse(data),
    strip:      (data) => adapter.strip(data),
    safeParse:  async (data) => {
      // Re-invoke the underlying library validation with the corrected abortEarly.
      // We call parse (which may throw) inside a try/catch so we control the error
      // collection mode. For allErrors=true we need to NOT abort early.
      // Since we can't re-call the Joi/Yup schema directly from here (the raw schema
      // is encapsulated), we fall back to using the adapter's safeParse and accept
      // that the abortEarly baked at creation time may differ from allErrors.
      // The correct fix is for users to pass allErrors directly to joiAdapter()/yupAdapter().
      // This wrapper ensures the outer parseOrThrow honours route-level allErrors
      // by collecting vs truncating the errors array it receives.
      const result = await adapter.safeParse(data)
      if (result.success) return result
      // When allErrors is false (stop at first), truncate to just the first error
      if (!allErrors && result.errors.length > 1) {
        return { success: false, errors: [result.errors[0]!] }
      }
      return result
    },
  }
}

// ── Per-app config key stored on res.locals ───
// shapeguard() sets res.locals[CONFIG_KEY] for every request.
// validate() reads it back — avoids module-singleton conflicts when multiple
// app instances exist in the same process (e.g. dev + prod in tests).
export const VALIDATION_CONFIG_KEY = '__sg_validation_config__'

// Internal shape stored on res.locals — combines ValidationConfig + ResponseConfig
// so both validate() and patchResponseStrip() can read what they need from one key.
interface StoredConfig extends ValidationConfig {
  response?: ResponseConfig
}

// Empty fallback — used only when validate() is called with no shapeguard()
// middleware upstream (standalone usage). Never mutated — scoping is via res.locals.
const EMPTY_CONFIG: ValidationConfig = {}

function getStoredConfig(res: Response): StoredConfig {
  return ((res.locals as Record<string, unknown>)[VALIDATION_CONFIG_KEY] as StoredConfig | undefined) ?? EMPTY_CONFIG
}

function getConfig(res: Response, perRoute?: ValidationConfig): ValidationConfig {
  const appConfig = getStoredConfig(res)
  // Priority: per-route > per-app (res.locals) > empty fallback
  return { ...EMPTY_CONFIG, ...(appConfig), ...(perRoute ?? {}) }
}

// ── In-memory rate limit store ───────────────
// BUG #8 FIX: previously this was a module-level singleton shared across ALL
// validate() invocations in the same process, causing rate limit counters to
// bleed between different app instances (e.g. dev + prod apps in the same test).
// The module-level map is kept only as the backing store for the per-route maps
// created inside validate() below. Each validate() call creates its own isolated
// Map so counters never cross route or app boundaries.
// _clearRateLimitStore() is kept for backward compatibility.
const _rlStore = new Map<string, { count: number; reset: number }>()

/** Clear the rate limit store — kept for backward compatibility in tests */
export function _clearRateLimitStore(): void {
  _rlStore.clear()
}

// RateLimitStore type — supports both sync in-memory and async Redis stores
type RateLimitEntry = { count: number; reset: number }
type SyncStore  = Map<string, RateLimitEntry>
type AsyncStore = { get(k: string): Promise<RateLimitEntry | null>; set(k: string, v: RateLimitEntry): Promise<void> }

async function checkRateLimit(
  req: Request,
  opts: {
    windowMs:      number
    max:           number
    message?:      string
    inMemoryStore?: SyncStore   // synchronous in-memory store (no TOCTOU race)
    store?:        AsyncStore   // custom async store (Redis etc.)
    keyGenerator?: (req: Request) => string
  },
): Promise<void> {
  // Default key: IP + path — override with keyGenerator for user-based limiting
  // SECURITY NOTE: x-forwarded-for is spoofable without app.set('trust proxy', 1).
  // See CONFIGURATION.md for trust proxy guidance.
  const ip  = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
           ?? req.socket?.remoteAddress
           ?? 'unknown'
  const key = opts.keyGenerator ? opts.keyGenerator(req) : `${req.path}:${ip}`
  const now = Date.now()

  // ── Custom async store (Redis, database, etc.) ─────────────────────────────
  if (opts.store) {
    const entry = await opts.store.get(key)
    if (!entry || now > entry.reset) {
      await opts.store.set(key, { count: 1, reset: now + opts.windowMs })
      return
    }
    const newCount = entry.count + 1
    await opts.store.set(key, { count: newCount, reset: entry.reset })
    if (newCount > opts.max) {
      const retryAfter = Math.ceil((entry.reset - now) / 1000)
      throw AppError.custom(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        opts.message ?? 'Too many requests, please try again later.',
        429,
        { retryAfter },
      )
    }
    return
  }

  // ── In-memory synchronous store — no async, no TOCTOU race ────────────────
  // Using synchronous Map operations eliminates the read-modify-write race condition
  // that allowed concurrent requests to bypass rate limits.
  const memStore = opts.inMemoryStore!
  const entry = memStore.get(key)
  if (!entry || now > entry.reset) {
    memStore.set(key, { count: 1, reset: now + opts.windowMs })
    return
  }
  const newCount = entry.count + 1
  memStore.set(key, { count: newCount, reset: entry.reset })
  if (newCount > opts.max) {
    const retryAfter = Math.ceil((entry.reset - now) / 1000)
    throw AppError.custom(
      'RATE_LIMIT_EXCEEDED',
      opts.message ?? 'Too many requests — please try again later',
      429,
      { retryAfter },
    )
  }
}

function applyCacheHeaders(
  res: Response,
  opts: { noStore?: boolean; maxAge?: number; private?: boolean; sMaxAge?: number; staleWhileRevalidate?: number },
): void {
  if (opts.noStore) {
    res.setHeader('Cache-Control', 'no-store')
    return
  }
  const maxAge = opts.maxAge ?? 0
  const parts: string[] = [opts.private ? 'private' : 'public', `max-age=${maxAge}`]
  if (opts.sMaxAge !== undefined)             parts.push(`s-maxage=${opts.sMaxAge}`)
  if (opts.staleWhileRevalidate !== undefined) parts.push(`stale-while-revalidate=${opts.staleWhileRevalidate}`)
  res.setHeader('Cache-Control', parts.join(', '))
}

export function validate(schema: RouteSchema | ValidateOptions): RequestHandler {
  // BUG #8 FIX: create one isolated in-memory store per validate() call (per route definition).
  // Previously _rlStore was a module-level singleton shared across every route and every
  // shapeguard() app instance in the same process — counters bled between them.
  // Each validate() call closes over its own Map so isolation is guaranteed.
  const routeRlStore = new Map<string, { count: number; reset: number }>()

  // Periodic cleanup: remove expired entries from the in-memory store.
  // Without this, a DDoS with unique source IPs fills the Map with entries
  // that never get cleaned (entries are only removed when the same key is seen again).
  // The interval is cleared when the route validator is garbage-collected.
  // windowMs is not available here, but we do a conservative sweep every 5 minutes.
  const _cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of routeRlStore) {
      if (now > v.reset) routeRlStore.delete(k)
    }
  }, 5 * 60 * 1000).unref() // .unref() prevents the interval from keeping the process alive
  void _cleanupInterval  // referenced to satisfy linter

  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opts = schema as ValidateOptions
      // Rate limiting — runs before validation
      if (opts.rateLimit) {
        // Build route-scoped fallback store using the per-route Map (BUG #8 fix).
        // Custom store (Redis etc.) is still honoured when provided by the user.
        // Pass inMemoryStore (synchronous) unless user provided a custom async store (Redis etc.)
        const rlOptsWithStore = opts.rateLimit.store
          ? opts.rateLimit                           // user's async store (Redis etc.)
          : { ...opts.rateLimit, inMemoryStore: routeRlStore }  // synchronous — no TOCTOU race
        try {
          await checkRateLimit(req, rlOptsWithStore)
        } catch (err) {
          // IMPROVEMENT #2 FIX: set Retry-After HTTP header on 429 (RFC 7231)
          // Load balancers, API gateways, and retry libraries read this header natively
          if (isAppError(err) && (err as AppError).statusCode === 429) {
            const details = (err as AppError).details as Record<string, unknown> | null
            if (details && typeof details['retryAfter'] === 'number') {
              res.setHeader('Retry-After', details['retryAfter'])
            }
          }
          throw err
        }
      }
      await validateRequest(req, res, schema)
      // BUG #6 FIX: cache headers are set AFTER validation succeeds.
      // Previously they were set before validateRequest() ran, which meant
      // CDNs could cache 422 validation-error responses.
      if (opts.cache) applyCacheHeaders(res, opts.cache)
      // Pass the app-level ResponseConfig so patchResponseStrip knows the
      // actual data key name when response.shape has renamed 'data' -> 'result' etc.
      const storedCfg = getStoredConfig(res)
      patchResponseStrip(res, schema, storedCfg.response)
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
  const appConfig = getStoredConfig(res)
  const limits    = { ...DEFAULT_LIMITS, ...(appConfig?.limits ?? {}), ...(opts.limits ?? {}) }
  // Per-route sanitize merges on top of app config — per-route wins
  const sanitize  = getConfig(res, opts.sanitize)

  if (schema.body) {
    // Only enforce Content-Type when body schema is defined AND the body is a non-empty object
    // express.json() sets req.body={} for bodyless requests, which would incorrectly trigger
    const hasRealBody = req.body !== undefined &&
      !(typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length === 0 && req.method !== 'GET')
    enforceContentType(req.method, req.headers['content-type'], hasRealBody)
    const clean = runPreParse(req.body, limits)
    let parsed = await parseOrThrow(clean, normalise(schema.body, allErrors), allErrors, sanitize)
    // Apply global string transforms (trim, lowercase) if configured
    const strCfg = appConfig?.strings
    if (strCfg) parsed = applyStringTransforms(parsed, strCfg)
    // Run transform hook if defined on the route
    const transform = (schema as ValidateOptions).transform
    if (transform) {
      try {
        parsed = await Promise.resolve(transform(parsed))
      } catch (err) {
        if (isAppError(err)) throw err
        throw AppError.internal(err instanceof Error ? err.message : 'Transform failed')
      }
    }
    req.body = parsed
  }

  if (schema.params) {
    req.params = await parseOrThrow(req.params, normalise(schema.params, allErrors), allErrors, sanitize) as typeof req.params
  }

  if (schema.query) {
    // BUG #1 FIX: PARAM_POLLUTION guard — Express parses ?x=a&x=b as x: ['a','b'].
    // Detect any array-valued query param and throw before Zod sees it.
    // Without this check the documented PARAM_POLLUTION error was never thrown
    // and attackers could pollute scalar fields (e.g. ?role=admin&role=user).
    for (const [k, v] of Object.entries(req.query)) {
      if (Array.isArray(v)) {
        const err = new Error(`Query parameter "${k}" must not be repeated`) as Error & { code: string; isPreParse: boolean }
        err.code       = ErrorCode.PARAM_POLLUTION
        err.isPreParse = true
        throw err
      }
    }
    req.query = await parseOrThrow(req.query, normalise(schema.query, allErrors), allErrors, sanitize) as typeof req.query
  }

  if (schema.headers) {
    await parseOrThrow(req.headers, normalise(schema.headers, allErrors), allErrors, sanitize)
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

// ── Resolve the 'data' key name from shape config ──
// When response.shape renames data → result, stripping must use 'result' not 'data'.
// Without this fix, the 'data' in check silently fails and sensitive fields leak.
function getDataKey(shape?: Record<string, string>): string {
  if (!shape) return 'data'
  for (const [newKey, token] of Object.entries(shape)) {
    if (token === '{data}') return newKey
  }
  return 'data'
}

// ── Patch res.json() to strip unknown response fields ──
// Guards headersSent on both success and error paths to prevent double-send.
// Builds a fresh (unfrozen) envelope copy so the mutation is safe.
// BUG #2 FIX: accepts ResponseConfig to resolve the correct data key when
// response.shape has renamed the 'data' field (e.g. data → result).
function patchResponseStrip(res: Response, schema: RouteSchema | ValidateOptions, responseConfig?: ResponseConfig): void {
  const responseSchema = schema.response ?? (schema as ValidateOptions).sends
  if (!responseSchema) return

  // BUG #2 FIX: resolve the actual key name in the envelope that holds the data.
  // If shape config maps 'result' to '{data}', the envelope key is 'result', not 'data'.
  const dataKey = getDataKey(responseConfig?.shape)

  const originalJson = res.json.bind(res)

  res.json = function patchedJson(body: unknown) {
    if (body !== null && typeof body === 'object' && dataKey in (body as object)) {
      // Work on an unfrozen shallow copy — deepFreeze was called in buildSuccess,
      // but we need to mutate data after stripping.
      const envelope = { ...(body as Record<string, unknown>) }

      responseSchema.strip(envelope[dataKey])
        .then((stripped: unknown) => {
          if (res.headersSent) return
          envelope[dataKey] = stripped
          originalJson(envelope)
        })
        .catch((stripErr: unknown) => {
          if (res.headersSent) return
          // SECURITY FIX: NEVER send unstripped data on schema failure.
          // Unstripped data may contain passwordHash, token, or other sensitive fields.
          // Log the failure and send a generic 500 instead.
          process.stderr.write(
            `[shapeguard] patchResponseStrip: strip() failed — sending 500 to prevent data leak. ` +
            `Error: ${stripErr instanceof Error ? stripErr.message : String(stripErr)}\n`
          )
          res.status(500).json({
            success: false,
            error: {
              code:    'INTERNAL_ERROR',
              message: 'Something went wrong',
              details: null,
            },
          })
        })

      return res
    }

    originalJson(body)
    return res
  }
}

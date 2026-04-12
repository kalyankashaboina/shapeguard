import { SG_CONFIG_KEY } from '../core/constants.js'
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
import { checkRateLimit as _checkRateLimit, createRateLimitStore } from './rate-limit.js'
import { applyCacheHeaders as _applyCacheHeaders } from './cache-headers.js'
import { patchResponseStrip as _patchResponseStrip, getDataKey as _getDataKey } from './response-strip.js'
import { applyStringTransforms as _applyStringTransforms } from './string-transforms.js'

export interface ValidateOptions extends RouteSchema {
  /**
   * Per-route request timeout in milliseconds.
   * If the handler has not sent a response within this time, shapeguard
   * aborts the request with a 408 Request Timeout error.
   *
   * @example
   * defineRoute({ body: CreateUserDTO, timeout: 5000 })
   */
  timeout?:   number

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
// BUG-M2 FIX: emit a dev-time warning when allErrors:true is set at the route level
// for a Joi/Yup adapter — the adapter's abortEarly flag is baked in at creation time
// and cannot be overridden here. Route-level allErrors:true has no effect on Joi/Yup.
// Reliable fix: pass allErrors to the adapter constructor: joiAdapter(schema, { allErrors: true }).
function normalise(schema: SchemaAdapter | unknown, allErrors?: boolean): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  const adapter = schema as SchemaAdapter
  if (allErrors !== undefined && (adapter.library === 'joi' || adapter.library === 'yup')) {
    if (allErrors === true && typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        `[shapeguard] validate({ allErrors: true }) has no effect on ${adapter.library} adapters — ` +
        `abortEarly is baked in at adapter creation time. ` +
        `Pass it to the adapter constructor instead: ${adapter.library}Adapter(schema, { allErrors: true })`
      )
    }
    return makeAllErrorsAdapter(adapter, allErrors)
  }
  return adapter
}

// Wrapping adapter for Joi/Yup route-level allErrors.
// LIMITATION (BUG-M2): can only truncate errors (allErrors:false). When allErrors:true,
// returns whatever the underlying adapter collected — which may be only 1 error if the
// adapter was created with abortEarly:true. See warning emitted by normalise() above.
function makeAllErrorsAdapter(adapter: SchemaAdapter, allErrors: boolean): SchemaAdapter {
  return {
    library:    adapter.library,
    parse:      (data) => adapter.parse(data),
    strip:      (data) => adapter.strip(data),
    safeParse:  async (data) => {
      const result = await adapter.safeParse(data)
      if (result.success) return result
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
// Exported for backwards-compat — importers should prefer SG_CONFIG_KEY from core/constants.ts
export const VALIDATION_CONFIG_KEY = SG_CONFIG_KEY

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

// checkRateLimit — delegated to validation/rate-limit.ts
const checkRateLimit = _checkRateLimit

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
    // BUG-C1 FIX: assign the parsed result back so req.headers reflects the
    // validated/stripped value, matching the behaviour of body/params/query.
    // Express does not allow full reassignment of req.headers (it's a getter
    // on the IncomingMessage prototype), so we merge the parsed fields in-place.
    const parsedHeaders = await parseOrThrow(req.headers, normalise(schema.headers, allErrors), allErrors, sanitize)
    if (parsedHeaders !== null && typeof parsedHeaders === 'object') {
      Object.assign(req.headers, parsedHeaders)
    }
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
// applyStringTransforms — delegated to validation/string-transforms.ts
const applyStringTransforms = _applyStringTransforms

// getDataKey — delegated to validation/response-strip.ts
// const getDataKey = _getDataKey

// patchResponseStrip — delegated to validation/response-strip.ts
const patchResponseStrip = _patchResponseStrip

// ── Backward-compat export (tests import this directly) ─────────────────────
export function _clearRateLimitStore(): void { /* no-op — stores are now per-route */ }

// ── Main export ──────────────────────────────────────────────────────────────
export function validate(schema: RouteSchema | ValidateOptions): RequestHandler & { cleanup: () => void } {
  const { store: routeRlStore, startCleanup } = createRateLimitStore()
  const stopCleanup = startCleanup()

  const mw = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opts = schema as ValidateOptions

      // ── Rate limit — before validation ──────────────────────────────────
      if (opts.rateLimit) {
        const rlOpts = opts.rateLimit.store
          ? opts.rateLimit
          : { ...opts.rateLimit, inMemoryStore: routeRlStore }
        try {
          await checkRateLimit(req, rlOpts)
        } catch (err) {
          if (isAppError(err) && (err as AppError).statusCode === 429) {
            const details = (err as AppError).details as Record<string, unknown> | null
            if (details && typeof details['retryAfter'] === 'number') {
              res.setHeader('Retry-After', details['retryAfter'])
            }
          }
          throw err
        }
      }

      // ── Schema validation ────────────────────────────────────────────────
      await validateRequest(req, res, schema)

      // ── Cache headers — after validation succeeds ───────────────────────
      if (opts.cache) _applyCacheHeaders(res, opts.cache)

      // ── Response stripping ───────────────────────────────────────────────
      const storedCfg = getStoredConfig(res)
      patchResponseStrip(res, schema, storedCfg.response)

      // ── Per-route request timeout ────────────────────────────────────────
      // IMPORTANT: timeout must write directly to res — NOT call next(err).
      // next() has already been called to proceed to the handler; calling it
      // again from the timeout callback would be a second call on the same
      // request chain which Express 4 ignores. Direct res.status().json() is
      // the only reliable way to send a 408 from an async timer callback.
      if (opts.timeout && opts.timeout > 0) {
        const timeoutMs = opts.timeout
        const timer = setTimeout(() => {
          if (!res.headersSent) {
            res.status(408).json({
              success: false,
              message:  `Request timed out after ${timeoutMs}ms`,
              error: {
                code:    ErrorCode.REQUEST_TIMEOUT,
                message: `Request timed out after ${timeoutMs}ms`,
                details: null,
              },
            })
          }
        }, timeoutMs)
        // Note: no timer.unref() — it prevents the timer from firing in
        // vitest's worker-thread pool and in low-activity event loops.
        // The timer clears itself on response finish/close so it won't leak.
        res.once('finish', () => clearTimeout(timer))
        res.once('close',  () => clearTimeout(timer))
      }

      next()
    } catch (err) {
      next(err)
    }
  }) as RequestHandler & { cleanup: () => void }

  mw.cleanup = stopCleanup
  return mw
}

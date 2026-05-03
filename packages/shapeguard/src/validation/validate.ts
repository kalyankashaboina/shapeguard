import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { RouteSchema, SchemaAdapter, ValidationConfig, ValidationIssue, ResponseConfig } from '../types/index.js'
import { AppError, isAppError }           from '../errors/AppError.js'
import { ErrorCode }                      from '../types/index.js'
import { sanitizeValidationIssue }        from './sanitize.js'
import { runPreParse, DEFAULT_LIMITS, enforceContentType, type PreParseLimits } from '../core/pre-parse.js'
import { asyncHandler }                   from '../errors/not-found.js'
import { zodAdapter, isZodSchema }        from '../adapters/zod.js'
import { checkRateLimit, createRateLimitStore } from './rate-limit.js'
import { applyCacheHeaders }              from './cache-headers.js'
import { patchResponseStrip }             from './response-strip.js'
import { applyStringTransforms }          from './string-transforms.js'
import { SG_CONFIG_KEY }                  from '../core/constants.js'

export interface ValidateOptions extends RouteSchema {
  timeout?:   number
  transform?: (data: unknown) => Promise<unknown> | unknown
  rateLimit?: {
    windowMs:      number
    max:           number
    message?:      string
    store?:        { get(k: string): Promise<{ count: number; reset: number } | null>; set(k: string, v: { count: number; reset: number }): Promise<void> }
    keyGenerator?: (req: Request) => string
    trustProxy?:   boolean
  }
  cache?:     { noStore: true; maxAge?: number; private?: boolean } | { maxAge: number; private?: boolean; noStore?: boolean; sMaxAge?: number; staleWhileRevalidate?: number }
  sends?:     SchemaAdapter
  allErrors?: boolean
  limits?:    Partial<PreParseLimits>
  sanitize?:  ValidationConfig
}

export const VALIDATION_CONFIG_KEY = SG_CONFIG_KEY

interface StoredConfig extends ValidationConfig {
  response?:      ResponseConfig
  globalTimeout?: number
}

const EMPTY_CONFIG: ValidationConfig = Object.freeze({})

function getStoredConfig(res: Response): StoredConfig {
  return ((res.locals as Record<string, unknown>)[VALIDATION_CONFIG_KEY] as StoredConfig | undefined) ?? EMPTY_CONFIG
}

function getMergedConfig(res: Response, perRoute?: ValidationConfig): ValidationConfig {
  return { ...EMPTY_CONFIG, ...getStoredConfig(res), ...(perRoute ?? {}) }
}

function normaliseAdapter(schema: SchemaAdapter | unknown, allErrors?: boolean): SchemaAdapter {
  if (isZodSchema(schema)) return zodAdapter(schema)
  const adapter = schema as SchemaAdapter
  if (allErrors !== undefined && (adapter.library === 'joi' || adapter.library === 'yup')) {
    if (allErrors === true && process.env['NODE_ENV'] !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        `[shapeguard] allErrors:true has no effect on ${adapter.library} adapters — ` +
        `pass allErrors to the adapter constructor: ${adapter.library}Adapter(schema, { allErrors: true })`
      )
    }
    return wrapAllErrors(adapter, allErrors)
  }
  return adapter
}

function wrapAllErrors(adapter: SchemaAdapter, allErrors: boolean): SchemaAdapter {
  return {
    library:   adapter.library,
    parse:     (data) => adapter.parse(data),
    strip:     (data) => adapter.strip(data),
    safeParse: async (data) => {
      const result = await adapter.safeParse(data)
      if (result.success) return result
      if (!allErrors && result.errors.length > 1) {
        return { success: false, errors: [result.errors[0]!] }
      }
      return result
    },
  }
}

async function validateParts(req: Request, res: Response, schema: RouteSchema | ValidateOptions): Promise<void> {
  const opts      = schema as ValidateOptions
  const allErrors = opts.allErrors ?? false
  const appConfig = getStoredConfig(res)
  const limits    = { ...DEFAULT_LIMITS, ...(appConfig?.limits ?? {}), ...(opts.limits ?? {}) }
  const sanitize  = getMergedConfig(res, opts.sanitize)

  if (schema.body) {
    const hasRealBody = req.body !== undefined &&
      !(typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length === 0 && req.method !== 'GET')
    enforceContentType(req.method, req.headers['content-type'], hasRealBody)
    const clean = runPreParse(req.body, limits)
    let parsed = await parseOrThrow(clean, normaliseAdapter(schema.body, allErrors), allErrors, sanitize)
    const strCfg = appConfig?.strings
    if (strCfg) parsed = applyStringTransforms(parsed, strCfg)
    const transform = opts.transform
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
    req.params = await parseOrThrow(req.params, normaliseAdapter(schema.params, allErrors), allErrors, sanitize) as typeof req.params
  }

  if (schema.query) {
    for (const [k, v] of Object.entries(req.query)) {
      if (Array.isArray(v)) {
        const err = new Error(`Query parameter "${k}" must not be repeated`) as Error & { code: string; isPreParse: boolean }
        err.code       = ErrorCode.PARAM_POLLUTION
        err.isPreParse = true
        throw err
      }
    }
    req.query = await parseOrThrow(req.query, normaliseAdapter(schema.query, allErrors), allErrors, sanitize) as typeof req.query
  }

  if (schema.headers) {
    const parsedHeaders = await parseOrThrow(req.headers, normaliseAdapter(schema.headers, allErrors), allErrors, sanitize)
    if (parsedHeaders !== null && typeof parsedHeaders === 'object') {
      Object.assign(req.headers, parsedHeaders)
    }
  }
}

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

/** @internal — used in tests to reset rate limit state between suites */
export function _clearRateLimitStore(): void { /* stores are per-route — no global state to clear */ }

export function validate(schema: RouteSchema | ValidateOptions): RequestHandler & { cleanup: () => void } {
  const { store: routeRlStore, startCleanup } = createRateLimitStore()
  const stopCleanup = startCleanup()

  const mw = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opts = schema as ValidateOptions

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

      await validateParts(req, res, schema)

      if (opts.cache) applyCacheHeaders(res, opts.cache)

      const storedCfg = getStoredConfig(res)
      patchResponseStrip(res, schema, storedCfg.response)

      // Per-route timeout takes precedence over global timeout from shapeguard()
      const timeoutMs = opts.timeout ?? storedCfg.globalTimeout
      if (timeoutMs && timeoutMs > 0) {
        const timer = setTimeout(() => {
          if (!res.headersSent) {
            res.status(408).json({
              success: false,
              message: `Request timed out after ${timeoutMs}ms`,
              error: {
                code:    ErrorCode.REQUEST_TIMEOUT,
                message: `Request timed out after ${timeoutMs}ms`,
                details: null,
              },
            })
          }
        }, timeoutMs)
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

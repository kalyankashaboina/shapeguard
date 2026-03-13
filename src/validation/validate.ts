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

export function validate(schema: RouteSchema | ValidateOptions): RequestHandler {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
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
    req.body = await parseOrThrow(clean, normalise(schema.body), allErrors, sanitize)
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

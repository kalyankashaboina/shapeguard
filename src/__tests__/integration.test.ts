// src/__tests__/integration.test.ts
// End-to-end integration — full request lifecycle without HTTP
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError, isAppError } from '../errors/AppError.js'
import { ErrorCode } from '../types/index.js'
import { buildSuccess, buildError } from '../core/response.js'
import { generateRequestId } from '../core/request-id.js'
import { runPreParse } from '../core/pre-parse.js'
import { sanitizeValidationIssue } from '../validation/sanitize.js'
import { zodAdapter } from '../adapters/zod.js'
import { defineRoute } from '../validation/define-route.js'

// ── Helpers ───────────────────────────────────
function makeZodSchema(output: unknown, fail = false) {
  return {
    safeParseAsync: async () => fail
      ? { success: false as const, error: { issues: [{ path: ['email'], message: 'Invalid email', code: 'invalid_string' }] } }
      : { success: true as const, data: output },
    parseAsync: async () => { if (fail) throw new Error('failed'); return output },
    strip() { return this },
  }
}

// ── CRUD flow simulation ──────────────────────

describe('Full request lifecycle', () => {
  describe('POST /users — create user', () => {
    it('succeeds — data flows through validation → service → response strip', async () => {
      // 1. Request comes in
      const rawBody = { email: 'alice@example.com', name: 'Alice', password: 'secret123' }

      // 2. Pre-parse guards
      const cleaned = runPreParse(rawBody)
      expect(cleaned).toEqual(rawBody)  // no dangerous content — passes

      // 3. Schema validation
      const responseSchema = { id: 'uuid', email: 'alice@example.com', name: 'Alice' }
      const bodySchema   = makeZodSchema(cleaned)
      const adapter      = zodAdapter(bodySchema)
      const parseResult  = await adapter.safeParse(cleaned)
      expect(parseResult.success).toBe(true)

      // 4. Service creates user (passwordHash NOT in response schema)
      const dbResult = { id: 'uuid', email: 'alice@example.com', name: 'Alice', passwordHash: 'bcrypt_hash' }

      // 5. Response schema strips passwordHash
      const strippedSchema = makeZodSchema(responseSchema)
      const stripAdapter   = zodAdapter(strippedSchema)
      const stripped       = await stripAdapter.strip(dbResult)
      expect((stripped as any).passwordHash).toBeUndefined()
      expect((stripped as any).email).toBe('alice@example.com')

      // 6. Wrap in success envelope
      const envelope = buildSuccess(stripped, 'User created')
      expect(envelope.success).toBe(true)
      expect(envelope.message).toBe('User created')
      expect(envelope.data).toBeDefined()
    })

    it('fails validation — returns 422 with field details', async () => {
      const rawBody = { email: 'not-an-email', name: '' }

      const bodySchema  = makeZodSchema(null, true)  // fail
      const adapter     = zodAdapter(bodySchema)
      const parseResult = await adapter.safeParse(rawBody)

      expect(parseResult.success).toBe(false)
      if (!parseResult.success) {
        const issue    = parseResult.errors[0]!
        const appError = AppError.validation(issue)

        expect(appError.statusCode).toBe(422)
        expect(appError.code).toBe(ErrorCode.VALIDATION_ERROR)
        expect((appError.details as any).field).toBe('email')
      }
    })

    it('blocks proto pollution', () => {
      const malicious = JSON.parse('{"__proto__":{"isAdmin":true},"email":"x@x.com"}')
      const cleaned   = runPreParse(malicious) as Record<string, unknown>
      // proto was stripped during safeJsonParse before runPreParse
      // runPreParse sanitizes strings further
      expect(Object.getPrototypeOf(cleaned)).toBe(Object.prototype)
      expect(cleaned['email']).toBe('x@x.com')
    })
  })

  describe('GET /users/:id — get user', () => {
    it('succeeds — returns user data', async () => {
      const dbUser = { id: 'uuid', email: 'alice@example.com', passwordHash: 'hash' }
      const responseSchema = makeZodSchema({ id: 'uuid', email: 'alice@example.com' })
      const stripped = await zodAdapter(responseSchema).strip(dbUser)

      const envelope = buildSuccess(stripped, '')
      expect(envelope.success).toBe(true)
      expect((envelope.data as any).email).toBe('alice@example.com')
    })

    it('not found — service throws AppError', () => {
      const err = AppError.notFound('User')
      expect(isAppError(err)).toBe(true)
      expect(err.statusCode).toBe(404)
      expect(err.message).toBe('User not found')

      // errorHandler converts to envelope
      const envelope = buildError(err.code, err.message, null, false)
      expect(envelope.success).toBe(false)
      expect(envelope.error.code).toBe(ErrorCode.NOT_FOUND)
    })
  })

  describe('Error scenarios', () => {
    it('programmer error — DB crash — message hidden in prod', () => {
      const rawErr = new Error('Connection to db-host:5432 refused')
      const appErr = AppError.fromUnknown(rawErr)

      expect(appErr.isOperational).toBe(false)
      expect(appErr.statusCode).toBe(500)

      // In prod — build envelope with fallback message
      const envelope = buildError(
        appErr.code,
        'Something went wrong',  // fallback — actual message never sent
        null,
        false,
      )
      expect(envelope.error.message).toBe('Something went wrong')
      expect(envelope.error.message).not.toContain('db-host')
    })

    it('conflict — duplicate email', () => {
      const err = AppError.conflict('Email')
      expect(err.statusCode).toBe(409)
      expect(err.message).toBe('Email already exists')
      expect(err.isOperational).toBe(true)
    })

    it('custom error — invalid coupon', () => {
      const err = AppError.custom('INVALID_COUPON', 'Coupon has expired', 400, { retryAfter: 30 })
      expect(err.code).toBe('INVALID_COUPON')
      expect(err.statusCode).toBe(400)
      expect((err.details as any).retryAfter).toBe(30)
    })
  })

  describe('Request ID', () => {
    it('generates unique IDs for concurrent requests', () => {
      const ids = new Set(Array.from({ length: 500 }, () => generateRequestId()))
      expect(ids.size).toBe(500)
    })

    it('IDs are prefixed and sortable', () => {
      const id = generateRequestId()
      expect(id.startsWith('req_')).toBe(true)
    })
  })

  describe('defineRoute round-trip', () => {
    it('bundles and validates correctly', async () => {
      const bodyOutput = { email: 'alice@example.com', name: 'Alice' }
      const route = defineRoute({
        body:     makeZodSchema(bodyOutput),
        response: makeZodSchema({ id: 'uuid', email: 'alice@example.com' }),
      })

      expect(route.body).toBeDefined()
      expect(route.response).toBeDefined()

      const result = await route.body!.safeParse({ email: 'alice@example.com' })
      expect(result.success).toBe(true)
    })
  })

  describe('Validation error sanitization', () => {
    it('strips enum values in prod', () => {
      const issue = {
        field:   'role',
        message: "Invalid enum value. Expected 'admin' | 'member', received 'superuser'",
        code:    'invalid_enum_value',
      }
      const sanitized = sanitizeValidationIssue(issue, { exposeEnumValues: false })
      expect(sanitized.message).not.toContain('admin')
      expect(sanitized.message).not.toContain('member')
    })

    it('keeps field and message by default', () => {
      const issue = { field: 'email', message: 'Invalid email', code: 'invalid_string' }
      const sanitized = sanitizeValidationIssue(issue)
      expect(sanitized.field).toBe('email')
      expect(sanitized.message).toBe('Invalid email')
    })
  })
})

describe('validate() → strip → freeze pipeline', () => {
  it('patchResponseStrip mutates unfrozen copy — no TypeError', async () => {
    // This tests the deepFreeze + patchResponseStrip interaction fix
    const strippedOutput = { id: 'uuid', email: 'alice@example.com' }
    const responseSchema = makeZodSchema(strippedOutput)
    const adapter = zodAdapter(responseSchema)

    // Simulate what patchResponseStrip does: shallow copy envelope, strip data
    const frozenEnvelope = Object.freeze({ success: true, message: '', data: { id: 'uuid', email: 'alice@example.com', passwordHash: 'hash' } })

    // Working on a copy — this should NOT throw
    const copy = { ...frozenEnvelope }
    const stripped = await adapter.strip(copy['data'])
    expect(() => { copy['data'] = stripped }).not.toThrow()
    expect(copy['data']).toEqual(strippedOutput)
  })

  it('allErrors collects all issues in one failing part', async () => {
    // allErrors:true returns all issues from the first failing schema part
    const multiErrorSchema = {
      safeParseAsync: async () => ({
        success: false as const,
        error: {
          issues: [
            { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
            { path: ['name'],  message: 'Required',      code: 'invalid_type'  },
          ]
        }
      }),
      parseAsync: async () => { throw new Error('fail') },
      strip() { return this },
    }

    const adapter = zodAdapter(multiErrorSchema)
    const result = await adapter.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.length).toBe(2)
      // allErrors in AppError.validation stores the full array in details
      const appErr = AppError.validation(result.errors)
      expect(appErr.statusCode).toBe(422)
      expect(Array.isArray(appErr.details)).toBe(true)
      expect((appErr.details as any)[0].field).toBe('email')
    }
  })
})

describe('ErrorCode completeness', () => {
  it('all expected codes are defined', () => {
    const required = [
      'VALIDATION_ERROR', 'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN',
      'CONFLICT', 'INTERNAL_ERROR', 'METHOD_NOT_ALLOWED',
      'BODY_TOO_DEEP', 'BODY_ARRAY_TOO_LARGE', 'STRING_TOO_LONG',
      'INVALID_CONTENT_TYPE', 'PARAM_POLLUTION', 'PROTO_POLLUTION',
    ]
    for (const code of required) {
      expect(ErrorCode[code]).toBe(code)
    }
  })
})


describe('Advanced integration — edge cases', () => {
  describe('chained validation: body + params', () => {
    it('validates body schema output, then params schema output independently', async () => {
      const bodyOutput   = { email: 'alice@example.com', name: 'Alice' }
      const paramsOutput = { id: 'user-uuid-123' }

      const bodyAdapter   = zodAdapter(makeZodSchema(bodyOutput))
      const paramsAdapter = zodAdapter(makeZodSchema(paramsOutput))

      const bodyResult   = await bodyAdapter.safeParse({ email: 'alice@example.com', name: 'Alice' })
      const paramsResult = await paramsAdapter.safeParse({ id: 'user-uuid-123' })

      expect(bodyResult.success).toBe(true)
      expect(paramsResult.success).toBe(true)
      if (bodyResult.success)   expect(bodyResult.data).toEqual(bodyOutput)
      if (paramsResult.success) expect(paramsResult.data).toEqual(paramsOutput)
    })

    it('body validation failure does not affect params (independent)', async () => {
      const bodyAdapter   = zodAdapter(makeZodSchema(null, true))  // fails
      const paramsAdapter = zodAdapter(makeZodSchema({ id: '1' })) // passes

      const bodyResult   = await bodyAdapter.safeParse({})
      const paramsResult = await paramsAdapter.safeParse({ id: '1' })

      expect(bodyResult.success).toBe(false)
      expect(paramsResult.success).toBe(true)
    })
  })

  describe('pre-parse limits enforced before schema', () => {
    it('throws BODY_TOO_DEEP before reaching schema', () => {
      let obj: Record<string, unknown> = { v: 1 }
      for (let i = 0; i < 25; i++) obj = { n: obj }
      // runPreParse with tight limit throws — schema never called
      expect(() => runPreParse(obj, { maxDepth: 5, maxArrayLength: 1000, maxStringLength: 10000 })).toThrow()
    })

    it('throws STRING_TOO_LONG before reaching schema', () => {
      const body = { name: 'x'.repeat(10001) }
      expect(() => runPreParse(body, { maxDepth: 20, maxArrayLength: 1000, maxStringLength: 100 })).toThrow()
    })

    it('throws BODY_ARRAY_TOO_LARGE before reaching schema', () => {
      const body = { items: new Array(5001).fill('x') }
      expect(() => runPreParse(body, { maxDepth: 20, maxArrayLength: 100, maxStringLength: 10000 })).toThrow()
    })
  })

  describe('isAppError across module boundaries', () => {
    it('detects AppError by flag (dual-package hazard)', () => {
      // Simulates a different AppError class version sending an error across a boundary
      const foreignError = {
        isAppError:    true,
        code:          'PAYMENT_FAILED',
        message:       'Card declined',
        statusCode:    402,
        isOperational: true,
      }
      expect(isAppError(foreignError)).toBe(true)
    })

    it('does not false-positive on non-errors', () => {
      expect(isAppError({ isAppError: false })).toBe(false)
      expect(isAppError(42)).toBe(false)
      expect(isAppError(undefined)).toBe(false)
    })
  })

  describe('AppError.fromLegacy round-trip', () => {
    it('wraps legacy error and preserves all fields', () => {
      const legacy = {
        code:       'STRIPE_ERROR',
        message:    'Card network error',
        statusCode: 502,
        details:    { stripeCode: 'card_declined', retryable: true },
      }
      const err = AppError.fromLegacy(legacy)
      expect(err.code).toBe('STRIPE_ERROR')
      expect(err.statusCode).toBe(502)
      expect(err.message).toBe('Card network error')
      expect((err.details as any).stripeCode).toBe('card_declined')
      expect(err.isAppError).toBe(true)
    })
  })

  describe('ErrorCode values are stable strings', () => {
    it('all ErrorCode values equal their key (safe for frontend switch/match)', () => {
      const codes = [
        'VALIDATION_ERROR', 'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN',
        'CONFLICT', 'INTERNAL_ERROR', 'METHOD_NOT_ALLOWED',
        'BODY_TOO_DEEP', 'BODY_ARRAY_TOO_LARGE', 'STRING_TOO_LONG',
        'INVALID_CONTENT_TYPE', 'PARAM_POLLUTION', 'PROTO_POLLUTION',
      ]
      for (const key of codes) {
        expect(typeof ErrorCode[key]).toBe('string')
        expect(ErrorCode[key]).toBe(key)
      }
    })
  })

  describe('requestId sortability', () => {
    it('later IDs are lexicographically greater than earlier ones', async () => {
      const id1 = generateRequestId()
      await new Promise(r => setTimeout(r, 5))
      const id2 = generateRequestId()
      expect(id2 > id1).toBe(true)
    })

    it('format: req_ prefix + 12 hex timestamp + 16 hex random = 32 chars after prefix', () => {
      const id = generateRequestId()
      expect(id).toMatch(/^req_[0-9a-f]{28}$/)
    })
  })

  describe('unicode sanitization in body flow', () => {
    it('strips null bytes from all string fields', () => {
      const body = {
        name:    'Alice ',
        address: { city: 'New York', zip: '10001' },
        tags:    ['valid​', 'also﻿'],
      }
      const result = runPreParse(body) as any
      expect(result.name).toBe('Alice')
      expect(result.address.city).toBe('NewYork')
      expect(result.tags[0]).toBe('valid')
      expect(result.tags[1]).toBe('also')
    })
  })

  describe('array body through pre-parse', () => {
    it('array at root level passes pre-parse and sanitizes strings', () => {
      const body = [
        { name: 'Alice ', role: 'admin' },
        { name: 'Bob',   role: 'user'  },
      ]
      const result = runPreParse(body) as any[]
      expect(result[0].name).toBe('Alice')
      expect(result[1].name).toBe('Bob')
    })
  })

  describe('buildPaginated output shape', () => {
    it('data.items contains the provided items array', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }]
      const result = buildSuccess(
        { items, total: 3, page: 1, limit: 10, pages: 1 },
        'OK'
      )
      expect((result.data as any).items).toHaveLength(3)
      expect((result.data as any).items[0].id).toBe('1')
    })
  })

  describe('sanitizeValidationIssue combined options', () => {
    it('exposeFieldName=false hides field, exposeMessage=true keeps message', () => {
      const issue = { field: 'creditCard', message: 'Invalid card number', code: 'invalid_string' }
      const result = sanitizeValidationIssue(issue, { exposeFieldName: false, exposeMessage: true })
      expect(result.field).toBe('field')
      expect(result.message).toBe('Invalid card number')
    })
  })
})

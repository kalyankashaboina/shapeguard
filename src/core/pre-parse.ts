// ─────────────────────────────────────────────
// core/pre-parse.ts — shapeguard
// Runs BEFORE Zod/Joi/Yup touches data.
// All guard functions are exported individually for testability,
// and runPreParse does a single-pass traversal for performance.
// ─────────────────────────────────────────────

import { ErrorCode } from '../types/index.js'

export interface PreParseLimits {
  maxDepth:        number
  maxArrayLength:  number
  maxStringLength: number
}

export const DEFAULT_LIMITS: PreParseLimits = {
  maxDepth:        20,
  maxArrayLength:  1000,
  maxStringLength: 10_000,
}

// ── Depth check (exported for unit tests) ────
export function checkDepth(data: unknown, max: number, current = 0): void {
  if (current > max) {
    throw preParsError(ErrorCode.BODY_TOO_DEEP, `Object nesting exceeds maximum depth of ${max}`)
  }
  if (Array.isArray(data)) {
    for (const val of data) checkDepth(val, max, current + 1)
  } else if (data !== null && typeof data === 'object') {
    for (const val of Object.values(data as object)) checkDepth(val, max, current + 1)
  }
}

// ── Array length check (exported for unit tests) ──
export function checkArrayLengths(data: unknown, max: number): void {
  if (Array.isArray(data)) {
    if (data.length > max) {
      throw preParsError(ErrorCode.BODY_ARRAY_TOO_LARGE, `Array length ${data.length} exceeds maximum of ${max}`)
    }
    for (const item of data) checkArrayLengths(item, max)
  } else if (data !== null && typeof data === 'object') {
    for (const val of Object.values(data as object)) checkArrayLengths(val, max)
  }
}

// ── String length check (exported for unit tests) ──
export function checkStringLengths(data: unknown, max: number): void {
  if (typeof data === 'string') {
    if (data.length > max) {
      throw preParsError(ErrorCode.STRING_TOO_LONG, `String field exceeds maximum of ${max} characters`)
    }
  } else if (Array.isArray(data)) {
    for (const item of data) checkStringLengths(item, max)
  } else if (data !== null && typeof data === 'object') {
    for (const val of Object.values(data as object)) checkStringLengths(val, max)
  }
}

// ── Unicode sanitize (exported for unit tests) ──
// Single combined regex — one pass over the string instead of 8 chained replaces.
const UNSAFE_CHARS = /[\u0000\u200B-\u200D\uFEFF\u202A\u202E\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function sanitizeStrings(data: unknown): unknown {
  if (typeof data === 'string') return data.normalize('NFC').replace(UNSAFE_CHARS, '')
  if (Array.isArray(data))     return data.map(sanitizeStrings)
  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data as object)) out[k] = sanitizeStrings(v)
    return out
  }
  return data
}

// ── Content-Type enforcement ──────────────────
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const ALLOWED_CT   = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data']

export function enforceContentType(method: string, contentType: string | undefined, hasBody: boolean): void {
  if (!BODY_METHODS.has(method.toUpperCase()) || !hasBody) return
  if (!contentType) {
    throw preParsError(ErrorCode.INVALID_CONTENT_TYPE, 'Content-Type header is required for POST, PUT, and PATCH requests')
  }
  const ct = contentType.toLowerCase().split(';')[0]!.trim()
  if (!ALLOWED_CT.some(a => ct.startsWith(a))) {
    throw preParsError(ErrorCode.INVALID_CONTENT_TYPE, `Content-Type '${ct}' is not supported`)
  }
}

// ── Safe JSON parse ───────────────────────────
// Strips __proto__ / constructor / prototype at parse time via reviver.
// Used for direct JSON parsing outside of express.json() middleware.
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw, (key, value) =>
      BLOCKED_KEYS.has(key) ? undefined : value as unknown
    )
  } catch {
    const err = new Error('Request body is not valid JSON') as Error & { code: string; isPreParse: boolean }
    err.code       = 'INVALID_JSON'
    err.isPreParse = true
    throw err
  }
}

// ── Run all guards — single-pass for performance ──
// Checks depth + array length + string length + sanitizes in one recursive walk.
// Also skips dangerous keys (__proto__, constructor, prototype) when rebuilding objects
// to prevent prototype pollution even if data arrives without going through safeJsonParse.
export function runPreParse(data: unknown, limits: PreParseLimits = DEFAULT_LIMITS): unknown {
  return _pass(data, limits, 0)
}

const BLOCKED_REBUILD = new Set(['__proto__', 'constructor', 'prototype'])

function _pass(data: unknown, limits: PreParseLimits, depth: number): unknown {
  if (depth > limits.maxDepth) {
    throw preParsError(ErrorCode.BODY_TOO_DEEP, `Object nesting exceeds maximum depth of ${limits.maxDepth}`)
  }
  if (typeof data === 'string') {
    if (data.length > limits.maxStringLength) {
      throw preParsError(ErrorCode.STRING_TOO_LONG, `String field exceeds maximum of ${limits.maxStringLength} characters`)
    }
    return data.normalize('NFC').replace(UNSAFE_CHARS, '')
  }
  if (Array.isArray(data)) {
    if (data.length > limits.maxArrayLength) {
      throw preParsError(ErrorCode.BODY_ARRAY_TOO_LARGE, `Array length ${data.length} exceeds maximum of ${limits.maxArrayLength}`)
    }
    return data.map(item => _pass(item, limits, depth + 1))
  }
  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data as object)) {
      if (BLOCKED_REBUILD.has(k)) continue  // skip __proto__ etc — prevents proto pollution
      // Use defineProperty so assigning key '__proto__' never sets the prototype of out
      Object.defineProperty(out, k, { value: _pass(v, limits, depth + 1), writable: true, enumerable: true, configurable: true })
    }
    return out
  }
  return data
}

// ── Error factory ─────────────────────────────
function preParsError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code: string; isPreParse: boolean }
  err.code       = code
  err.isPreParse = true
  return err
}

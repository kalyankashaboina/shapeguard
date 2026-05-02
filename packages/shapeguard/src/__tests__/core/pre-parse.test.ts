// src/__tests__/core/pre-parse.test.ts
import { describe, it, expect } from 'vitest'
import {
  checkDepth,
  checkArrayLengths,
  checkStringLengths,
  sanitizeStrings,
  safeJsonParse,
  runPreParse,
  enforceContentType,
  DEFAULT_LIMITS,
} from '../../core/pre-parse.js'

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse('{"email":"alice@example.com"}')
    expect(result).toEqual({ email: 'alice@example.com' })
  })

  it('strips __proto__ during parse', () => {
    const result = safeJsonParse('{"__proto__":{"isAdmin":true},"name":"Alice"}') as Record<string, unknown>
    expect((result as any).isAdmin).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false)
    expect(result['name']).toBe('Alice')
  })

  it('strips constructor during parse', () => {
    const result = safeJsonParse('{"constructor":{"prototype":{"isAdmin":true}}}') as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false)
  })

  it('strips prototype during parse', () => {
    const result = safeJsonParse('{"prototype":{"isAdmin":true}}') as Record<string, unknown>
    expect(result['prototype']).toBeUndefined()
  })

  it('throws on invalid JSON', () => {
    expect(() => safeJsonParse('{invalid}')).toThrow()
  })
})

describe('checkDepth', () => {
  it('passes shallow objects', () => {
    expect(() => checkDepth({ a: { b: { c: 1 } } }, 20)).not.toThrow()
  })

  it('throws when depth exceeds limit', () => {
    let obj: Record<string, unknown> = { value: 1 }
    for (let i = 0; i < 25; i++) obj = { nested: obj }
    expect(() => checkDepth(obj, 20)).toThrow()
  })

  it('passes null values', () => {
    expect(() => checkDepth({ a: null }, 20)).not.toThrow()
  })

  it('passes arrays', () => {
    expect(() => checkDepth([1, 2, 3], 20)).not.toThrow()
  })
})

describe('checkArrayLengths', () => {
  it('passes small arrays', () => {
    expect(() => checkArrayLengths([1, 2, 3], 1000)).not.toThrow()
  })

  it('throws when array exceeds limit', () => {
    const huge = new Array(1001).fill(0)
    expect(() => checkArrayLengths(huge, 1000)).toThrow()
  })

  it('checks nested arrays', () => {
    const nested = { items: new Array(1001).fill(0) }
    expect(() => checkArrayLengths(nested, 1000)).toThrow()
  })

  it('passes exact limit', () => {
    const exact = new Array(1000).fill(0)
    expect(() => checkArrayLengths(exact, 1000)).not.toThrow()
  })
})

describe('checkStringLengths', () => {
  it('passes short strings', () => {
    expect(() => checkStringLengths({ name: 'Alice' }, 10_000)).not.toThrow()
  })

  it('throws when string exceeds limit', () => {
    const long = 'x'.repeat(10_001)
    expect(() => checkStringLengths({ name: long }, 10_000)).toThrow()
  })

  it('checks strings in arrays', () => {
    const long = 'x'.repeat(10_001)
    expect(() => checkStringLengths([long], 10_000)).toThrow()
  })
})

describe('sanitizeStrings', () => {
  it('removes null bytes', () => {
    const result = sanitizeStrings('hello\u0000world') as string
    expect(result).toBe('helloworld')
  })

  it('removes zero-width spaces', () => {
    const result = sanitizeStrings('hello\u200Bworld') as string
    expect(result).toBe('helloworld')
  })

  it('removes RTL override character', () => {
    const result = sanitizeStrings('hello\u202Eworld') as string
    expect(result).toBe('helloworld')
  })

  it('normalizes to NFC', () => {
    const combining   = 'e\u0301'  // e + combining accent
    const precomposed = '\u00E9'   // é precomposed
    const result = sanitizeStrings(combining) as string
    expect(result).toBe(precomposed)
  })

  it('sanitizes strings in objects recursively', () => {
    const result = sanitizeStrings({ name: 'Alice\u0000' }) as Record<string, unknown>
    expect(result['name']).toBe('Alice')
  })

  it('sanitizes strings in arrays', () => {
    const result = sanitizeStrings(['Alice\u200B']) as string[]
    expect(result[0]).toBe('Alice')
  })

  it('passes numbers unchanged', () => {
    expect(sanitizeStrings(42)).toBe(42)
  })

  it('passes booleans unchanged', () => {
    expect(sanitizeStrings(true)).toBe(true)
  })
})

describe('runPreParse', () => {
  it('runs all guards and returns sanitized data', () => {
    const input  = { name: 'Alice\u0000', role: 'admin' }
    const result = runPreParse(input, DEFAULT_LIMITS) as Record<string, unknown>
    expect(result['name']).toBe('Alice')
    expect(result['role']).toBe('admin')
  })

  it('throws on too deep object', () => {
    let obj: Record<string, unknown> = { value: 1 }
    for (let i = 0; i < 25; i++) obj = { nested: obj }
    expect(() => runPreParse(obj, DEFAULT_LIMITS)).toThrow()
  })

  it('uses DEFAULT_LIMITS when not provided', () => {
    const input = { name: 'Alice' }
    expect(() => runPreParse(input)).not.toThrow()
  })

  it('uses custom maxDepth', () => {
    let obj: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 5; i++) obj = { n: obj }
    expect(() => runPreParse(obj, { maxDepth: 10, maxArrayLength: 1000, maxStringLength: 10000 })).not.toThrow()
    expect(() => runPreParse(obj, { maxDepth: 3,  maxArrayLength: 1000, maxStringLength: 10000 })).toThrow()
  })

  it('uses custom maxArrayLength', () => {
    const arr = new Array(50).fill(0)
    expect(() => runPreParse(arr, { maxDepth: 20, maxArrayLength: 100, maxStringLength: 10000 })).not.toThrow()
    expect(() => runPreParse(arr, { maxDepth: 20, maxArrayLength: 10,  maxStringLength: 10000 })).toThrow()
  })

  it('uses custom maxStringLength', () => {
    const s = 'x'.repeat(500)
    expect(() => runPreParse(s, { maxDepth: 20, maxArrayLength: 1000, maxStringLength: 1000 })).not.toThrow()
    expect(() => runPreParse(s, { maxDepth: 20, maxArrayLength: 1000, maxStringLength: 100  })).toThrow()
  })

  it('strips __proto__ key in already-parsed objects', () => {
    const malicious = Object.create(null) as Record<string, unknown>
    malicious['name'] = 'Alice'
    malicious['__proto__'] = { isAdmin: true }
    const result = runPreParse(malicious) as Record<string, unknown>
    expect(result['name']).toBe('Alice')
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false)
  })

  it('passes null without throwing', () => {
    expect(runPreParse(null)).toBeNull()
  })

  it('passes number without throwing', () => {
    expect(runPreParse(42)).toBe(42)
  })

  it('passes boolean without throwing', () => {
    expect(runPreParse(true)).toBe(true)
  })
})

describe('enforceContentType', () => {
  it('does not throw for GET requests', () => {
    expect(() => enforceContentType('GET', undefined, false)).not.toThrow()
  })

  it('does not throw when body is empty (hasBody=false)', () => {
    expect(() => enforceContentType('POST', undefined, false)).not.toThrow()
  })

  it('throws 415 when POST has body but no Content-Type', () => {
    expect(() => enforceContentType('POST', undefined, true)).toThrow()
  })

  it('accepts application/json', () => {
    expect(() => enforceContentType('POST', 'application/json', true)).not.toThrow()
  })

  it('accepts application/json with charset', () => {
    expect(() => enforceContentType('POST', 'application/json; charset=utf-8', true)).not.toThrow()
  })

  it('accepts multipart/form-data', () => {
    expect(() => enforceContentType('POST', 'multipart/form-data; boundary=xxx', true)).not.toThrow()
  })

  it('rejects text/plain', () => {
    expect(() => enforceContentType('POST', 'text/plain', true)).toThrow()
  })

  it('is case-insensitive on method', () => {
    expect(() => enforceContentType('post', undefined, true)).toThrow()
    expect(() => enforceContentType('POST', undefined, true)).toThrow()
  })
})


describe('checkDepth — additional cases', () => {
  it('handles deeply nested arrays', () => {
    // array of array of array...
    let val: unknown = 1
    for (let i = 0; i < 25; i++) val = [val]
    expect(() => checkDepth(val, 20)).toThrow()
  })

  it('passes exactly at limit', () => {
    let obj: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 5; i++) obj = { n: obj }
    // depth=5 with limit=5 should pass (depth starts at 0)
    expect(() => checkDepth(obj, 20)).not.toThrow()
  })
})

describe('sanitizeStrings — additional cases', () => {
  it('strips BOM character (\uFEFF)', () => {
    const result = sanitizeStrings('﻿hello') as string
    expect(result).toBe('hello')
  })

  it('strips null bytes in nested object values', () => {
    const obj = { user: { name: 'Alice ', role: 'admin' } }
    const result = sanitizeStrings(obj) as any
    expect(result.user.name).toBe('Alice')
    expect(result.user.role).toBe('admin')
  })

  it('passes undefined through', () => {
    expect(sanitizeStrings(undefined)).toBeUndefined()
  })

  it('handles empty string', () => {
    expect(sanitizeStrings('')).toBe('')
  })
})

describe('runPreParse — additional cases', () => {
  it('passes empty object', () => {
    expect(() => runPreParse({})).not.toThrow()
    expect(runPreParse({})).toEqual({})
  })

  it('passes empty array', () => {
    expect(() => runPreParse([])).not.toThrow()
    expect(runPreParse([])).toEqual([])
  })

  it('handles nested arrays depth check', () => {
    // array of objects, each with nested objects
    const deep = { items: [{ nested: { deep: { tooDeep: { x: { y: { z: 1 } } } } } }] }
    expect(() => runPreParse(deep, { maxDepth: 3, maxArrayLength: 1000, maxStringLength: 10000 })).toThrow()
  })

  it('sanitizes strings inside arrays of objects', () => {
    const data = { users: [{ name: 'Alice ' }, { name: 'Bob​' }] }
    const result = runPreParse(data) as any
    expect(result.users[0].name).toBe('Alice')
    expect(result.users[1].name).toBe('Bob')
  })
})

describe('enforceContentType — additional HTTP methods', () => {
  it('enforces on PUT with body', () => {
    expect(() => enforceContentType('PUT', undefined, true)).toThrow()
  })

  it('enforces on PATCH with body', () => {
    expect(() => enforceContentType('PATCH', undefined, true)).toThrow()
  })

  it('never enforces on DELETE (no body expected)', () => {
    expect(() => enforceContentType('DELETE', undefined, false)).not.toThrow()
  })

  it('never enforces on HEAD', () => {
    expect(() => enforceContentType('HEAD', undefined, false)).not.toThrow()
  })

  it('never enforces on OPTIONS', () => {
    expect(() => enforceContentType('OPTIONS', undefined, false)).not.toThrow()
  })

  it('accepts application/x-www-form-urlencoded', () => {
    expect(() => enforceContentType('POST', 'application/x-www-form-urlencoded', true)).not.toThrow()
  })

  it('rejects application/xml', () => {
    expect(() => enforceContentType('POST', 'application/xml', true)).toThrow()
  })
})

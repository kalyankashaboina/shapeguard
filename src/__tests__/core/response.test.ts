// src/__tests__/core/response.test.ts
import { describe, it, expect } from 'vitest'
import {
  deepFreeze,
  detectCircular,
  buildSuccess,
  buildPaginated,
  buildError,
} from '../../core/response.js'

describe('deepFreeze', () => {
  it('freezes top-level object', () => {
    const obj = deepFreeze({ a: 1 })
    expect(Object.isFrozen(obj)).toBe(true)
  })

  it('freezes nested objects', () => {
    const obj = deepFreeze({ a: { b: { c: 1 } } })
    expect(Object.isFrozen((obj as any).a)).toBe(true)
    expect(Object.isFrozen((obj as any).a.b)).toBe(true)
  })

  it('passes primitives through', () => {
    expect(deepFreeze(42)).toBe(42)
    expect(deepFreeze('str')).toBe('str')
    expect(deepFreeze(null)).toBeNull()
  })
})

describe('detectCircular', () => {
  it('passes non-circular objects', () => {
    expect(() => detectCircular({ a: { b: 1 } })).not.toThrow()
  })

  it('throws on circular reference', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj['self'] = obj
    expect(() => detectCircular(obj)).toThrow()
  })
})

describe('buildSuccess', () => {
  it('builds correct success envelope', () => {
    const result = buildSuccess({ id: '1' }, 'Created')
    expect(result.success).toBe(true)
    expect(result.message).toBe('Created')
    expect(result.data).toEqual({ id: '1' })
  })

  it('is frozen', () => {
    const result = buildSuccess({ id: '1' }, 'Created')
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('applies shape mapping', () => {
    const result = buildSuccess(
      { id: '1' },
      'Created',
      { shape: { status: '{success}', result: '{data}', msg: '{message}' } }
    ) as unknown as Record<string, unknown>
    expect(result['status']).toBe(true)
    expect(result['result']).toEqual({ id: '1' })
    expect(result['msg']).toBe('Created')
    expect(result['success']).toBeUndefined()
  })

  it('uses empty string message by default pattern', () => {
    const result = buildSuccess(null, '')
    expect(result.message).toBe('')
  })
})

describe('buildPaginated', () => {
  it('builds correct paginated envelope', () => {
    const items  = [{ id: '1' }, { id: '2' }]
    const result = buildPaginated(items, 45, 2, 20, '')

    expect(result.success).toBe(true)
    expect(result.data.items).toEqual(items)
    expect(result.data.total).toBe(45)
    expect(result.data.page).toBe(2)
    expect(result.data.limit).toBe(20)
    expect(result.data.pages).toBe(3)  // Math.ceil(45/20)
  })

  it('calculates pages correctly', () => {
    const result = buildPaginated([], 100, 1, 10, '')
    expect(result.data.pages).toBe(10)
  })

  it('rounds pages up', () => {
    const result = buildPaginated([], 21, 1, 20, '')
    expect(result.data.pages).toBe(2)  // Math.ceil(21/20)
  })
})

describe('buildError', () => {
  it('builds correct error envelope', () => {
    const result = buildError('NOT_FOUND', 'User not found', null, false)
    expect(result.success).toBe(false)
    expect(result.message).toBe('User not found')
    expect(result.error.code).toBe('NOT_FOUND')
    expect(result.error.message).toBe('User not found')
    expect(result.error.details).toBeNull()
  })

  it('includes details when sanitize is false', () => {
    const details = { field: 'email', message: 'Invalid', code: 'invalid' }
    const result  = buildError('VALIDATION_ERROR', 'Validation failed', details, false)
    expect(result.error.details).toEqual(details)
  })

  it('hides non-string details when sanitize is true', () => {
    const details = { field: 'email', message: 'Invalid', code: 'invalid' }
    const result  = buildError('VALIDATION_ERROR', 'Validation failed', details, true)
    expect(result.error.details).toBeNull()
  })

  it('is frozen', () => {
    const result = buildError('CODE', 'msg', null, false)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('applies shape mapping', () => {
    const result = buildError(
      'NOT_FOUND', 'Not found', null, false,
      { shape: { status: '{success}' } }
    ) as unknown as Record<string, unknown>
    expect(result['status']).toBe(false)
  })
})


describe('deepFreeze — arrays', () => {
  it('freezes arrays', () => {
    const arr = deepFreeze([1, 2, 3])
    expect(Object.isFrozen(arr)).toBe(true)
  })

  it('freezes objects inside arrays', () => {
    const arr = deepFreeze([{ a: 1 }])
    expect(Object.isFrozen((arr as any)[0])).toBe(true)
  })
})

describe('detectCircular — additional cases', () => {
  it('passes null', () => {
    expect(() => detectCircular(null)).not.toThrow()
  })

  it('passes primitive', () => {
    expect(() => detectCircular(42 as any)).not.toThrow()
  })

  it('passes array without circular', () => {
    expect(() => detectCircular([1, 2, { a: 3 }])).not.toThrow()
  })

  it('throws on circular inside array', () => {
    const arr: unknown[] = [1]
    arr.push(arr)  // circular ref inside array
    expect(() => detectCircular(arr)).toThrow()
  })
})

describe('buildSuccess — additional cases', () => {
  it('accepts null data', () => {
    const result = buildSuccess(null, 'OK')
    expect(result.data).toBeNull()
    expect(result.success).toBe(true)
  })

  it('accepts array data', () => {
    const result = buildSuccess([1, 2, 3], 'List')
    expect(Array.isArray(result.data)).toBe(true)
    expect((result.data as any).length).toBe(3)
  })
})

describe('buildPaginated — edge cases', () => {
  it('guard against limit=0 (div-by-zero)', () => {
    const result = buildPaginated([], 0, 1, 0, '')
    expect(isFinite(result.data.pages)).toBe(true)
    expect(result.data.pages).toBe(0)
  })

  it('returns pages=0 when total=0', () => {
    const result = buildPaginated([], 0, 1, 20, '')
    expect(result.data.pages).toBe(0)
  })

  it('single page when total <= limit', () => {
    const result = buildPaginated([{}, {}], 2, 1, 10, '')
    expect(result.data.pages).toBe(1)
  })
})

describe('buildError — additional cases', () => {
  it('accepts string as details', () => {
    const result = buildError('CODE', 'msg', 'extra info', false)
    expect(result.error.details).toBe('extra info')
  })

  it('sanitize=true with string details keeps them (strings are safe)', () => {
    // strings are not objects — sanitize flag only nulls objects
    const result = buildError('CODE', 'msg', 'extra info', true)
    // In source: sanitize && typeof details !== 'string' ? null : details
    expect(result.error.details).toBe('extra info')
  })
})

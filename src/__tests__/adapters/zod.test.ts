// src/__tests__/adapters/zod.test.ts
import { describe, it, expect } from 'vitest'
import { zodAdapter, isZodSchema } from '../../adapters/zod.js'

// ── Minimal Zod-like schema for testing ───────
// We duck-type so tests don't need zod installed in this env
function makeSchema(parseResult: unknown, shouldFail = false) {
  return {
    safeParseAsync: async (data: unknown) => {
      if (shouldFail) {
        return {
          success: false as const,
          error: {
            issues: [
              { path: ['email'], message: 'Invalid email', code: 'invalid_string' }
            ]
          }
        }
      }
      return { success: true as const, data: parseResult }
    },
    parseAsync: async (data: unknown) => {
      if (shouldFail) throw new Error('Validation failed')
      return parseResult
    },
    strip() { return this },
  }
}

describe('zodAdapter', () => {
  describe('safeParse', () => {
    it('returns success with parsed data', async () => {
      const schema  = makeSchema({ email: 'alice@example.com' })
      const adapter = zodAdapter(schema)
      const result  = await adapter.safeParse({ email: 'alice@example.com' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ email: 'alice@example.com' })
      }
    })

    it('returns failure with mapped issues', async () => {
      const schema  = makeSchema(null, true)
      const adapter = zodAdapter(schema)
      const result  = await adapter.safeParse({ email: 'bad' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0]?.field).toBe('email')
        expect(result.errors[0]?.message).toBe('Invalid email')
        expect(result.errors[0]?.code).toBe('invalid_string')
      }
    })

    it('maps nested path to dot notation', async () => {
      const schema = {
        safeParseAsync: async () => ({
          success: false as const,
          error: { issues: [{ path: ['address', 'zipCode'], message: 'Required', code: 'invalid_type' }] }
        }),
        parseAsync: async () => { throw new Error() },
        strip() { return this },
      }
      const adapter = zodAdapter(schema)
      const result  = await adapter.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0]?.field).toBe('address.zipCode')
      }
    })

    it('maps empty path to root', async () => {
      const schema = {
        safeParseAsync: async () => ({
          success: false as const,
          error: { issues: [{ path: [], message: 'Required', code: 'invalid_type' }] }
        }),
        parseAsync: async () => { throw new Error() },
        strip() { return this },
      }
      const adapter = zodAdapter(schema)
      const result  = await adapter.safeParse(null)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0]?.field).toBe('root')
      }
    })
  })

  describe('parse', () => {
    it('returns parsed data on success', async () => {
      const schema  = makeSchema({ id: '1' })
      const adapter = zodAdapter(schema)
      const result  = await adapter.parse({ id: '1' })
      expect(result).toEqual({ id: '1' })
    })

    it('throws on failure', async () => {
      const schema  = makeSchema(null, true)
      const adapter = zodAdapter(schema)
      await expect(adapter.parse({})).rejects.toThrow()
    })
  })

  describe('strip', () => {
    it('returns data after strip', async () => {
      const schema  = makeSchema({ id: '1', email: 'a@b.com' })
      const adapter = zodAdapter(schema)
      const result  = await adapter.strip({ id: '1', email: 'a@b.com', password: 'secret' })
      expect(result).toEqual({ id: '1', email: 'a@b.com' })
    })
  })

  describe('library property', () => {
    it('identifies as zod', () => {
      const schema  = makeSchema({})
      const adapter = zodAdapter(schema)
      expect(adapter.library).toBe('zod')
    })
  })
})

describe('isZodSchema', () => {
  it('returns true for zod-like schema', () => {
    const schema = makeSchema({})
    expect(isZodSchema(schema)).toBe(true)
  })

  it('returns false for plain object', () => {
    expect(isZodSchema({ validate: () => {} })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isZodSchema(null)).toBe(false)
  })

  it('returns false for string', () => {
    expect(isZodSchema('schema')).toBe(false)
  })
})


describe('zodAdapter — additional edge cases', () => {
  describe('strip fallback', () => {
    it('returns original data when strip fails', async () => {
      const failingSchema = {
        safeParseAsync: async () => ({ success: true as const, data: {} }),
        parseAsync: async () => ({}),
        strip() {
          return {
            ...this,
            safeParseAsync: async () => ({
              success: false as const,
              error: { issues: [{ path: [], message: 'strip fail', code: 'custom' }] },
            }),
          }
        },
      }
      const adapter = zodAdapter(failingSchema)
      const original = { id: '1', secret: 'keep-me' }
      const result = await adapter.strip(original)
      // strip failed → original data returned unchanged
      expect(result).toEqual(original)
    })
  })

  describe('multiple issues', () => {
    it('maps all issues in safeParse failure', async () => {
      const schema = {
        safeParseAsync: async () => ({
          success: false as const,
          error: {
            issues: [
              { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
              { path: ['name'],  message: 'Too short',     code: 'too_small'      },
              { path: ['age'],   message: 'Must be number',code: 'invalid_type'   },
            ],
          },
        }),
        parseAsync: async () => { throw new Error() },
        strip() { return this },
      }
      const adapter = zodAdapter(schema)
      const result = await adapter.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.length).toBe(3)
        expect(result.errors[1]?.field).toBe('name')
        expect(result.errors[2]?.field).toBe('age')
      }
    })
  })

  describe('numeric path segments', () => {
    it('converts numeric index to dot notation: items.0.name', async () => {
      const schema = {
        safeParseAsync: async () => ({
          success: false as const,
          error: { issues: [{ path: ['items', 0, 'name'], message: 'Required', code: 'invalid_type' }] },
        }),
        parseAsync: async () => { throw new Error() },
        strip() { return this },
      }
      const adapter = zodAdapter(schema)
      const result = await adapter.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0]?.field).toBe('items.0.name')
      }
    })
  })
})

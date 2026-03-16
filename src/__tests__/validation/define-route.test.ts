// src/__tests__/validation/define-route.test.ts
import { describe, it, expect } from 'vitest'
import { defineRoute } from '../../validation/define-route.js'

// Minimal Zod-like schema for testing
function makeZodLike(output: unknown = {}) {
  return {
    safeParseAsync: async () => ({ success: true as const, data: output }),
    parseAsync:     async () => output,
    strip() { return this },
  }
}

// Explicit SchemaAdapter (already wrapped)
function makeAdapter(output: unknown = {}) {
  return {
    library:     'zod' as const,
    safeParse:   async () => ({ success: true as const, data: output }),
    parse:       async () => output,
    strip:       async () => output,
  }
}

describe('defineRoute', () => {
  it('returns empty RouteSchema when no inputs provided', () => {
    const route = defineRoute({})
    expect(route.body).toBeUndefined()
    expect(route.params).toBeUndefined()
    expect(route.query).toBeUndefined()
    expect(route.headers).toBeUndefined()
    expect(route.response).toBeUndefined()
  })

  it('auto-wraps zod-like schemas into adapters', () => {
    const schema = makeZodLike({ email: 'a@b.com' })
    const route  = defineRoute({ body: schema })

    expect(route.body).toBeDefined()
    expect(typeof route.body?.safeParse).toBe('function')
    expect(route.body?.library).toBe('zod')
  })

  it('passes SchemaAdapters through unchanged', () => {
    const adapter = makeAdapter({ id: '1' })
    const route   = defineRoute({ body: adapter })

    // same reference — not re-wrapped
    expect(route.body).toBe(adapter)
  })

  it('wraps all five fields independently', () => {
    const route = defineRoute({
      body:     makeZodLike(),
      params:   makeZodLike(),
      query:    makeZodLike(),
      headers:  makeZodLike(),
      response: makeZodLike(),
    })

    expect(route.body).toBeDefined()
    expect(route.params).toBeDefined()
    expect(route.query).toBeDefined()
    expect(route.headers).toBeDefined()
    expect(route.response).toBeDefined()
  })

  it('only includes fields that were provided', () => {
    const route = defineRoute({ body: makeZodLike() })
    expect(route.body).toBeDefined()
    expect(route.params).toBeUndefined()
    expect(route.query).toBeUndefined()
  })

  it('resulting adapter can safeParse successfully', async () => {
    const schema = makeZodLike({ email: 'a@b.com' })
    const route  = defineRoute({ body: schema })
    const result = await route.body!.safeParse({ email: 'a@b.com' })
    expect(result.success).toBe(true)
  })
})

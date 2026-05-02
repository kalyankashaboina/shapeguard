// src/__tests__/core/request-id.test.ts
import { describe, it, expect } from 'vitest'
import { generateRequestId } from '../../core/request-id.js'

describe('generateRequestId', () => {
  it('returns a string', () => {
    expect(typeof generateRequestId()).toBe('string')
  })

  it('starts with req_ prefix', () => {
    expect(generateRequestId()).toMatch(/^req_/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateRequestId()))
    expect(ids.size).toBe(1000)
  })

  it('is time-ordered — later ID lexicographically greater', async () => {
    const id1 = generateRequestId()
    // small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 5))
    const id2 = generateRequestId()
    // strip prefix for comparison
    const ts1 = id1.slice(4, 16)  // timestamp portion
    const ts2 = id2.slice(4, 16)
    expect(ts2 >= ts1).toBe(true)
  })

  it('has consistent length', () => {
    const ids = Array.from({ length: 100 }, () => generateRequestId())
    const lengths = new Set(ids.map(id => id.length))
    expect(lengths.size).toBe(1)  // all same length
  })
})

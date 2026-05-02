// src/__tests__/errors/not-found.test.ts
import { describe, it, expect, vi } from 'vitest'
import { notFoundHandler, asyncHandler } from '../../errors/not-found.js'
import { AppError, isAppError } from '../../errors/AppError.js'
import { ErrorCode } from '../../types/index.js'
import type { Request, Response, NextFunction } from 'express'

function makeReq(method = 'GET', path = '/api/unknown'): Request {
  return { method, path } as unknown as Request
}

describe('notFoundHandler', () => {
  it('calls next with AppError NOT_FOUND', () => {
    const next    = vi.fn()
    const handler = notFoundHandler()
    handler(makeReq(), {} as Response, next as NextFunction)

    expect(next).toHaveBeenCalledOnce()
    const err = next.mock.calls[0]?.[0]
    expect(isAppError(err)).toBe(true)
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe(ErrorCode.NOT_FOUND)
  })

  it('includes method and path in default message', () => {
    const next    = vi.fn()
    const handler = notFoundHandler()
    handler(makeReq('POST', '/api/orders'), {} as Response, next as NextFunction)

    const err = next.mock.calls[0]?.[0]
    expect(err.message).toContain('POST')
    expect(err.message).toContain('/api/orders')
  })

  it('uses custom message when provided', () => {
    const next    = vi.fn()
    const handler = notFoundHandler({ message: 'Route not found' })
    handler(makeReq(), {} as Response, next as NextFunction)

    const err = next.mock.calls[0]?.[0]
    expect(err.message).toBe('Route not found')
  })
})

describe('asyncHandler', () => {
  const makeRes = () => ({} as Response)

  it('calls the handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    const wrapped = asyncHandler(handler)
    const next    = vi.fn()

    wrapped(makeReq(), makeRes(), next as NextFunction)
    await new Promise(r => setTimeout(r, 0))

    expect(handler).toHaveBeenCalled()
  })

  it('calls next with error when handler rejects', async () => {
    const err     = new Error('async boom')
    const handler = vi.fn().mockRejectedValue(err)
    const wrapped = asyncHandler(handler)
    const next    = vi.fn()

    wrapped(makeReq(), makeRes(), next as NextFunction)
    await new Promise(r => setTimeout(r, 0))

    expect(next).toHaveBeenCalledWith(err)
  })

  it('calls next with AppError when handler throws AppError', async () => {
    const appErr  = AppError.notFound('User')
    const handler = vi.fn().mockRejectedValue(appErr)
    const wrapped = asyncHandler(handler)
    const next    = vi.fn()

    wrapped(makeReq(), makeRes(), next as NextFunction)
    await new Promise(r => setTimeout(r, 0))

    const received = next.mock.calls[0]?.[0]
    expect(isAppError(received)).toBe(true)
  })

  it('does not swallow successful responses', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    const wrapped = asyncHandler(handler)
    const next    = vi.fn()

    wrapped(makeReq(), makeRes(), next as NextFunction)
    await new Promise(r => setTimeout(r, 0))

    expect(next).not.toHaveBeenCalled()
  })
})

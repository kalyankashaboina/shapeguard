// src/__tests__/logging/request-log.test.ts
import { describe, it, expect, vi } from 'vitest'
import { requestLogger } from '../../logging/request-log.js'
import { createLogger } from '../../logging/logger.js'
import { winstonAdapter } from '../../adapters/winston.js'
import { withShape } from '../../router/with-shape.js'
import { shapeguard } from '../../shapeguard.js'
import type { Logger } from '../../types/index.js'
import type { Request, Response, NextFunction } from 'express'

function makeLogger() {
  const calls: Record<string, unknown[][]> = { debug: [], info: [], warn: [], error: [] }
  const logger: Logger & { calls: typeof calls } = {
    calls,
    debug: (o, m) => { calls['debug']!.push([o, m]) },
    info:  (o, m) => { calls['info']!.push([o, m]) },
    warn:  (o, m) => { calls['warn']!.push([o, m]) },
    error: (o, m) => { calls['error']!.push([o, m]) },
  }
  return logger
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req_test', method: 'GET', path: '/test',
    originalUrl: '/test', route: null, body: {}, headers: {},
    ...overrides,
  } as any
}

function makeRes(status = 200) {
  // Use a Map so each event name holds one one-time listener.
  // Mirrors Node.js EventEmitter.once() — fires once then removes itself.
  const onceListeners = new Map<string, () => void>()
  const res: any = {
    statusCode: status,
    headersSent: false,
    once: (event: string, fn: () => void) => { onceListeners.set(event, fn) },
    _emit: (event = 'finish') => {
      const fn = onceListeners.get(event)
      if (fn) { onceListeners.delete(event); fn() }
    },
  }
  // json returns self — capture body for logResponseBody tests
  let _body: unknown = undefined
  res.json = (b: unknown) => { _body = b; return res }
  res._getBody = () => _body
  return res
}

describe('requestLogger', () => {
  describe('incoming request debug log', () => {
    it('logs debug on incoming when logAllRequests:true', () => {
      const l = makeLogger()
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(makeReq(), makeRes(), vi.fn())
      expect(l.calls['debug']!.length).toBeGreaterThanOrEqual(1)
      expect((l.calls['debug']![0]![0] as any).requestId).toBe('req_test')
    })

    it('does not log debug incoming when logAllRequests:false', () => {
      const l = makeLogger()
      requestLogger(l, { logAllRequests: false, slowThreshold: 0 })(makeReq(), makeRes(), vi.fn())
      expect(l.calls['debug']!.length).toBe(0)
    })
  })

  describe('finish event logging', () => {
    it('logs info for 2xx when logAllRequests:true', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      expect(l.calls['info']!.length).toBe(1)
      const payload = l.calls['info']![0]![0] as any
      expect(payload.status).toBe(200)
      expect(payload.method).toBe('GET')
      expect(payload.requestId).toBe('req_test')
      expect(typeof payload.duration_ms).toBe('number')
    })

    it('suppresses 2xx when logAllRequests:false', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: false, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      expect(l.calls['info']!.length).toBe(0)
      expect(l.calls['warn']!.length).toBe(0)
    })

    it('logs 4xx as warn even when logAllRequests:false', () => {
      const l = makeLogger()
      const res = makeRes(404)
      requestLogger(l, { logAllRequests: false, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      expect(l.calls['warn']!.length).toBe(1)
    })

    it('logs 5xx as error', () => {
      const l = makeLogger()
      const res = makeRes(500)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      expect(l.calls['error']!.length).toBe(1)
    })

    it('res.once prevents double-fire on second finish event', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      res._emit()
      expect(l.calls['info']!.length).toBe(1)
    })
  })

  describe('slow threshold', () => {
    it('slowThreshold:0 disables slow detection entirely', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      const allWarn = l.calls['warn']!
      expect(allWarn.every(c => !(c[0] as any).slow)).toBe(true)
    })

    it('slowThreshold:1 flags every request as slow (for testing)', async () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: false, slowThreshold: 1 })(makeReq(), res, vi.fn())
      // wait 5ms to exceed threshold
      await new Promise(r => setTimeout(r, 5))
      res._emit()
      // Should have warn with slow:true
      expect(l.calls['warn']!.length).toBeGreaterThanOrEqual(1)
      const slowCall = l.calls['warn']!.find(c => (c[0] as any).slow === true)
      expect(slowCall).toBeDefined()
    })
  })

  describe('request body logging', () => {
    it('includes redacted reqBody when logRequestBody:true', () => {
      const l = makeLogger()
      const res = makeRes(200)
      const req = makeReq({ body: { email: 'a@b.com', password: 'secret', name: 'Alice' } })
      requestLogger(l, { logAllRequests: true, logRequestBody: true, slowThreshold: 0 })(req, res, vi.fn())
      res._emit()
      const payload = l.calls['info']![0]![0] as any
      expect(payload.reqBody).toBeDefined()
      expect(payload.reqBody.email).toBe('a@b.com')
      expect(payload.reqBody.name).toBe('Alice')
      expect(payload.reqBody.password).toBe('[REDACTED]')
    })

    it('always redacts token and secret fields', () => {
      const l = makeLogger()
      const res = makeRes(200)
      const req = makeReq({ body: { accessToken: 'tok', refreshToken: 'ref', secret: 's' } })
      requestLogger(l, { logAllRequests: true, logRequestBody: true, slowThreshold: 0 })(req, res, vi.fn())
      res._emit()
      const body = (l.calls['info']![0]![0] as any).reqBody
      expect(body.accessToken).toBe('[REDACTED]')
      expect(body.refreshToken).toBe('[REDACTED]')
      expect(body.secret).toBe('[REDACTED]')
    })

    it('redacts nested sensitive fields', () => {
      const l = makeLogger()
      const res = makeRes(200)
      const req = makeReq({ body: { user: { password: 'secret', name: 'Alice' } } })
      requestLogger(l, { logAllRequests: true, logRequestBody: true, slowThreshold: 0 })(req, res, vi.fn())
      res._emit()
      const body = (l.calls['info']![0]![0] as any).reqBody
      expect(body.user.password).toBe('[REDACTED]')
      expect(body.user.name).toBe('Alice')
    })

    it('redacts custom keys from redact config', () => {
      const l = makeLogger()
      const res = makeRes(200)
      const req = makeReq({ body: { name: 'Alice', ssn: '123-45-6789', cardNumber: '4242' } })
      requestLogger(l, {
        logAllRequests: true, logRequestBody: true, slowThreshold: 0,
        redact: ['req.body.ssn', 'req.body.cardNumber'],
      })(req, res, vi.fn())
      res._emit()
      const body = (l.calls['info']![0]![0] as any).reqBody
      expect(body.name).toBe('Alice')
      expect(body.ssn).toBe('[REDACTED]')
      expect(body.cardNumber).toBe('[REDACTED]')
    })

    it('does NOT include body when logRequestBody:false (default)', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(
        makeReq({ body: { password: 'secret' } }), res, vi.fn()
      )
      res._emit()
      expect((l.calls['info']![0]![0] as any).reqBody).toBeUndefined()
    })

    it('handles array body without crashing', () => {
      const l = makeLogger()
      const res = makeRes(200)
      const req = makeReq({ body: [{ id: 1 }, { id: 2 }] })
      requestLogger(l, { logAllRequests: true, logRequestBody: true, slowThreshold: 0 })(req, res, vi.fn())
      res._emit()
      const payload = l.calls['info']![0]![0] as any
      expect(Array.isArray(payload.reqBody)).toBe(true)
    })

    it('handles undefined body gracefully', () => {
      const l = makeLogger()
      const res = makeRes(200)
      const req = makeReq({ body: undefined })
      requestLogger(l, { logAllRequests: true, logRequestBody: true, slowThreshold: 0 })(req, res, vi.fn())
      res._emit()
      expect((l.calls['info']![0]![0] as any).reqBody).toBeUndefined()
    })
  })

  describe('response body logging', () => {
    it('does NOT include resBody when logResponseBody:false (default)', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      expect((l.calls['info']![0]![0] as any).resBody).toBeUndefined()
    })

    it('captures resBody and redacts sensitive fields', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: true, logResponseBody: true, slowThreshold: 0 })(makeReq(), res, vi.fn())
      // simulate res.json() being called (sends response)
      res.json({ success: true, data: { id: '1', token: 'secret-token' }, message: '' })
      res._emit()
      const payload = l.calls['info']![0]![0] as any
      expect(payload.resBody).toBeDefined()
      expect(payload.resBody.data.token).toBe('[REDACTED]')
      expect(payload.resBody.data.id).toBe('1')
    })
  })

  describe('payload fields', () => {
    it('always includes requestId, method, endpoint, status, duration_ms', () => {
      const l = makeLogger()
      const res = makeRes(201)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(
        makeReq({ method: 'POST', path: '/api/users' }), res, vi.fn()
      )
      res._emit()
      const payload = l.calls['info']![0]![0] as any
      expect(payload.requestId).toBe('req_test')
      expect(payload.method).toBe('POST')
      expect(payload.status).toBe(201)
      expect(typeof payload.duration_ms).toBe('number')
      expect(payload.endpoint).toBeDefined()
    })
  })

  describe('logging when logAllRequests:false', () => {
    it('still logs 5xx as error even when logAllRequests:false', () => {
      const l = makeLogger()
      const res = makeRes(500)
      requestLogger(l, { logAllRequests: false, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      expect(l.calls['error']!.length).toBe(1)
    })

    it('still logs 4xx as warn even when logAllRequests:false', () => {
      const l = makeLogger()
      const res = makeRes(401)
      requestLogger(l, { logAllRequests: false, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      expect(l.calls['warn']!.length).toBe(1)
    })
  })

  describe('endpoint resolution', () => {
    it('uses route.path when available', () => {
      const l = makeLogger()
      const res = makeRes(200)
      const req = makeReq({ path: '/api/users/123', route: { path: '/api/users/:id' }, baseUrl: '' })
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(req, res, vi.fn())
      res._emit()
      const payload = l.calls['info']![0]![0] as any
      expect(payload.endpoint).toBeDefined()
    })

    it('finish payload always includes endpoint, not path', () => {
      const l = makeLogger()
      const res = makeRes(200)
      requestLogger(l, { logAllRequests: true, slowThreshold: 0 })(makeReq(), res, vi.fn())
      res._emit()
      const payload = l.calls['info']![0]![0] as any
      expect(payload.endpoint).toBeDefined()
      expect(payload.requestId).toBe('req_test')
      expect(payload.status).toBe(200)
      expect(payload.method).toBe('GET')
      expect(typeof payload.duration_ms).toBe('number')
    })
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 11: Logger instance missing methods — validated at mount time
// ─────────────────────────────────────────────────────────────────────────────
describe('createLogger — instance validation (Bug 11)', () => {
  it('accepts a valid instance with all four methods', () => {
    const instance: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }
    expect(() => createLogger({ instance })).not.toThrow()
  })

  it('throws a clear error when debug() is missing', () => {
    const bad = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    expect(() => createLogger({ instance: bad as unknown as Logger }))
      .toThrow('[shapeguard] logger.instance is missing required method(s): debug')
  })

  it('throws listing ALL missing methods', () => {
    const bad = { info: vi.fn() }
    expect(() => createLogger({ instance: bad as unknown as Logger }))
      .toThrow('debug, warn, error')
  })

  it('mentions the winston adapter in the error message', () => {
    const bad = { info: vi.fn() }
    expect(() => createLogger({ instance: bad as unknown as Logger }))
      .toThrow('shapeguard/adapters/winston')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 12: withShape warns in dev when token resolves to undefined
// ─────────────────────────────────────────────────────────────────────────────
describe('withShape — undefined token warning (Bug 12)', () => {
  function makeReq(): Request {
    return {} as unknown as Request
  }

  function makeRes(body: unknown) {
    let captured: unknown
    const res = {
      headersSent: false,
      json(b: unknown) { captured = b; return this },
      get captured() { return captured },
    }
    return res as unknown as Response & { captured: unknown }
  }

  it('warns when a token path does not exist in response', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mw   = withShape({ missing: '{data.notHere}' })
    const res  = makeRes({ success: true, data: { ok: true } })

    mw(makeReq(), res, vi.fn() as unknown as NextFunction)
    ;(res as any).json({ success: true, data: { ok: true } })

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('withShape'),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('missing'),
    )
    warn.mockRestore()
  })

  it('does not warn when token resolves successfully', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mw   = withShape({ ok: '{data.ok}' })
    const res  = makeRes(null)

    mw(makeReq(), res, vi.fn() as unknown as NextFunction)
    ;(res as any).json({ success: true, data: { ok: true } })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 13: Two shapeguard() instances do not share config
// ─────────────────────────────────────────────────────────────────────────────
describe('shapeguard() — two instances do not share config (Bug 13)', () => {
  function makeReqRes(validationConfig: Record<string, unknown>) {
    const req = {
      headers: {}, method: 'GET', path: '/', id: 'x',
    } as unknown as Request
    const locals: Record<string, unknown> = {}
    const res = {
      locals,
      headersSent: false,
      setHeader: vi.fn(),
      json: vi.fn(),
      once: vi.fn(),
    } as unknown as Response
    return { req, res }
  }

  it('each instance writes its own validationConfig to res.locals', () => {
    const mw1 = shapeguard({ validation: { strings: { trim: true } }, logger: { silent: true } })
    const mw2 = shapeguard({ validation: { strings: { lowercase: true } }, logger: { silent: true } })

    const { req: req1, res: res1 } = makeReqRes({})
    const { req: req2, res: res2 } = makeReqRes({})
    const next = vi.fn()

    mw1(req1, res1, next)
    mw2(req2, res2, next)

    const cfg1 = (res1.locals as any)['__sg_validation_config__']
    const cfg2 = (res2.locals as any)['__sg_validation_config__']

    expect(cfg1?.strings?.trim).toBe(true)
    expect(cfg1?.strings?.lowercase).toBeUndefined()
    expect(cfg2?.strings?.lowercase).toBe(true)
    expect(cfg2?.strings?.trim).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 14: Winston adapter
// ─────────────────────────────────────────────────────────────────────────────
describe('winstonAdapter (Bug 14)', () => {
  function makeWinston() {
    return {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }
  }

  it('returns a Logger-shaped object', () => {
    const w      = makeWinston()
    const logger = winstonAdapter(w)
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  it('flips argument order: shapeguard calls (obj, msg), winston receives (msg, obj)', () => {
    const w      = makeWinston()
    const logger = winstonAdapter(w)
    const meta   = { requestId: 'abc', status: 200 }
    const msg    = 'request completed'

    logger.info(meta, msg)

    expect(w.info).toHaveBeenCalledWith(msg, meta)
  })

  it('passes empty string when msg is undefined', () => {
    const w      = makeWinston()
    const logger = winstonAdapter(w)
    logger.warn({ code: 'TEST' })
    expect(w.warn).toHaveBeenCalledWith('', { code: 'TEST' })
  })

  it('wraps all four levels correctly', () => {
    const w      = makeWinston()
    const logger = winstonAdapter(w)
    logger.debug({ a: 1 }, 'dbg')
    logger.info ({ b: 2 }, 'inf')
    logger.warn ({ c: 3 }, 'wrn')
    logger.error({ d: 4 }, 'err')
    expect(w.debug).toHaveBeenCalledWith('dbg', { a: 1 })
    expect(w.info ).toHaveBeenCalledWith('inf', { b: 2 })
    expect(w.warn ).toHaveBeenCalledWith('wrn', { c: 3 })
    expect(w.error).toHaveBeenCalledWith('err', { d: 4 })
  })

  it('throws a clear error when passed an invalid logger', () => {
    const bad = { info: vi.fn() }
    expect(() => winstonAdapter(bad as any))
      .toThrow('[shapeguard] winstonAdapter')
  })

  it('is accepted by createLogger({ instance }) without throwing', () => {
    const w      = makeWinston()
    const logger = winstonAdapter(w)
    expect(() => createLogger({ instance: logger })).not.toThrow()
  })
})
// ─────────────────────────────────────────────────────────────────────────────
// v0.6.0 logger features — logIncoming, shortRequestId, logClientIp, lineColor
// ─────────────────────────────────────────────────────────────────────────────

function makeFullReq(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req_019cfa6f23691913c86c63a3045a',
    method: 'GET',
    path: '/users',
    originalUrl: '/users',
    route: { path: '/users' },
    baseUrl: '',
    body: {},
    headers: {},
    ip: '192.168.1.100',
    socket: { remoteAddress: '192.168.1.100' },
    ...overrides,
  } as any
}

function makeSimpleRes(statusCode = 200) {
  const handlers: Record<string, Function> = {}
  return {
    statusCode,
    once(event: string, fn: Function) { handlers[event] = fn },
    json: (b: unknown) => b,
    _emit() { handlers['finish']?.() },
  } as any
}

describe('logIncoming: false — hides >> arrival lines (v0.6.0)', () => {
  it('suppresses incoming debug log when logIncoming is false', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, logIncoming: false })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    expect(l.calls['debug']).toHaveLength(0)
  })

  it('still logs response << line when logIncoming is false', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, logIncoming: false, slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    expect(l.calls['info']).toHaveLength(1)
  })

  it('shows incoming lines by default (logIncoming not set)', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    expect(l.calls['debug']).toHaveLength(1)
  })
})

describe('shortRequestId: true — last 8 chars only (v0.6.0)', () => {
  it('shows only last 8 chars of request ID in incoming line', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, shortRequestId: true })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    const msg = l.calls['debug']![0]![1] as string
    // last 8 chars of 'req_019cfa6f23691913c86c63a3045a'
    expect(msg).toContain('3045a')
    expect(msg).not.toContain('req_019cfa6f23691913c86c63a3045a')
  })

  it('shows only last 8 chars in response line', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, shortRequestId: true, slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    const msg = l.calls['info']![0]![1] as string
    expect(msg).toContain('3045a')
    expect(msg).not.toContain('req_019cfa6f23691913c86c63a3045a')
  })

  it('shows full ID when shortRequestId is false (default)', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    const msg = l.calls['debug']![0]![1] as string
    expect(msg).toContain('req_019cfa6f23691913c86c63a3045a')
  })
})

describe('logClientIp: true — logs IP on response lines (v0.6.0)', () => {
  it('includes IP in response payload when logClientIp is true', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, logClientIp: true, slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    const payload = l.calls['info']![0]![0] as any
    expect(payload.ip).toBe('192.168.1.100')
  })

  it('includes IP in response message string', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, logClientIp: true, slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    const msg = l.calls['info']![0]![1] as string
    expect(msg).toContain('192.168.1.100')
  })

  it('reads x-forwarded-for first when present', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, logClientIp: true, slowThreshold: 0 })
    const req = makeFullReq({ headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } })
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    const payload = l.calls['info']![0]![0] as any
    expect(payload.ip).toBe('10.0.0.1')
  })

  it('does not include IP when logClientIp is false (default)', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    const payload = l.calls['info']![0]![0] as any
    expect(payload.ip).toBeUndefined()
  })
})

describe("lineColor: 'level' — whole line coloured by status (v0.6.0)", () => {
  it("lineColor:'level' still produces a response log line", () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, lineColor: 'level', slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    expect(l.calls['info']).toHaveLength(1)
  })

  it("lineColor:'level' response line contains method and status", () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, lineColor: 'level', slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(201)
    mw(req, res, vi.fn())
    res._emit()
    const msg = l.calls['info']![0]![1] as string
    expect(msg).toContain('GET')
    expect(msg).toContain('201')
  })

  it("lineColor:'method' (default) works unchanged", () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, { logAllRequests: true, lineColor: 'method', slowThreshold: 0 })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    expect(l.calls['info']).toHaveLength(1)
  })

  it('all 4 new options can be combined together', () => {
    const l   = makeLogger()
    const mw  = requestLogger(l, {
      logAllRequests:  true,
      logIncoming:     false,   // hide >> lines
      shortRequestId:  true,    // last 8 chars
      logClientIp:     true,    // show IP
      lineColor:       'level', // colour by status
      slowThreshold:   0,
    })
    const req = makeFullReq()
    const res = makeRes(200)
    mw(req, res, vi.fn())
    res._emit()
    // no incoming line
    expect(l.calls['debug']).toHaveLength(0)
    // response line present with IP and short ID
    expect(l.calls['info']).toHaveLength(1)
    const msg     = l.calls['info']![0]![1] as string
    const payload = l.calls['info']![0]![0] as any
    expect(msg).toContain('3045a')
    expect(msg).toContain('192.168.1.100')
    expect(payload.ip).toBe('192.168.1.100')
  })
})

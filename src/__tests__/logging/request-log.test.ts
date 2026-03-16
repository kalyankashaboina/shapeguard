// src/__tests__/logging/request-log.test.ts
import { describe, it, expect, vi } from 'vitest'
import { requestLogger } from '../../logging/request-log.js'
import type { Logger } from '../../types/index.js'

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
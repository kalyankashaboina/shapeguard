// ═══════════════════════════════════════════════════════════════════════════
// v0.8.0-features.test.ts — shapeguard
// Tests for every feature added in v0.7.0 and v0.8.0:
//   - generateOpenAPI: security, deprecated, bodyType, extensions, responseHeaders
//   - createDocs: basic rendering, CSP header, security headers, theme
//   - res.cursorPaginated
//   - verifyWebhook: stripe, github, shopify, custom, replay protection
//   - AppError.define: typed factory
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import { createHmac } from 'crypto'
import { z } from 'zod'

import { shapeguard }                     from '../shapeguard.js'
import { errorHandler }                   from '../errors/error-handler.js'
import { AppError }                       from '../errors/AppError.js'
import { defineRoute }                    from '../validation/define-route.js'
import { handle }                         from '../validation/handle.js'
import { zodAdapter }                     from '../adapters/zod.js'
import { generateOpenAPI, createDocs }    from '../openapi/index.js'
import { verifyWebhook }                  from '../security/webhook.js'
import type { Request, Response }         from 'express'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use(shapeguard({ logger: { silent: true } }))
  return app
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return { id: 'req_test', method: 'GET', path: '/test', route: { path: '/test' }, ...overrides } as unknown as Request
}

function makeRes(): Response & { statusCode: number; body: unknown } {
  let statusCode = 200
  let body: unknown = null
  return {
    headersSent: false, locals: {},
    status(c: number) { statusCode = c; return this },
    json(b: unknown) { body = b; return this },
    get statusCode() { return statusCode },
    get body() { return body },
    setHeader: vi.fn(), send: vi.fn(),
  } as unknown as Response & { statusCode: number; body: unknown }
}

// ═══════════════════════════════════════════════════════════════════════════
// generateOpenAPI — security schemes (v0.7.0)
// ═══════════════════════════════════════════════════════════════════════════

describe('generateOpenAPI — security schemes (v0.7.0)', () => {
  it('adds securitySchemes to components when security is configured', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      security: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      defaultSecurity: ['bearer'],
      routes: { 'GET /users': defineRoute({}) },
    })
    expect(spec.components?.securitySchemes?.['bearer']).toBeDefined()
    expect((spec.components?.securitySchemes?.['bearer'] as any).type).toBe('http')
  })

  it('applies defaultSecurity to operations as security requirement array', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      security: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      defaultSecurity: ['bearer'],
      routes: { 'GET /users': defineRoute({}) },
    })
    const op = spec.paths['/users']!['get']!
    expect(op.security).toEqual([{ bearer: [] }])
  })

  it('generates 401 and 403 responses for secured operations', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      security: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      defaultSecurity: ['bearer'],
      routes: { 'GET /users': defineRoute({}) },
    })
    const op = spec.paths['/users']!['get']!
    expect(op.responses['401']).toBeDefined()
    expect(op.responses['403']).toBeDefined()
  })

  it('marks explicit public routes with security: []', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      security: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      defaultSecurity: ['bearer'],
      routes: {
        'GET /public': { ...defineRoute({}), security: [] },
      },
    })
    const op = spec.paths['/public']!['get']!
    expect(op.security).toEqual([])
    expect(op.responses['401']).toBeUndefined()
    expect(op.responses['403']).toBeUndefined()
  })

  it('supports per-route security override', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      security: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      defaultSecurity: ['bearer'],
      routes: {
        'POST /webhook': { ...defineRoute({}), security: ['apiKey'] },
      },
    })
    const op = spec.paths['/webhook']!['post']!
    expect(op.security).toEqual([{ apiKey: [] }])
  })

  it('generates 400 response on all operations', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      routes: { 'GET /ping': defineRoute({}) },
    })
    expect(spec.paths['/ping']!['get']!.responses['400']).toBeDefined()
  })

  it('generates 429 response only for rate-limited routes', () => {
    const route = defineRoute({ rateLimit: { windowMs: 60000, max: 10 } })
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      routes: {
        'GET /limited': route,
        'GET /unlimited': defineRoute({}),
      },
    })
    expect(spec.paths['/limited']!['get']!.responses['429']).toBeDefined()
    expect(spec.paths['/unlimited']!['get']!.responses['429']).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// generateOpenAPI — new v0.8.0 per-route options
// ═══════════════════════════════════════════════════════════════════════════

describe('generateOpenAPI — v0.8.0 per-route options', () => {
  it('sets deprecated: true on operation when route has deprecated flag', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      routes: { 'GET /old': { ...defineRoute({}), deprecated: true } },
    })
    expect(spec.paths['/old']!['get']!.deprecated).toBe(true)
  })

  it('does not set deprecated when route does not have it', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      routes: { 'GET /new': defineRoute({}) },
    })
    expect(spec.paths['/new']!['get']!.deprecated).toBeUndefined()
  })

  it('sets description separately from summary', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      routes: {
        'GET /users': {
          ...defineRoute({}),
          summary: 'List users',
          description: 'Returns all users matching the filter criteria.',
        },
      },
    })
    const op = spec.paths['/users']!['get']!
    expect(op.summary).toBe('List users')
    expect(op.description).toBe('Returns all users matching the filter criteria.')
  })

  it('sets externalDocs on operation', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      routes: {
        'GET /users': {
          ...defineRoute({}),
          externalDocs: { url: 'https://docs.example.com/users', description: 'Full docs' },
        },
      },
    })
    expect(spec.paths['/users']!['get']!.externalDocs).toEqual({
      url: 'https://docs.example.com/users',
      description: 'Full docs',
    })
  })

  it('merges x-* extensions onto operation', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      routes: {
        'GET /users': {
          ...defineRoute({}),
          extensions: { 'x-rate-limit-tier': 'premium', 'internal-only': true },
        },
      },
    })
    const op = spec.paths['/users']!['get']!
    expect(op['x-rate-limit-tier']).toBe('premium')
    expect(op['x-internal-only']).toBe(true) // auto-prefixed with x-
  })

  it('generates multipart/form-data requestBody for bodyType: multipart', () => {
    const schema = zodAdapter(z.object({ name: z.string(), file: z.string() }))
    const route = { ...defineRoute({ body: schema }), bodyType: 'multipart' as const }
    const spec = generateOpenAPI({ title: 'T', version: '1', routes: { 'POST /upload': route } })
    const body = spec.paths['/upload']!['post']!.requestBody!
    expect(body.content['multipart/form-data']).toBeDefined()
    const props = (body.content['multipart/form-data']!.schema as any).properties
    expect(props.file.format).toBe('binary') // file field auto-detected
    expect(props.name.type).toBe('string')
  })

  it('generates form-urlencoded requestBody for bodyType: form', () => {
    const schema = zodAdapter(z.object({ username: z.string() }))
    const route = { ...defineRoute({ body: schema }), bodyType: 'form' as const }
    const spec = generateOpenAPI({ title: 'T', version: '1', routes: { 'POST /login': route } })
    const body = spec.paths['/login']!['post']!.requestBody!
    expect(body.content['application/x-www-form-urlencoded']).toBeDefined()
  })

  it('includes responseHeaders in 200 response', () => {
    const route = {
      ...defineRoute({}),
      responseHeaders: {
        'X-Request-Id': { description: 'Unique request ID', schema: { type: 'string' } },
        'Retry-After':  { description: 'Seconds until retry', schema: { type: 'number' } },
      },
    }
    const spec = generateOpenAPI({ title: 'T', version: '1', routes: { 'GET /data': route } })
    const resp = spec.paths['/data']!['get']!.responses['200']!
    expect((resp as any).headers?.['X-Request-Id']).toBeDefined()
    expect((resp as any).headers?.['Retry-After']).toBeDefined()
  })

  it('includes top-level tags from config', () => {
    const spec = generateOpenAPI({
      title: 'T', version: '1',
      tags: [{ name: 'Users', description: 'User management' }],
      routes: {},
    })
    expect(spec.tags?.[0]?.name).toBe('Users')
  })

  it('includes termsOfService, contact, license in info', () => {
    const spec = generateOpenAPI({
      title: 'My API', version: '1.0.0',
      termsOfService: 'https://example.com/terms',
      contact: { name: 'API Team', email: 'api@example.com' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      routes: {},
    })
    expect(spec.info.termsOfService).toBe('https://example.com/terms')
    expect(spec.info.contact?.email).toBe('api@example.com')
    expect(spec.info.license?.name).toBe('MIT')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// generateOpenAPI — Zod type mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('generateOpenAPI — extended Zod type mapping', () => {
  function specFor(schema: z.ZodTypeAny) {
    const adapted = zodAdapter(schema)
    return generateOpenAPI({
      title: 'T', version: '1',
      routes: { 'POST /t': defineRoute({ body: adapted }) },
    })
  }

  it('z.number().min().max() produces minimum/maximum', () => {
    const spec = specFor(z.object({ age: z.number().min(0).max(120) }))
    const props = (spec.paths['/t']!['post']!.requestBody!.content['application/json']!.schema as any).properties
    expect(props.age.minimum).toBe(0)
    expect(props.age.maximum).toBe(120)
  })

  it('z.literal produces const + enum', () => {
    const schema = zodAdapter(z.object({ status: z.literal('active') }))
    const spec = generateOpenAPI({ title: 'T', version: '1', routes: { 'GET /t': defineRoute({ body: schema }) } })
    const props = (spec.paths['/t']!['get']!.requestBody?.content['application/json']?.schema as any)?.properties
    // GET routes have no body, use a POST instead
    const spec2 = generateOpenAPI({ title: 'T', version: '1', routes: { 'POST /t': defineRoute({ body: schema }) } })
    const props2 = (spec2.paths['/t']!['post']!.requestBody!.content['application/json']!.schema as any).properties
    expect(props2.status.const).toBe('active')
    expect(props2.status.enum).toEqual(['active'])
  })

  it('all-literal z.union produces enum not oneOf', () => {
    const schema = zodAdapter(z.object({ role: z.union([z.literal('admin'), z.literal('user')]) }))
    const spec = generateOpenAPI({ title: 'T', version: '1', routes: { 'POST /t': defineRoute({ body: schema }) } })
    const props = (spec.paths['/t']!['post']!.requestBody!.content['application/json']!.schema as any).properties
    expect(props.role.enum).toEqual(['admin', 'user'])
    expect(props.role.oneOf).toBeUndefined()
  })

  it('z.string().email() produces format: email', () => {
    const schema = zodAdapter(z.object({ email: z.string().email() }))
    const spec = generateOpenAPI({ title: 'T', version: '1', routes: { 'POST /t': defineRoute({ body: schema }) } })
    const props = (spec.paths['/t']!['post']!.requestBody!.content['application/json']!.schema as any).properties
    expect(props.email.format).toBe('email')
  })

  it('required array only includes non-optional fields', () => {
    const schema = zodAdapter(z.object({
      required: z.string(),
      optional: z.string().optional(),
    }))
    const spec = generateOpenAPI({ title: 'T', version: '1', routes: { 'POST /t': defineRoute({ body: schema }) } })
    const bodySchema = spec.paths['/t']!['post']!.requestBody!.content['application/json']!.schema as any
    expect(bodySchema.required).toContain('required')
    expect(bodySchema.required).not.toContain('optional')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// createDocs — v0.7.0 + v0.8.0
// ═══════════════════════════════════════════════════════════════════════════

describe('createDocs — Swagger UI endpoint', () => {
  const spec = generateOpenAPI({ title: 'Test API', version: '1.0.0', routes: {} })

  it('returns 200 with text/html content-type', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec }))
    const res = await supertest(app).get('/docs')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('sets Content-Security-Policy header by default', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec }))
    const res = await supertest(app).get('/docs')
    expect(res.headers['content-security-policy']).toBeDefined()
    expect(res.headers['content-security-policy']).toContain('cdnjs.cloudflare.com')
  })

  it('sets X-Content-Type-Options and X-Frame-Options headers', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec }))
    const res = await supertest(app).get('/docs')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })

  it('omits CSP header when csp: false', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, csp: false }))
    const res = await supertest(app).get('/docs')
    expect(res.headers['content-security-policy']).toBeUndefined()
  })

  it('uses custom CSP when provided', async () => {
    const customCsp = "default-src 'self'"
    const app = express()
    app.use('/docs', createDocs({ spec, csp: customCsp }))
    const res = await supertest(app).get('/docs')
    expect(res.headers['content-security-policy']).toBe(customCsp)
  })

  it('includes spec JSON in HTML body', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('Test API')
    expect(res.text).toContain('SwaggerUIBundle')
  })

  it('includes custom title in HTML', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, title: 'My Custom Docs' }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('My Custom Docs')
  })

  it('includes validatorUrl: none to disable external validator', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('"none"')
  })

  it('includes dark theme CSS when theme: dark', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, theme: 'dark' }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('#0d1117')
  })

  it('includes auto-theme media query when theme: auto', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, theme: 'auto' }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('prefers-color-scheme')
  })

  it('has no dark CSS when theme: light', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, theme: 'light' }))
    const res = await supertest(app).get('/docs')
    expect(res.text).not.toContain('#0d1117')
    expect(res.text).not.toContain('prefers-color-scheme')
  })

  it('includes favicon link when favicon is set', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, favicon: '/favicon.ico' }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('rel="icon"')
    expect(res.text).toContain('/favicon.ico')
  })

  it('includes logo HTML when logo is configured', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, logo: { url: '/logo.png', altText: 'My Logo' } }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('/logo.png')
    expect(res.text).toContain('My Logo')
  })

  it('escapes HTML entities in title to prevent XSS', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, title: '<script>alert(1)</script>' }))
    const res = await supertest(app).get('/docs')
    expect(res.text).not.toContain('<script>alert(1)</script>')
    expect(res.text).toContain('&lt;script&gt;')
  })

  it('includes requestInterceptor function when configured', async () => {
    const app = express()
    app.use('/docs', createDocs({
      spec,
      requestInterceptor: "request.headers['X-Custom'] = 'value'; return request;",
    }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('requestInterceptor')
    expect(res.text).toContain('X-Custom')
  })

  it('includes docExpansion config in UI options', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec, docExpansion: 'none' }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('"none"')
  })

  it('includes persistAuthorization: true always', async () => {
    const app = express()
    app.use('/docs', createDocs({ spec }))
    const res = await supertest(app).get('/docs')
    expect(res.text).toContain('persistAuthorization')
  })

  it('works standalone — no shapeguard() middleware needed', async () => {
    // createDocs() must work without any shapeguard() setup
    const app = express()
    app.use('/docs', createDocs({ spec }))  // no shapeguard(), no errorHandler()
    const res = await supertest(app).get('/docs')
    expect(res.status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// res.cursorPaginated — v0.8.0
// ═══════════════════════════════════════════════════════════════════════════

describe('res.cursorPaginated — cursor-based pagination', () => {
  it('returns 200 with cursor pagination envelope', async () => {
    const app = makeApp()
    app.get('/users', (_req, res) => {
      res.cursorPaginated({
        data:       [{ id: 'u1' }, { id: 'u2' }],
        nextCursor: 'u2',
        prevCursor: null,
        hasMore:    true,
      })
    })
    app.use(errorHandler())

    const res = await supertest(app).get('/users')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.items).toHaveLength(2)
    expect(res.body.data.nextCursor).toBe('u2')
    expect(res.body.data.prevCursor).toBeNull()
    expect(res.body.data.hasMore).toBe(true)
  })

  it('includes optional total when provided', async () => {
    const app = makeApp()
    app.get('/users', (_req, res) => {
      res.cursorPaginated({ data: [], nextCursor: null, hasMore: false, total: 1000 })
    })
    app.use(errorHandler())

    const res = await supertest(app).get('/users')
    expect(res.body.data.total).toBe(1000)
  })

  it('omits total from envelope when not provided', async () => {
    const app = makeApp()
    app.get('/users', (_req, res) => {
      res.cursorPaginated({ data: [], nextCursor: null, hasMore: false })
    })
    app.use(errorHandler())

    const res = await supertest(app).get('/users')
    expect(res.body.data.total).toBeUndefined()
  })

  it('uses custom message when provided', async () => {
    const app = makeApp()
    app.get('/users', (_req, res) => {
      res.cursorPaginated({ data: [], nextCursor: null, hasMore: false, message: 'User list' })
    })
    app.use(errorHandler())

    const res = await supertest(app).get('/users')
    expect(res.body.message).toBe('User list')
  })

  it('works with response.shape envelope renaming', async () => {
    const app = express()
    app.use(express.json())
    app.use(shapeguard({
      logger: { silent: true },
      response: { shape: { ok: '{success}', payload: '{data}', msg: '{message}' } },
    }))
    app.get('/users', (_req, res) => {
      res.cursorPaginated({ data: [{ id: 1 }], nextCursor: 'id_1', hasMore: false })
    })
    app.use(errorHandler())

    const res = await supertest(app).get('/users')
    expect(res.body.ok).toBe(true)
    expect(res.body.payload).toBeDefined()
    expect(res.body.payload.nextCursor).toBe('id_1')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// verifyWebhook — v0.8.0
// ═══════════════════════════════════════════════════════════════════════════

const SECRET = 'test-webhook-secret-abc123'

function makeGithubSig(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function makeShopifySig(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

function makeCustomSig(body: string, secret: string, prefix = ''): string {
  return prefix + createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyWebhook — GitHub provider', () => {
  it('passes with a valid GitHub signature', async () => {
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({ provider: 'github', secret: SECRET }), (_req, res) => {
      res.status(200).json({ ok: true })
    })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ action: 'push' })
    const sig  = makeGithubSig(body, SECRET)

    const res = await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(body)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('returns 401 WEBHOOK_SIGNATURE_INVALID with wrong secret', async () => {
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({ provider: 'github', secret: SECRET }), (_req, res) => {
      res.status(200).json({ ok: true })
    })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ action: 'push' })
    const sig  = makeGithubSig(body, 'wrong-secret')

    const res = await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(body)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID')
  })

  it('returns 400 WEBHOOK_SIGNATURE_MISSING when header absent', async () => {
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({ provider: 'github', secret: SECRET }), (_req, res) => {
      res.status(200).json({ ok: true })
    })
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .send({ action: 'push' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_MISSING')
  })
})

describe('verifyWebhook — Shopify provider (base64 HMAC)', () => {
  it('passes with a valid Shopify base64 signature', async () => {
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({ provider: 'shopify', secret: SECRET }), (_req, res) => {
      res.status(200).json({ ok: true })
    })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ topic: 'orders/create' })
    const sig  = makeShopifySig(body, SECRET)

    const res = await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-shopify-hmac-sha256', sig)
      .send(body)

    expect(res.status).toBe(200)
  })
})

describe('verifyWebhook — custom provider', () => {
  it('works with fully custom algorithm, header, and prefix', async () => {
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({
      secret:     SECRET,
      algorithm:  'sha256',
      headerName: 'x-my-signature',
      prefix:     'sha256=',
      encoding:   'hex',
    }), (_req, res) => { res.status(200).json({ ok: true }) })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ event: 'test' })
    const sig  = makeCustomSig(body, SECRET, 'sha256=')

    const res = await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-my-signature', sig)
      .send(body)

    expect(res.status).toBe(200)
  })

  it('calls onSuccess hook when signature is valid', async () => {
    const onSuccess = vi.fn()
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({
      provider: 'github', secret: SECRET, onSuccess,
    }), (_req, res) => { res.status(200).json({ ok: true }) })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ x: 1 })
    const sig  = makeGithubSig(body, SECRET)

    await supertest(app).post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(body)

    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('calls onFailure hook when signature is invalid', async () => {
    const onFailure = vi.fn()
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({
      provider: 'github', secret: SECRET, onFailure,
    }), (_req, res) => { res.status(200).json({ ok: true }) })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ x: 1 })

    await supertest(app).post('/wh')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=badhash')
      .send(body)

    expect(onFailure).toHaveBeenCalledOnce()
  })
})

describe('verifyWebhook — Stripe replay protection', () => {
  function makeStripeSig(body: string, secret: string, timestamp: number): string {
    const payload = `${timestamp}.${body}`
    const mac = createHmac('sha256', secret).update(payload).digest('hex')
    return `t=${timestamp},v1=${mac}`
  }

  it('passes with valid Stripe signature and fresh timestamp', async () => {
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({ provider: 'stripe', secret: SECRET }), (_req, res) => {
      res.status(200).json({ ok: true })
    })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ type: 'payment_intent.succeeded' })
    const ts   = Math.floor(Date.now() / 1000)
    const sig  = makeStripeSig(body, SECRET, ts)

    const res = await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sig)
      .send(body)

    expect(res.status).toBe(200)
  })

  it('rejects expired Stripe timestamp (replay attack)', async () => {
    const app = express()
    app.use(express.json())
    app.post('/wh', verifyWebhook({ provider: 'stripe', secret: SECRET }), (_req, res) => {
      res.status(200).json({ ok: true })
    })
    app.use(errorHandler({ debug: true }))

    const body = JSON.stringify({ type: 'payment_intent.succeeded' })
    const ts   = Math.floor(Date.now() / 1000) - 400 // 400s ago — outside 300s window
    const sig  = makeStripeSig(body, SECRET, ts)

    const res = await supertest(app)
      .post('/wh')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', sig)
      .send(body)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('WEBHOOK_TIMESTAMP_EXPIRED')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AppError.define — v0.8.0
// ═══════════════════════════════════════════════════════════════════════════

describe('AppError.define — typed error factory', () => {
  it('creates a callable factory that returns AppError', () => {
    const MyError = AppError.define('MY_CODE', 400, 'Default message')
    const err = MyError()
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('MY_CODE')
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Default message')
  })

  it('includes typed details in thrown error', () => {
    const PaymentError = AppError.define<{ amount: number; currency: string }>(
      'PAYMENT_FAILED', 402, 'Payment failed'
    )
    const err = PaymentError({ amount: 9.99, currency: 'USD' })
    expect(err.code).toBe('PAYMENT_FAILED')
    expect(err.statusCode).toBe(402)
    expect((err.details as any).amount).toBe(9.99)
    expect((err.details as any).currency).toBe('USD')
  })

  it('allows overriding message per-throw', () => {
    const MyError = AppError.define('CODE', 400, 'Default')
    const err = MyError(undefined, 'Custom message for this throw')
    expect(err.message).toBe('Custom message for this throw')
  })

  it('falls back to code as message when no default message given', () => {
    const MyError = AppError.define('SOME_CODE', 422)
    const err = MyError()
    expect(err.message).toBe('SOME_CODE')
  })

  it('factory errors are caught by errorHandler and return correct status', async () => {
    const ForbiddenError = AppError.define<{ requiredRole: string }>('ROLE_REQUIRED', 403, 'Insufficient role')
    const app = makeApp()
    app.get('/protected', (_req, _res, next) => {
      next(ForbiddenError({ requiredRole: 'admin' }))
    })
    app.use(errorHandler({ debug: true }))

    const res = await supertest(app).get('/protected')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ROLE_REQUIRED')
  })

  it('isAppError returns true for define() errors', async () => {
    const { isAppError } = await import('../errors/AppError.js')
    const MyError = AppError.define('X', 400)
    expect(isAppError(MyError())).toBe(true)
  })

  it('multiple factories are independent', () => {
    const ErrorA = AppError.define('CODE_A', 400)
    const ErrorB = AppError.define('CODE_B', 500)
    expect(ErrorA().code).toBe('CODE_A')
    expect(ErrorB().code).toBe('CODE_B')
    expect(ErrorA().statusCode).toBe(400)
    expect(ErrorB().statusCode).toBe(500)
  })
})

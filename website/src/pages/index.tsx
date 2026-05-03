import React from 'react'
import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import CodeBlock from '@theme/CodeBlock'
import '../css/custom.css'

// ─────────────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-inner">
        <div className="hero-badge">
          <span>⚡</span>
          <span>v0.10.0 · Zero runtime dependencies</span>
        </div>

        <h1 className="hero-title">
          The Express middleware<br />
          <span className="hero-accent">you should have had</span><br />
          from day one.
        </h1>

        <p className="hero-subtitle">
          Typed validation, structured logging, consistent errors, response stripping,
          OpenAPI docs, webhook verification, rate limiting — all in one tiny package.
          Use any feature independently. Nothing is mandatory.
        </p>

        <div className="hero-badges">
          <img src="https://img.shields.io/npm/v/shapeguard?label=shapeguard&color=0a5f4a&style=flat-square" alt="npm version" />
          <img src="https://img.shields.io/bundlephobia/minzip/shapeguard?label=minzipped&style=flat-square&color=0a5f4a" alt="bundle size" />
          <img src="https://img.shields.io/npm/dm/shapeguard?color=0a5f4a&style=flat-square" alt="downloads" />
          <img src="https://img.shields.io/badge/tests-874%20passing-0a5f4a?style=flat-square" alt="tests" />
          <img src="https://img.shields.io/badge/deps-zero-0a5f4a?style=flat-square" alt="zero deps" />
        </div>

        <div className="hero-ctas">
          <Link className="button button--primary button--lg" to="/docs/quick-start">
            Get started — 2 minutes →
          </Link>
          <Link className="button button--secondary button--lg" to="https://github.com/kalyankashaboina/shapeguard">
            GitHub ↗
          </Link>
        </div>

        <div className="hero-install">
          npm install shapeguard zod
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────
function Stats() {
  const stats = [
    { value: '9 → 1',   label: 'Packages replaced'   },
    { value: '~18 KB',  label: 'Gzipped (main)'       },
    { value: '0',       label: 'Runtime deps'          },
    { value: '874',     label: 'Tests passing'         },
    { value: 'ESM+CJS', label: 'Module formats'        },
    { value: '100%',    label: 'TypeScript'            },
  ]
  return (
    <div className="stats-strip">
      {stats.map(s => (
        <div key={s.label} className="stat-item">
          <span className="stat-value">{s.value}</span>
          <span className="stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Before / After
// ─────────────────────────────────────────────────────────────────────────────
const BEFORE = `// You need 9 separate packages
// express-validator, http-errors, morgan,
// express-rate-limit, express-async-errors,
// swagger-ui-express, swagger-jsdoc, uuid, supertest

// ❌ Different validation shape per developer
if (!req.body.email || typeof req.body.email !== 'string') {
  return res.status(400).json({ error: 'email is required' })
}

// ❌ passwordHash silently shipped to clients
const user = await db.create(req.body)
res.json(user)

// ❌ Unhandled async — request hangs silently in Express 4
app.get('/users/:id', async (req, res) => {
  const user = await db.find(req.params.id) // throws? hangs.
  res.json(user)
})`

const AFTER = `// npm install shapeguard zod
//
// ✅ Mount once — every route gets everything

app.use(shapeguard())   // logging, requestId, security guards
app.use(errorHandler()) // catches every thrown error, always consistent

const CreateUserRoute = defineRoute({
  body: createDTO(z.object({
    email:    z.string().email(),
    name:     z.string().min(1).max(100),
    password: z.string().min(8),  // ← listed in body, NOT in response
  })),
  response: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  // password, passwordHash, internalField — auto-stripped ✅
})

app.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body is typed ✅  async errors caught ✅  fields stripped ✅
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))`

function BeforeAfter() {
  return (
    <section className="before-after-section">
      <div className="section-container">
        <h2 className="section-title">Same endpoint, before and after</h2>
        <p className="section-subtitle">
          See what shapeguard removes from your codebase — and what it gives you instead.
        </p>
        <div className="code-grid">
          <div>
            <div className="code-col-label col-before">
              <span>✕</span> Without shapeguard — 9 packages
            </div>
            <CodeBlock language="ts">{BEFORE}</CodeBlock>
          </div>
          <div>
            <div className="code-col-label col-after">
              <span>✓</span> With shapeguard — 1 package
            </div>
            <CodeBlock language="ts">{AFTER}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Packages replaced
// ─────────────────────────────────────────────────────────────────────────────
const PACKAGES = [
  { pkg: 'express-validator',      replaced: 'defineRoute() + handle() — typed, inferred, all errors at once' },
  { pkg: 'express-async-errors',   replaced: 'Built into handle() and asyncHandler() — zero config' },
  { pkg: 'http-errors',            replaced: 'AppError — consistent codes, typed factories, define your own' },
  { pkg: 'morgan',                 replaced: 'shapeguard() — structured JSON logs, auto pino/winston detection' },
  { pkg: 'express-rate-limit',     replaced: 'defineRoute({ rateLimit }) — per-route, pluggable Redis store' },
  { pkg: 'swagger-ui-express',     replaced: 'serveScalar() / serveSwaggerUI() / serveRedoc() — CDN, zero install' },
  { pkg: 'swagger-jsdoc',          replaced: 'generateOpenAPI() — reads your existing route definitions' },
  { pkg: 'uuid',                   replaced: 'requestId built into shapeguard() — custom format supported' },
  { pkg: 'supertest mocks',        replaced: 'mockRequest / mockResponse / mockNext — no HTTP, no ports' },
  { pkg: 'express-healthcheck',    replaced: 'healthCheck() — parallel checks, independent timeouts, k8s-ready' },
  { pkg: 'http-graceful-shutdown', replaced: 'gracefulShutdown() — drain + cleanup hooks + force exit' },
]

function PackagesReplaced() {
  return (
    <section className="packages-section">
      <div className="section-container">
        <h2 className="section-title">What shapeguard replaces</h2>
        <p className="section-subtitle">
          Every package below is one you no longer need to install, configure, version-pin, and keep updated.
        </p>
        <table className="packages-table">
          <thead>
            <tr>
              <th>Package removed</th>
              <th>shapeguard equivalent</th>
            </tr>
          </thead>
          <tbody>
            {PACKAGES.map(({ pkg, replaced }) => (
              <tr key={pkg}>
                <td>{pkg}</td>
                <td>{replaced}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pkg-total">
          11 packages → 1 &nbsp;·&nbsp; ~18 KB gzipped &nbsp;·&nbsp; zero runtime dependencies
        </p>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// How it works — real code snippets for each feature
// ─────────────────────────────────────────────────────────────────────────────
const EXAMPLE_VALIDATION = `// 1. Define the route — body, params, query, response, rate limit, timeout
const CreateUserRoute = defineRoute({
  body: createDTO(z.object({
    email:    z.string().email(),
    name:     z.string().min(1).max(100),
    password: z.string().min(8),
    role:     z.enum(['admin', 'member', 'viewer']).default('member'),
  })),
  response: z.object({     // ← only these fields reach the client
    id: z.string().uuid(),
    email: z.string(),
    name: z.string(),
    role: z.enum(['admin', 'member', 'viewer']),
  }),
  rateLimit: { windowMs: 60_000, max: 10 },  // 10 signups/minute
  timeout:   5_000,                           // 408 if handler > 5s
})

// 2. Handle — validates body, strips response, catches async errors
router.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  const user = await UserService.create(req.body)  // typed ✅
  res.created({ data: user, message: 'User created' })
  // password auto-stripped from response ✅
}))`

const EXAMPLE_ERRORS = `// Throw anywhere — errorHandler() catches and formats everything
throw AppError.notFound('User')          // 404 NOT_FOUND
throw AppError.conflict('Email')         // 409 CONFLICT
throw AppError.forbidden('Admin only')   // 403 FORBIDDEN
throw AppError.unauthorized()            // 401 UNAUTHORIZED

// Define your own typed error factories
const PaymentFailed = AppError.define<{ amount: number; currency: string }>(
  'PAYMENT_FAILED', 402, 'Payment could not be processed'
)
throw PaymentFailed({ amount: 9.99, currency: 'USD' })

// Every error — validation, thrown, unhandled crash — returns:
// { success: false, error: { code, message, details } }`

const EXAMPLE_WEBHOOK = `// Stripe, GitHub, Shopify, Svix, Twilio — or custom HMAC
app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),  // raw body required for HMAC
  verifyWebhook({
    provider: 'stripe',
    secret:   process.env.STRIPE_WEBHOOK_SECRET!,
    onSuccess: (req) => console.log('verified:', req.headers['stripe-signature']),
    onFailure: (req, reason) => console.warn('rejected:', reason),
  }),
  async (req, res) => {
    // signature verified ✅  timing-safe comparison ✅  replay protection ✅
    const event = JSON.parse(req.body.toString())
    await processStripeEvent(event)
    res.json({ received: true })
  }
)`

const EXAMPLE_TESTING = `import { mockRequest, mockResponse, mockNext } from 'shapeguard/testing'

// Test controllers directly — no HTTP, no Express app, no ports
it('creates a user and returns 201', async () => {
  UserService.create.mockResolvedValue({ id: '1', email: 'alice@example.com' })

  const req  = mockRequest({ body: { email: 'alice@example.com', name: 'Alice' } })
  const res  = mockResponse()
  const next = mockNext()

  // handle() returns [validateMiddleware, handler] — test the handler directly
  await handler(req, res, next)

  expect(next.error).toBeUndefined()
  expect(res._result().statusCode).toBe(201)
  expect(res._result().body.data.email).toBe('alice@example.com')
})`

const EXAMPLE_PRODUCTION = `// Mount once — healthCheck + gracefulShutdown + structured logging
app.use('/health', healthCheck({
  checks: {
    db:  () => db.query('SELECT 1'),
    mem: healthCheck.memory({ maxPercent: 90 }),
    env: healthCheck.env(['DATABASE_URL', 'REDIS_URL']),
  },
  timeout: 3_000,   // each check times out independently
}))

// GET /health → 200 { status: 'healthy', checks: {...}, uptime: 42 }
// GET /health → 503 { status: 'unhealthy', checks: { db: 'error' } }

const server = app.listen(3000)
const stopShutdown = gracefulShutdown(server, {
  drainMs:    30_000,           // wait up to 30s for in-flight requests
  onShutdown: async () => {
    await db.close()            // close connections after drain
    await redis.quit()
  },
  logger,                       // reuse shapeguard's logger
})`

type Step = { step: string; title: string; desc: string; code: string; lang: string; highlights: string[] }

const HOW_IT_WORKS: Step[] = [
  {
    step:   '01',
    title:  'Validate everything — body, params, query, headers',
    desc:   'Define your route schema once. shapeguard validates all parts of the request, coerces types, collects all errors at once, and removes sensitive fields from the response — automatically.',
    code:   EXAMPLE_VALIDATION,
    lang:   'ts',
    highlights: [
      'All validation errors returned in one response — never one at a time',
      'Response schema strips unlisted fields before they reach the client',
      'Rate limiting and timeouts defined per-route — no global config needed',
      'Type inference flows through — req.body is fully typed in the handler',
    ],
  },
  {
    step:   '02',
    title:  'Errors that always look the same',
    desc:   'Throw AppError anywhere in your codebase. errorHandler() catches it, logs it, and returns a consistent JSON structure — every time. Define your own typed error factories for domain errors.',
    code:   EXAMPLE_ERRORS,
    lang:   'ts',
    highlights: [
      'One error shape across every endpoint — clients can always parse errors the same way',
      'Define typed error factories — TypeScript checks your error payload at compile time',
      'Unhandled crashes produce 500s — never expose stack traces in production',
      'Optional Sentry / PagerDuty wiring via onError hook',
    ],
  },
  {
    step:   '03',
    title:  'Webhook verification — zero extra code',
    desc:   'Stripe, GitHub, Shopify, Svix, Twilio — or your own HMAC format. One line to verify. Timing-safe comparison prevents timing attacks. Built-in replay protection.',
    code:   EXAMPLE_WEBHOOK,
    lang:   'ts',
    highlights: [
      'timingSafeEqual() — prevents timing side-channel attacks',
      'Timestamp tolerance window — blocks replayed events automatically',
      'Delivery-ID deduplication — pass a Redis store for multi-instance deployments',
      'Custom HMAC: configure algorithm, header name, prefix, and encoding freely',
    ],
  },
  {
    step:   '04',
    title:  'Test controllers without a server',
    desc:   'mockRequest(), mockResponse(), and mockNext() let you test your business logic directly — no Express app, no HTTP, no port conflicts. Tests run in milliseconds.',
    code:   EXAMPLE_TESTING,
    lang:   'ts',
    highlights: [
      'No supertest, no express server, no port conflicts in CI',
      'mockResponse._result() returns statusCode, headers, and body',
      'Works with Vitest and Jest out of the box',
      'Test validation middleware and handlers independently',
    ],
  },
  {
    step:   '05',
    title:  'Production-ready from day one',
    desc:   'healthCheck() for Kubernetes probes. gracefulShutdown() for zero-downtime deploys. Both are standalone — no shapeguard() required to use them.',
    code:   EXAMPLE_PRODUCTION,
    lang:   'ts',
    highlights: [
      'Checks run in parallel — one slow check never blocks the others',
      'Returns 200/503 — correct for k8s liveness and readiness probes',
      'gracefulShutdown drains in-flight requests before closing the server',
      'SIGTERM and SIGINT handled — correct for Docker, PM2, and systemd',
    ],
  },
]

function HowItWorks() {
  return (
    <section className="howto-section">
      <div className="section-container">
        <h2 className="section-title">How each feature works</h2>
        <p className="section-subtitle">
          Real code from the examples — copy, paste, and run.
        </p>
        <div className="howto-steps">
          {HOW_IT_WORKS.map(({ step, title, desc, code, lang, highlights }, i) => (
            <div key={step} className="howto-step" style={{ direction: i % 2 === 1 ? 'rtl' : 'ltr' }}>
              <div className="howto-step-meta" style={{ direction: 'ltr' }}>
                <div className="step-number">{step}</div>
                <h3 className="step-title">{title}</h3>
                <p className="step-desc">{desc}</p>
                <ul className="step-highlights">
                  {highlights.map(h => <li key={h}>{h}</li>)}
                </ul>
              </div>
              <div style={{ direction: 'ltr' }}>
                <CodeBlock language={lang}>{code}</CodeBlock>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Features grid
// ─────────────────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: '🛡️', title: 'Typed request validation',        desc: 'Zod validates body, params, query, and headers. All errors returned at once — never one field at a time.' },
  { icon: '🔒', title: 'Automatic response field stripping', desc: 'List what the client should see. Everything else — passwords, tokens, internal IDs — is removed automatically.' },
  { icon: '🚨', title: 'Consistent error JSON — always',   desc: 'Validation, 404, AppError, unhandled crash — every error produces the exact same JSON shape.' },
  { icon: '📋', title: 'Structured logging — zero config', desc: 'Auto-selects pino → winston → console. Dev: colour-coded. Prod: structured JSON for Datadog / CloudWatch / Loki.' },
  { icon: '📖', title: 'OpenAPI spec + three UIs',         desc: 'generateOpenAPI() reads your route definitions. Serve Scalar, Swagger UI, or Redoc — CDN-loaded, zero install.' },
  { icon: '📤', title: 'Postman · Insomnia · Bruno export', desc: 'toPostman(), toInsomnia(), toBruno() — export your full API spec to any HTTP client in one call.' },
  { icon: '🔗', title: 'Webhook HMAC verification',        desc: 'Stripe, GitHub, Shopify, Svix, Twilio, custom. One line. timingSafeEqual. Replay attack protection.' },
  { icon: '⚡', title: 'Per-route rate limiting',          desc: 'defineRoute({ rateLimit }) — in-memory by default, plug in Redis for distributed deployments.' },
  { icon: '⏱️', title: 'Per-route request timeout',        desc: 'defineRoute({ timeout: 5000 }) — aborts with 408 if the handler exceeds the limit. No more hanging requests.' },
  { icon: '🔄', title: 'Transform hook',                   desc: 'Run code after validation, before the handler — hash passwords, generate slugs, enrich data. Handler stays pure.' },
  { icon: '❤️', title: 'Health checks — k8s-ready',        desc: 'Parallel checks with independent timeouts. 200 = healthy, 503 = degraded. Built-in memory and env checks.' },
  { icon: '🛑', title: 'Graceful shutdown',                desc: 'SIGTERM drains in-flight requests, runs your cleanup hooks, then exits cleanly. Zero-downtime deploys.' },
  { icon: '🧪', title: 'Test helpers — no HTTP server',    desc: 'mockRequest(), mockResponse(), mockNext() — test controllers in pure Node. No ports, no Express, instant.' },
  { icon: '🔌', title: 'Fully standalone — use any feature', desc: 'Need just rate limiting? Just health checks? Every feature works independently. Adopt one at a time.' },
]

function Features() {
  return (
    <section className="features-section">
      <div className="section-container">
        <h2 className="section-title">Everything included</h2>
        <p className="section-subtitle">
          14 production features. Zero runtime dependencies. ~18 KB gzipped.
          Every feature is independently usable.
        </p>
        <div className="features-grid">
          {FEATURES.map(({ icon, title, desc }) => (
            <div key={title} className="feature-card">
              <span className="feature-icon">{icon}</span>
              <h3 className="feature-title">{title}</h3>
              <p className="feature-desc">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick start
// ─────────────────────────────────────────────────────────────────────────────
const QUICK_START = `import express from 'express'
import { z } from 'zod'
import {
  shapeguard,    // logging + requestId + security guards (pre-parse limits)
  defineRoute,   // declare body/params/query/response schemas for a route
  handle,        // validate + asyncHandler in one call — no array spread needed
  createDTO,     // infer TypeScript types from your Zod schema automatically
  AppError,      // throw from anywhere — errorHandler() catches and formats it
  errorHandler,  // last middleware — catches everything, always consistent JSON
  notFoundHandler,
} from 'shapeguard'

const app = express()
app.use(express.json())
app.use(shapeguard())        // ← structured logging, requestId, security guards
app.use(notFoundHandler())   // ← 404 for every unmatched route
app.use(errorHandler())      // ← catches every error thrown in any handler

// ── Define the route — body schema + response schema ─────────────────────────
const CreateUserRoute = defineRoute({
  body: createDTO(z.object({
    email:    z.string().email(),
    name:     z.string().min(1).max(100),
    password: z.string().min(8),
  })),
  // Only these fields reach the client — password auto-stripped ✅
  response: z.object({
    id:    z.string().uuid(),
    email: z.string().email(),
    name:  z.string(),
  }),
})

// ── Route handler ─────────────────────────────────────────────────────────────
app.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body is fully typed  ✅
  // async errors are caught  ✅
  // password is stripped     ✅
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))

app.listen(3000)
// → POST /users validates, logs, strips password, catches errors — automatically`

function QuickStart() {
  return (
    <section className="quickstart-section">
      <div className="quickstart-inner">
        <h2 className="section-title">Full setup in one file</h2>
        <p className="section-subtitle">
          Mount shapeguard once. Every route gets validation, logging, error handling,
          and response stripping — no per-route wiring needed.
        </p>
        <CodeBlock language="ts" title="app.ts — complete working example">{QUICK_START}</CodeBlock>
        <div className="quickstart-cta">
          <Link className="button button--primary button--lg" to="/docs/quick-start">
            Full quick-start guide →
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/guides/existing-app">
            Add to existing app →
          </Link>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout
      title={`${siteConfig.title} — Express middleware library`}
      description="One package that replaces eleven. Typed validation, structured logging, consistent errors, OpenAPI docs, webhook verification and more — zero runtime dependencies."
    >
      <Hero />
      <Stats />
      <main>
        <BeforeAfter />
        <PackagesReplaced />
        <HowItWorks />
        <Features />
        <QuickStart />
      </main>
    </Layout>
  )
}

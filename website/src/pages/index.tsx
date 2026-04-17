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
      <div className="hero-badge">
        <span className="hero-badge-dot" />
        v0.11.0 — 1,041 tests · 0 runtime deps · ESM + CJS
      </div>

      <h1 className="hero-title">
        Express APIs without
        <span className="hero-title-accent">the boilerplate.</span>
      </h1>

      <p className="hero-subtitle">
        Typed validation, consistent errors, structured logging, API docs,
        and security — production-ready from day one. Pick one feature or all of them.
        Nothing is mandatory.
      </p>

      <div className="hero-ctas">
        <Link className="btn-primary" to="/docs/quick-start">
          Get started →
        </Link>
        <Link className="btn-secondary" to="https://github.com/kalyankashaboina/shapeguard">
          ★ GitHub
        </Link>
      </div>

      <div className="hero-install">
        <span className="hero-install-label">install</span>
        <span>npm install shapeguard zod</span>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats strip
// ─────────────────────────────────────────────────────────────────────────────
const STATS = [
  { value: '16',      label: 'Boilerplate patterns eliminated' },
  { value: '~18KB',   label: 'Gzipped (core entry)' },
  { value: '0',       label: 'Runtime dependencies' },
  { value: '1041+',   label: 'Tests passing' },
  { value: 'ESM+CJS', label: 'Module formats' },
  { value: 'Node 18+',label: 'Minimum runtime' },
]

function Stats() {
  return (
    <div className="stats-strip">
      {STATS.map(s => (
        <div key={s.label} className="stat-item">
          <span className="stat-value">{s.value}</span>
          <span className="stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Trust bar
// ─────────────────────────────────────────────────────────────────────────────
const TRUST = [
  { icon: '🔒', text: '0 vulnerabilities (npm audit)' },
  { icon: '✅', text: 'SonarCloud quality gate' },
  { icon: '⚡', text: 'TypeScript-first, zero any' },
  { icon: '🔐', text: 'Timing-safe webhook HMAC' },
  { icon: '🛡️', text: 'Proto-pollution blocked' },
  { icon: '📋', text: 'MIT Licensed' },
]

function TrustBar() {
  return (
    <div className="trust-section">
      <div className="trust-label">Production-hardened</div>
      <div className="trust-badges">
        {TRUST.map(t => (
          <div key={t.text} className="trust-badge">
            <span className="trust-badge-icon">{t.icon}</span>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Before / After
// ─────────────────────────────────────────────────────────────────────────────
const BEFORE = `// ❌ Without shapeguard — copy-paste boilerplate on every project

// Validation — different shapes per developer, partial errors
if (!req.body.email) return res.status(400).json({ error: 'required' })
if (!req.body.name)  return res.status(400).json({ msg: 'missing' })  // inconsistent!

// Async crashes — request hangs, no error returned in Express 4
app.post('/users', async (req, res) => {
  const user = await db.find(id)   // throws? Express 4 won't catch it
  res.json(user)                   // passwordHash ships to clients silently
})

// Rate limiting — separate package, manual wiring
// Error handling — per-route try/catch, no guaranteed shape
// Request IDs — copy-paste middleware
// OpenAPI — maintain YAML by hand, gets out of sync`

const AFTER = `// ✅ With shapeguard — wire once, works everywhere

app.use(express.json())
app.use(shapeguard())       // req.id, logging, security pre-parse
app.use(errorHandler())     // consistent error shape, always

const CreateUserRoute = defineRoute({
  body: createDTO(z.object({
    email:    z.string().email(),
    name:     z.string().min(1).max(100),
    password: z.string().min(8),       // NOT in response → auto-stripped
  })),
  response:   z.object({ id: z.string(), email: z.string() }),
  rateLimit:  { windowMs: 60_000, max: 10 },
  timeout:    5_000,
})

router.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body is fully typed. Async errors caught. Sensitive fields stripped.
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))

// OpenAPI docs auto-generated from route definitions
app.use('/docs', serveScalar(generateOpenAPI({ title: 'My API', version: '1', routes })))`

function BeforeAfter() {
  return (
    <section className="before-after-section">
      <div className="section-container">
        <div className="section-label">✦ the difference</div>
        <h2 className="section-title">Ship real features,<br />not infrastructure.</h2>
        <p className="section-subtitle">
          The same user creation endpoint — without and with shapeguard.
          Same result. One-tenth the boilerplate.
        </p>
        <div className="code-grid">
          <div>
            <div className="code-col-label col-before">✕ Without shapeguard</div>
            <CodeBlock language="ts">{BEFORE}</CodeBlock>
          </div>
          <div>
            <div className="code-col-label col-after">✓ With shapeguard</div>
            <CodeBlock language="ts">{AFTER}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Features grid
// ─────────────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: '🛡️',
    title: 'Schema-driven validation',
    desc:  'Zod (or Joi / Yup) validates body, params, query, and headers. All failures returned at once — never one at a time. Adapters are zero-overhead thin wrappers.',
  },
  {
    icon: '🔒',
    title: 'Automatic response stripping',
    desc:  'Define the response schema. passwordHash, token, and any unlisted field are silently removed before the response is sent — no manual deletion needed.',
  },
  {
    icon: '🚨',
    title: 'Consistent error shape — always',
    desc:  'Every error — validation, 404, thrown AppError, uncaught async crash — produces the exact same JSON. Clients never parse two different shapes.',
  },
  {
    icon: '📋',
    title: 'Structured logging — zero config',
    desc:  'Auto-selects pino → winston → built-in fallback. Dev: color-coded, human-readable. Prod: JSON for Datadog / CloudWatch / Loki. Request IDs propagated.',
  },
  {
    icon: '📖',
    title: 'OpenAPI + three doc UIs',
    desc:  'generateOpenAPI() reads your route definitions directly. Serve Scalar, Swagger UI, or Redoc. Export to Postman, Insomnia, and Bruno with one function call.',
  },
  {
    icon: '🔗',
    title: 'Webhook verification',
    desc:  'Stripe, GitHub, Shopify, Svix, Twilio — one line, timing-safe HMAC (timingSafeEqual), replay attack protection, configurable tolerance window.',
  },
  {
    icon: '🔄',
    title: 'Circuit breaker',
    desc:  'circuitBreaker() wraps external calls. CLOSED → OPEN after N failures. HALF_OPEN probes recovery. onOpen/onClose hooks for Sentry and PagerDuty.',
  },
  {
    icon: '📡',
    title: 'Server-Sent Events',
    desc:  'sseStream() sets all required headers, handles heartbeats, disables nginx buffering, and cleans up on client disconnect. Typed events.',
  },
  {
    icon: '🗂️',
    title: 'Route groups — co-locate routes',
    desc:  'defineGroup("/users", { middleware, routes }) — shared auth declared once, applied to all routes in the group. Automatic 405 Method Not Allowed.',
  },
  {
    icon: '🧩',
    title: 'Typed context store',
    desc:  'setContext(req, "user", authUser) in middleware. requireContext<AuthUser>(req, "user") in handlers. No req property monkey-patching. Per-request isolation.',
  },
  {
    icon: '🔗',
    title: 'Composable middleware — pipe()',
    desc:  'pipe(requireAuth, rateLimiter, validate(route)) composes a reusable guard. Spread once, apply everywhere — no copy-paste middleware arrays.',
  },
  {
    icon: '🛰️',
    title: 'Sentry / Datadog / OTel hooks',
    desc:  'onError(ErrorContext) is async — await Sentry.flush() works. enrichContext() attaches user/tenant. fingerprint() controls issue grouping. onRequest() feeds APM.',
  },
  {
    icon: '❤️',
    title: 'Health check — k8s-ready',
    desc:  'healthCheck() runs all checks in parallel with independent timeouts. nonCritical[] checks produce "degraded" (200), not "unhealthy" (503).',
  },
  {
    icon: '🛑',
    title: 'Graceful shutdown',
    desc:  'gracefulShutdown() handles SIGTERM and SIGINT: drains in-flight requests, runs onShutdown hook (close DB, Redis), then exits cleanly.',
  },
  {
    icon: '⏱️',
    title: 'Per-route request timeout',
    desc:  'defineRoute({ timeout: 5000 }) aborts handlers with a 408 after the limit. Global timeout in shapeguard() applies to all routes.',
  },
  {
    icon: '🧪',
    title: 'Test helpers — no server needed',
    desc:  'mockRequest(), mockResponse(), mockNext() — test controllers in pure Node. No Express app, no ports, no supertest required.',
  },
  {
    icon: '🔌',
    title: 'Every feature is standalone',
    desc:  'Import only what you use. Add validation today, circuit-breaker next month. Nothing forces you to adopt everything at once.',
  },
  {
    icon: '🛡️',
    title: 'Security-hardened by default',
    desc:  'Prototype pollution blocked in pre-parse. PARAM_POLLUTION caught before Zod. Unicode injection stripped. X-Content-Type-Options on all errors.',
  },
]

function Features() {
  return (
    <section className="features-section">
      <div className="section-container">
        <div className="section-label">✦ everything included</div>
        <h2 className="section-title">One library.<br />Production-grade from day one.</h2>
        <p className="section-subtitle">
          Every feature is tested, security-hardened, and works independently.
          Use one or all — nothing is coupled.
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
// Boilerplate eliminated table
// ─────────────────────────────────────────────────────────────────────────────
const PATTERNS = [
  { before: 'Manual if(!req.body.x) validation checks',      after: 'defineRoute() + handle() — schema-driven, typed, all errors at once' },
  { before: 'try/catch + next(err) on every async route',    after: 'handle() / asyncHandler() — async errors caught automatically' },
  { before: 'Custom AppError class written per project',     after: 'AppError with factories, define(), fromFetch(), withContext()' },
  { before: 'Inconsistent res.status().json() shapes',       after: 'res.ok(), res.created(), res.fail(), res.paginated(), res.noContent()' },
  { before: 'req.id UUID generation + header forwarding',    after: 'Built into shapeguard() — reads x-request-id, generates if missing' },
  { before: 'res.json(user) leaking passwordHash, tokens',   after: 'Response schema stripping — unlisted fields stripped before send' },
  { before: 'Copy-pasted request logging setup',             after: 'shapeguard() structured logging — pino → winston → built-in fallback' },
  { before: 'Per-route rate limiting boilerplate',           after: 'defineRoute({ rateLimit }) — in-memory or bring your own Redis store' },
  { before: 'OpenAPI YAML / JSDoc maintenance',              after: 'generateOpenAPI() reads your route definitions, never out of sync' },
  { before: '/health endpoint boilerplate',                  after: 'healthCheck() — parallel checks, timeouts, degraded/unhealthy states' },
  { before: 'SIGTERM drain + process.exit wiring',           after: 'gracefulShutdown() — drain, cleanup hooks, force-exit fallback' },
  { before: 'Circuit breaker for external service calls',    after: 'circuitBreaker() — CLOSED/OPEN/HALF_OPEN, hooks, health probe' },
  { before: 'SSE / streaming endpoint setup',                after: 'sseStream() — headers, heartbeat, nginx buffering off, typed events' },
  { before: 'try/catch on every downstream fetch()',         after: 'AppError.fromFetch(resp) — wraps upstream errors with correct status' },
  { before: 'Context passing via req property mutation',     after: 'setContext/getContext/requireContext — typed, isolated per request' },
  { before: 'Repeated app.use() + Router() per feature',     after: 'defineGroup("/prefix", { middleware, routes }) — co-locate everything' },
]

function PatternsTable() {
  return (
    <section className="packages-section">
      <div className="section-container">
        <div className="section-label">✦ what you eliminate</div>
        <h2 className="section-title">16 boilerplate patterns.<br />All gone.</h2>
        <p className="section-subtitle">
          shapeguard eliminates the <em>code you write</em> to wire libraries together —
          not the libraries themselves. You keep Zod, pino, and Express.
        </p>
        <table className="packages-table">
          <thead>
            <tr>
              <th>Boilerplate you no longer write</th>
              <th>shapeguard gives you instead</th>
            </tr>
          </thead>
          <tbody>
            {PATTERNS.map(({ before, after }) => (
              <tr key={before}>
                <td>{before}</td>
                <td>{after}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pkg-total">
          16 patterns eliminated &nbsp;·&nbsp; your libraries stay &nbsp;·&nbsp; ~18KB gzipped &nbsp;·&nbsp; 0 runtime deps
        </p>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick start code
// ─────────────────────────────────────────────────────────────────────────────
const QUICK_START = `import express from 'express'
import { z } from 'zod'
import {
  shapeguard, defineRoute, handle, createDTO,
  AppError, errorHandler, notFoundHandler,
  defineGroup, circuitBreaker,
  setContext, requireContext,
} from 'shapeguard'

const app = express()
app.use(express.json())
app.use(shapeguard({ timeout: 30_000 }))  // global timeout, logging, req.id, security

// ── Auth middleware — context store is type-safe, no req mutation ─────────
app.use(async (req, _res, next) => {
  const token = req.headers.authorization?.slice(7)
  if (token) setContext(req, 'user', await verifyJWT(token))
  next()
})

// ── Circuit breaker — stop cascading failures when DB is down ─────────────
const db = circuitBreaker({
  name: 'database', threshold: 5, resetTimeout: 30_000,
  onOpen: (name) => Sentry.captureMessage(\`Circuit \${name} opened\`),
})

// ── Route group — shared auth + rate-limit applied to every route ─────────
export const usersGroup = defineGroup('/users', {
  middleware: [(req, _res, next) => {
    if (!getContext(req, 'user')) { next(AppError.unauthorized()); return }
    next()
  }],
  routes: (r) => {
    r.get('/', ...handle(
      defineRoute({
        rateLimit: { windowMs: 60_000, max: 100, trustProxy: true },
        response:  z.array(z.object({ id: z.string(), email: z.string() })),
      }),
      async (req, res) => {
        const user = requireContext<AuthUser>(req, 'user')
        const users = await db.call(() => UserRepo.findAll({ tenantId: user.tenantId }))
        res.ok({ data: users, message: '' })
      }
    ))

    r.post('/', ...handle(
      defineRoute({
        body: createDTO(z.object({
          email:    z.string().email(),
          name:     z.string().min(1),
          password: z.string().min(8),     // stripped from response automatically
        })),
        response: z.object({ id: z.string(), email: z.string() }),
      }),
      async (req, res) => {
        const user = await db.call(() => UserRepo.create(req.body))
        res.created({ data: user, message: 'User created' })
      }
    ))
  },
})

app.use(usersGroup)
app.use(notFoundHandler())
app.use(errorHandler({
  errors: {
    onError: async ({ err, req, isOperational }) => {
      if (!isOperational) await Sentry.captureException(err)
    },
    enrichContext: (req) => ({ userId: getContext(req, 'user')?.id }),
  }
}))

app.listen(3000)`

function QuickStart() {
  return (
    <section className="quickstart-section">
      <div className="quickstart-inner">
        <div className="section-label">✦ full example</div>
        <h2 className="section-title">Production setup<br />in one file.</h2>
        <p className="section-subtitle">
          Auth, validation, rate limiting, circuit breaker, Sentry, graceful errors —
          all wired in under 70 lines.
        </p>
        <CodeBlock language="ts" title="app.ts">{QUICK_START}</CodeBlock>
        <div className="quickstart-cta">
          <Link className="btn-primary" to="/docs/quick-start">
            Full quick start →
          </Link>
          <Link className="btn-secondary" to="/docs/guides/existing-app">
            Add to existing app →
          </Link>
          <Link className="btn-secondary" to="/docs/api">
            API reference →
          </Link>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA Band
// ─────────────────────────────────────────────────────────────────────────────
function CTABand() {
  return (
    <section className="cta-band">
      <div className="section-container">
        <h2 className="cta-band-title">Ready to stop writing boilerplate?</h2>
        <p className="cta-band-sub">
          Install in 30 seconds. No config required to get validation, logging, and error handling.
        </p>
        <div className="cta-band-actions">
          <Link className="btn-primary" to="/docs/quick-start">
            Get started — free forever →
          </Link>
          <Link className="btn-secondary" to="https://github.com/kalyankashaboina/shapeguard">
            View on GitHub
          </Link>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout
      title={`${siteConfig.title} — Express without the boilerplate`}
      description="Typed validation, consistent errors, structured logging, API docs, circuit breaker, and SSE for Express — production-ready from day one. Zero runtime dependencies."
    >
      <Hero />
      <Stats />
      <main>
        <TrustBar />
        <BeforeAfter />
        <Features />
        <PatternsTable />
        <QuickStart />
        <CTABand />
      </main>
    </Layout>
  )
}

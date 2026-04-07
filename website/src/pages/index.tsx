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
      <div className="hero-eyebrow">
        <span>🚀</span>
        <span>v0.9.0 — zero runtime dependencies</span>
      </div>

      <h1 className="hero-title">
        Stop writing<br />
        <span className="hero-accent">Express boilerplate.</span>
      </h1>

      <p className="hero-subtitle">
        shapeguard replaces 9 packages with 1 — typed validation,
        structured logging, consistent errors, and API docs for Express.
        Adopt one feature at a time. Nothing is mandatory.
      </p>

      <div className="hero-badges">
        <img src="https://img.shields.io/npm/v/shapeguard?label=shapeguard&color=0f6e56" alt="npm version" />
        <img src="https://img.shields.io/bundlephobia/minzip/shapeguard?label=minzipped" alt="bundle size" />
        <img src="https://img.shields.io/npm/dm/shapeguard?color=0f6e56" alt="downloads" />
        <img src="https://img.shields.io/github/actions/workflow/status/kalyankashaboina/shapeguard/ci.yml?label=CI" alt="CI" />
      </div>

      <div className="hero-ctas">
        <Link className="button button--primary button--lg" to="/docs/quick-start">
          Get started in 2 minutes →
        </Link>
        <Link className="button button--secondary button--lg" to="https://github.com/kalyankashaboina/shapeguard">
          View on GitHub
        </Link>
      </div>

      <div className="hero-install">
        npm install shapeguard zod
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats strip
// ─────────────────────────────────────────────────────────────────────────────
function Stats() {
  const stats = [
    { value: '9 → 1',  label: 'Packages replaced' },
    { value: '~12KB',  label: 'Minzipped (main)' },
    { value: '0',      label: 'Runtime deps' },
    { value: '90%+',   label: 'Test coverage' },
    { value: 'ESM+CJS',label: 'Module formats' },
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
const BEFORE = `// install 9 packages: express-validator, http-errors,
// morgan, express-rate-limit, express-async-errors,
// swagger-ui-express, swagger-jsdoc, uuid, supertest

// ❌ manual validation — different shape per developer
if (!req.body.email) return res.status(400).json({ error: 'email required' })
if (!req.body.name)  return res.status(400).json({ msg: 'Name missing' })

// ❌ passwordHash ships to clients silently
res.json(user)

// ❌ unhandled async — request hangs in Express 4
app.get('/users/:id', async (req, res) => {
  const user = await db.find(req.params.id) // throws?
  res.json(user)
})`

const AFTER = `// npm install shapeguard zod

// ✅ One setup — validate, log, strip, catch errors
app.use(shapeguard())
app.use(errorHandler()) // catches everything, always consistent

const CreateUserRoute = defineRoute({
  body:     createDTO(z.object({
    email: z.string().email(),
    name:  z.string().min(1),
  })),
  response: z.object({ id: z.string(), email: z.string() }),
  // password NOT listed → auto-stripped before response
})

router.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  // req.body typed. async errors caught. sensitive fields stripped.
  const user = await UserService.create(req.body)
  res.created({ data: user, message: 'User created' })
}))`

function BeforeAfter() {
  return (
    <section className="before-after-section">
      <div className="section-container">
        <h2 className="section-title">Before and after</h2>
        <p className="section-subtitle">
          The same user creation endpoint — without and with shapeguard.
        </p>
        <div className="code-grid">
          <div>
            <div className="code-col-label col-before">
              <span>✕</span> Without shapeguard
            </div>
            <CodeBlock language="ts">{BEFORE}</CodeBlock>
          </div>
          <div>
            <div className="code-col-label col-after">
              <span>✓</span> With shapeguard
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
  { pkg: 'express-validator',   replaced: 'defineRoute() + handle()' },
  { pkg: 'express-async-errors',replaced: 'built into handle() + asyncHandler()' },
  { pkg: 'http-errors',         replaced: 'AppError with typed factories' },
  { pkg: 'morgan',              replaced: 'shapeguard() built-in structured logging' },
  { pkg: 'express-rate-limit',  replaced: 'defineRoute({ rateLimit })' },
  { pkg: 'swagger-ui-express',  replaced: 'serveScalar() / serveSwaggerUI() — CDN' },
  { pkg: 'swagger-jsdoc',       replaced: 'generateOpenAPI() — from route definitions' },
  { pkg: 'uuid',                replaced: 'requestId built into shapeguard()' },
  { pkg: 'supertest mocks',     replaced: 'mockRequest / mockResponse / mockNext' },
]

function PackagesReplaced() {
  return (
    <section className="packages-section">
      <div className="section-container">
        <h2 className="section-title">What it replaces</h2>
        <p className="section-subtitle">
          Every package below is one you no longer need to install, configure, or maintain.
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
          9 packages → 1 &nbsp;·&nbsp; Zero required runtime dependencies &nbsp;·&nbsp; ~12KB minzipped
        </p>
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
    title: 'Typed validation — all errors at once',
    desc:  'Zod schemas validate body, params, query, and headers. All failures returned in one response — never one at a time.',
  },
  {
    icon: '🔒',
    title: 'Automatic response stripping',
    desc:  'Define the response schema. passwordHash, token, and any unlisted field are removed before the response is sent.',
  },
  {
    icon: '🚨',
    title: 'Consistent error shape — always',
    desc:  'Every error — validation, 404, thrown AppError, uncaught crash — produces the exact same JSON structure.',
  },
  {
    icon: '📋',
    title: 'Structured logging — zero config',
    desc:  'Auto-selects pino → winston → built-in fallback. Dev: color-coded. Prod: JSON for Datadog / CloudWatch / Loki.',
  },
  {
    icon: '📖',
    title: 'OpenAPI + three UI choices',
    desc:  'generateOpenAPI() reads your route definitions. Serve Scalar, Swagger UI, or Redoc — all CDN-loaded, zero install.',
  },
  {
    icon: '🔗',
    title: 'Webhook verification',
    desc:  'Stripe, GitHub, Shopify, Svix, Twilio, or custom HMAC — one line, timingSafeEqual, replay attack protection.',
  },
  {
    icon: '⚡',
    title: 'Rate limiting — no extra package',
    desc:  'Per-route rate limiting with a synchronous in-memory store. Pass a Redis store for distributed deployments.',
  },
  {
    icon: '🧪',
    title: 'Test helpers — no HTTP server',
    desc:  'mockRequest(), mockResponse(), mockNext() — test controllers in pure Node, no Express app, no ports.',
  },
  {
    icon: '🔌',
    title: 'Every feature is standalone',
    desc:  'Use only what you need. Add logging today, validation tomorrow. Nothing forces you to adopt everything at once.',
  },
]

function Features() {
  return (
    <section className="features-section">
      <div className="section-container">
        <h2 className="section-title">What you get</h2>
        <p className="section-subtitle">
          Every feature is production-tested, security-hardened, and works independently.
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
  shapeguard, defineRoute, handle,
  createDTO, AppError, errorHandler, notFoundHandler,
} from 'shapeguard'

const app = express()
app.use(express.json())
app.use(shapeguard())       // logging + requestId + security guards
app.use(notFoundHandler())  // 404 for unmatched routes
app.use(errorHandler())     // catches everything thrown anywhere

const CreateUserRoute = defineRoute({
  body: createDTO(z.object({
    email:    z.string().email(),
    name:     z.string().min(1).max(100),
    password: z.string().min(8),
  })),
  response: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  // password NOT in response → automatically stripped
})

app.post('/users', ...handle(CreateUserRoute, async (req, res) => {
  const user = await UserService.create(req.body) // typed, async errors caught
  res.created({ data: user, message: 'User created' })
}))

app.listen(3000)
// → validation, logging, errors, response stripping — all working`

function QuickStart() {
  return (
    <section className="quickstart-section">
      <div className="quickstart-inner">
        <h2 className="section-title">Full setup in one file</h2>
        <p className="section-subtitle">
          Mount shapeguard once. Every route gets validation, logging,
          error handling, and response stripping automatically.
        </p>
        <CodeBlock language="ts" title="app.ts">{QUICK_START}</CodeBlock>
        <div className="quickstart-cta">
          <Link className="button button--primary button--lg" to="/docs/quick-start">
            Full quick start guide →
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
export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext()
  return (
    <Layout
      title={`${siteConfig.title} — Express middleware library`}
      description="One package that replaces nine. Typed validation, structured logging, error handling, and API docs for Express — zero runtime dependencies."
    >
      <Hero />
      <Stats />
      <main>
        <BeforeAfter />
        <PackagesReplaced />
        <Features />
        <QuickStart />
      </main>
    </Layout>
  )
}

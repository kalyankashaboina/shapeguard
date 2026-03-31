// ─────────────────────────────────────────────────────────────────────────────
// examples/with-webhook — shapeguard v0.8.x
//
// Shows verifyWebhook() — HMAC signature verification middleware.
// Zero dependencies — uses Node.js built-in crypto.timingSafeEqual().
//
// Supports: Stripe, GitHub, Shopify, Twilio, Svix, and custom providers.
//
// Run:  npx tsx src/index.ts
//
// Test with a valid Stripe signature:
//   curl -X POST http://localhost:3000/webhooks/stripe \
//     -H "Content-Type: application/json" \
//     -H "stripe-signature: t=1234567890,v1=INVALID" \
//     -d '{"type":"payment_intent.succeeded"}'
//   → 401 WEBHOOK_SIGNATURE_INVALID
//
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express'
import { createHmac } from 'crypto'
import {
  shapeguard,
  verifyWebhook,
  AppError,
  notFoundHandler,
  errorHandler,
} from 'shapeguard'

const app = express()
app.use(shapeguard({ logger: { silent: process.env['NODE_ENV'] === 'test' } }))

// ── Stripe webhook ─────────────────────────────────────────────────────────────
// Stripe signs the raw body with the webhook secret and includes a timestamp
// for replay attack prevention. verifyWebhook() handles all of this.
//
// Required setup:
//   1. Set STRIPE_WEBHOOK_SECRET env var (from Stripe Dashboard → Webhooks)
//   2. Use express.raw() to capture the raw body — required for HMAC to work
//
app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    provider: 'stripe',
    secret:   process.env['STRIPE_WEBHOOK_SECRET'] ?? 'dev_test_secret',
    // onSuccess: record idempotency key to prevent duplicate processing
    onSuccess: (req) => {
      console.log(`✅ Stripe: signature OK`)
    },
    onFailure: (req, reason) => {
      console.warn(`❌ Stripe: ${reason}`)
    },
  }),
  (req, res) => {
    const event = JSON.parse(req.body.toString())
    console.log(`Processing Stripe event: ${event.type ?? 'unknown'}`)
    // Handle event types:
    // if (event.type === 'payment_intent.succeeded') { ... }
    // if (event.type === 'customer.subscription.deleted') { ... }
    res.json({ received: true })
  }
)

// ── GitHub webhook ─────────────────────────────────────────────────────────────
// GitHub signs with SHA-256 HMAC and includes the signature as:
// X-Hub-Signature-256: sha256=<hex>
//
app.post('/webhooks/github',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    provider: 'github',
    secret:   process.env['GITHUB_WEBHOOK_SECRET'] ?? 'dev_test_secret',
  }),
  (req, res) => {
    const payload = JSON.parse(req.body.toString())
    const event   = req.headers['x-github-event'] as string
    console.log(`GitHub ${event}: ${payload.action ?? '-'} on ${payload.repository?.name ?? '-'}`)
    res.json({ received: true })
  }
)

// ── Shopify webhook ────────────────────────────────────────────────────────────
// Shopify uses base64-encoded SHA-256 HMAC in X-Shopify-Hmac-SHA256 header.
//
app.post('/webhooks/shopify',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    provider: 'shopify',
    secret:   process.env['SHOPIFY_WEBHOOK_SECRET'] ?? 'dev_test_secret',
  }),
  (req, res) => {
    const payload = JSON.parse(req.body.toString())
    const topic   = req.headers['x-shopify-topic'] as string
    console.log(`Shopify ${topic}: order ${payload.id ?? '-'}`)
    res.json({ received: true })
  }
)

// ── Custom provider ────────────────────────────────────────────────────────────
// Full control over algorithm, header name, prefix, encoding, and timing window.
//
app.post('/webhooks/custom',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    secret:        process.env['CUSTOM_WEBHOOK_SECRET'] ?? 'dev_test_secret',
    algorithm:     'sha256',
    headerName:    'x-my-signature',
    prefix:        'sha256=',
    encoding:      'hex',
    toleranceSecs: 300,           // reject events older than 5 minutes
    onFailure: (req, reason) => {
      console.warn(`Custom webhook rejected: ${reason}`)
    },
  }),
  (req, res) => {
    const payload = JSON.parse(req.body.toString())
    console.log('Custom webhook received:', payload)
    res.json({ received: true })
  }
)

// ── Health + demo ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.ok({ data: { status: 'ok' } })
})

// Demo: generate a valid signature so you can test the endpoint
app.get('/demo/signature', (req, res) => {
  const secret  = 'dev_test_secret'
  const body    = JSON.stringify({ type: 'demo.event', data: { id: '123' } })
  const hmac    = createHmac('sha256', secret).update(body).digest('hex')
  const header  = `sha256=${hmac}`

  res.ok({
    data: {
      body,
      header,
      curl: `curl -X POST http://localhost:3000/webhooks/custom ` +
            `-H "Content-Type: application/json" ` +
            `-H "x-my-signature: ${header}" ` +
            `-d '${body}'`,
    },
    message: 'Use this signature to test /webhooks/custom',
  })
})

app.use(notFoundHandler())
app.use(errorHandler({ debug: true }))

app.listen(3000, () => {
  console.log('')
  console.log('shapeguard with-webhook example')
  console.log('─'.repeat(40))
  console.log('POST /webhooks/stripe   — Stripe HMAC + replay protection')
  console.log('POST /webhooks/github   — GitHub HMAC')
  console.log('POST /webhooks/shopify  — Shopify base64 HMAC')
  console.log('POST /webhooks/custom   — custom provider')
  console.log('GET  /demo/signature    — generate a valid test signature')
  console.log('')
  console.log('All endpoints require a valid HMAC signature.')
  console.log('Missing or invalid signature → 400/401 with error code.')
  console.log('')
})

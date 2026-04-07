---
title: Webhook verification
description: How to verify HMAC signatures from Stripe, GitHub, Shopify, and custom providers with shapeguard.
---

# Webhook verification

shapeguard includes `verifyWebhook()` — HMAC signature verification for common providers.

## Why this matters

- Uses `timingSafeEqual` to prevent timing attacks
- Stripe: validates timestamp tolerance (300 second window) to prevent replay attacks
- All: fails fast with a clear `401 WEBHOOK_SIGNATURE_INVALID` response

## Stripe

```ts
app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),  // ← raw body required for HMAC
  verifyWebhook({ provider: 'stripe', secret: process.env.STRIPE_WEBHOOK_SECRET! }),
  (req, res) => {
    const event = JSON.parse(req.body.toString())
    // Signature verified. Handle event.type here.
    res.json({ received: true })
  }
)
```

## GitHub

```ts
app.post('/webhooks/github',
  express.raw({ type: 'application/json' }),
  verifyWebhook({ provider: 'github', secret: process.env.GITHUB_WEBHOOK_SECRET! }),
  (req, res) => {
    const payload = JSON.parse(req.body.toString())
    const event   = req.headers['x-github-event']
    res.json({ received: true })
  }
)
```

## Custom provider

```ts
app.post('/webhooks/custom',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    secret:        process.env.CUSTOM_SECRET!,
    algorithm:     'sha256',
    headerName:    'x-my-signature',
    prefix:        'sha256=',
    encoding:      'hex',
    toleranceSecs: 300,
  }),
  handler
)
```

## Providers supported

| Provider | Header | Algorithm |
|---|---|---|
| `stripe` | `stripe-signature` | sha256 HMAC + timestamp |
| `github` | `x-hub-signature-256` | sha256 HMAC |
| `shopify` | `x-shopify-hmac-sha256` | sha256 HMAC (base64) |
| `twilio` | `x-twilio-signature` | sha1 HMAC |
| `svix` | `svix-signature` | sha256 HMAC |
| custom | configurable | configurable |

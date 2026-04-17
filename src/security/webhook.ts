// ─────────────────────────────────────────────
// security/webhook.ts — shapeguard
// HMAC webhook signature verification middleware.
// Zero deps — uses Node.js crypto.timingSafeEqual() — prevents timing attacks.
//
// Usage:
//   router.post('/webhooks/stripe',
//     verifyWebhook({ provider: 'stripe', secret: process.env.STRIPE_SECRET! }),
//     handler,
//   )
// ─────────────────────────────────────────────

import { createHmac, timingSafeEqual, createHash } from 'crypto'
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { AppError } from '../errors/AppError.js'

type BuiltinProvider = 'stripe' | 'github' | 'shopify' | 'twilio' | 'svix'
// Delivery-ID deduplication store — for providers that don't use timestamps (e.g. GitHub).
// Pluggable so users can back it with Redis for multi-instance deployments.
export interface DeliveryDeduplicator {
  /** Returns true if this delivery ID has been seen before */
  has(id: string): boolean | Promise<boolean>
  /** Record this delivery ID as seen (with optional TTL in seconds) */
  add(id: string, ttlSecs?: number): void | Promise<void>
}

/** Simple in-memory deduplicator — suitable for single-process deployments */
export function inMemoryDeduplicator(maxSize = 10_000): DeliveryDeduplicator {
  const seen = new Map<string, number>()  // id → expiry timestamp (ms)
  return {
    has(id: string): boolean {
      const expiry = seen.get(id)
      if (expiry === undefined) return false
      if (Date.now() > expiry) { seen.delete(id); return false }
      return true
    },
    add(id: string, ttlSecs = 3600): void {
      // Evict oldest entries when map grows too large
      if (seen.size >= maxSize) {
        const now = Date.now()
        for (const [k, exp] of seen) {
          if (now > exp) seen.delete(k)
          if (seen.size < maxSize) break
        }
      }
      seen.set(id, Date.now() + ttlSecs * 1000)
    },
  }
}

interface ProviderPreset {
  algorithm:        string
  headerName:       string
  prefix?:          string
  encoding?:        'hex' | 'base64'
  timestampField?:  string
  separateTimestampHeader?: boolean
  payloadTemplate?: (body: string, ts: string) => string
  toleranceSecs?:   number
  /** Header containing a unique delivery ID for deduplication (e.g. GitHub) */
  deliveryHeader?:  string
}

const PRESETS: Record<BuiltinProvider, ProviderPreset> = {
  stripe: {
    algorithm:       'sha256',
    headerName:      'stripe-signature',
    prefix:          'v1=',
    encoding:        'hex',
    timestampField:  't',
    payloadTemplate: (body, ts) => `${ts}.${body}`,
    toleranceSecs:   300,
  },
  github: {
    algorithm:       'sha256',
    headerName:      'x-hub-signature-256',
    prefix:          'sha256=',
    encoding:        'hex',
    // GitHub sends x-github-delivery — a UUID per delivery.
    // No timestamp → replay prevention via delivery-ID deduplication instead.
    deliveryHeader:  'x-github-delivery',
  },
  shopify: {
    algorithm:  'sha256',
    headerName: 'x-shopify-hmac-sha256',
    encoding:   'base64',
  },
  twilio: {
    algorithm:  'sha1',
    headerName: 'x-twilio-signature',
    encoding:   'base64',
  },
  svix: {
    algorithm:                'sha256',
    headerName:               'svix-signature',
    prefix:                   'v1,',
    encoding:                 'hex',
    timestampField:           'svix-timestamp',
    separateTimestampHeader:  true,
    payloadTemplate:          (body, ts) => `${ts}.${body}`,
    toleranceSecs:            300,
  },
}

export interface WebhookConfig {
  provider?:       BuiltinProvider
  secret:          string
  algorithm?:      string
  headerName?:     string
  prefix?:         string
  encoding?:       'hex' | 'base64'
  toleranceSecs?:  number
  /**
   * Maximum allowed raw body size in bytes before signature verification.
   * Prevents memory exhaustion when express.raw() is configured without a limit.
   * Default: 1_048_576 (1 MB). Set to 0 to disable the check.
   */
  maxBodyBytes?:   number
  /**
   * Delivery-ID deduplication — prevents replay attacks for providers
   * that don't use timestamps (GitHub sends x-github-delivery UUID).
   * Pass inMemoryDeduplicator() for single-process, or a Redis-backed
   * implementation for multi-instance deployments.
   *
   * @example
   * import { verifyWebhook, inMemoryDeduplicator } from 'shapeguard'
   * const dedup = inMemoryDeduplicator()
   * app.post('/wh/github', express.raw({ type: 'application/json' }),
   *   verifyWebhook({ provider: 'github', secret, dedup }),
   *   handler)
   */
  dedup?:          DeliveryDeduplicator
  onSuccess?:      (req: Request) => void | Promise<void>
  onFailure?:      (req: Request, reason: string) => void | Promise<void>
}

export function verifyWebhook(config: WebhookConfig): RequestHandler {
  const preset     = config.provider ? PRESETS[config.provider] : undefined
  const algorithm  = config.algorithm  ?? preset?.algorithm  ?? 'sha256'
  const headerName = (config.headerName ?? preset?.headerName ?? 'x-signature').toLowerCase()
  const prefix     = config.prefix     ?? preset?.prefix     ?? ''
  const encoding   = config.encoding   ?? preset?.encoding   ?? 'hex'
  const tolerance  = config.toleranceSecs ?? preset?.toleranceSecs ?? 300

  const maxBodyBytes = config.maxBodyBytes ?? 1_048_576  // 1 MB default

  return async function webhookVerifier(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      // Get raw body — works with express.raw(), express.json(), or text bodies
      let rawBody: string
      if (Buffer.isBuffer(req.body)) {
        if (maxBodyBytes > 0 && req.body.length > maxBodyBytes) {
          throw new AppError('WEBHOOK_BODY_TOO_LARGE',
            `Webhook body exceeds ${maxBodyBytes} bytes`, 413)
        }
        rawBody = req.body.toString('utf8')
      }
      else if (typeof req.body === 'string') rawBody = req.body
      else if (req.body !== undefined) rawBody = JSON.stringify(req.body)
      else                             rawBody = ''

      const sigHeader = req.headers[headerName] as string | undefined
      if (!sigHeader) {
        await config.onFailure?.(req, `Missing header: ${headerName}`)
        throw AppError.custom('WEBHOOK_SIGNATURE_MISSING', `Webhook header '${headerName}' is required`, 400)
      }

      let signatureToVerify = sigHeader
      let payloadToSign     = rawBody

      // Handle compound timestamp headers (Stripe, Svix)
      if (preset?.timestampField) {
        let timestamp: string | undefined

        if (preset.separateTimestampHeader) {
          // Svix: timestamp in separate header, sig in "v1,sig"
          timestamp = req.headers[preset.timestampField] as string | undefined
          signatureToVerify = sigHeader.startsWith('v1,') ? sigHeader.slice(3) : sigHeader
        } else {
          // Stripe: "t=timestamp,v1=sig"
          const map: Record<string, string> = {}
          sigHeader.split(',').forEach(part => {
            const idx = part.indexOf('=')
            if (idx > 0) map[part.slice(0, idx)] = part.slice(idx + 1)
          })
          timestamp = map[preset.timestampField]
          signatureToVerify = map['v1'] ?? sigHeader
        }

        if (!timestamp) {
          await config.onFailure?.(req, 'Missing timestamp in webhook signature')
          throw AppError.custom('WEBHOOK_TIMESTAMP_MISSING', 'Webhook signature is missing required timestamp', 400)
        }

        if (tolerance > 0) {
          const ts  = parseInt(timestamp, 10)
          const now = Math.floor(Date.now() / 1000)
          if (isNaN(ts) || Math.abs(now - ts) > tolerance) {
            await config.onFailure?.(req, `Timestamp out of tolerance: ${timestamp}`)
            throw AppError.custom('WEBHOOK_TIMESTAMP_EXPIRED',
              `Webhook timestamp outside ${tolerance}s window — possible replay attack`, 400)
          }
        }

        if (preset.payloadTemplate) {
          payloadToSign = preset.payloadTemplate(rawBody, timestamp)
        }
      }

      // Compute expected HMAC
      const expectedHex = createHmac(algorithm, config.secret)
        .update(payloadToSign, 'utf8')
        .digest('hex')

      // Normalise received signature to hex
      let receivedSig = signatureToVerify
      if (prefix && receivedSig.startsWith(prefix)) receivedSig = receivedSig.slice(prefix.length)
      let receivedHex = receivedSig
      if (encoding === 'base64') {
        try { receivedHex = Buffer.from(receivedSig, 'base64').toString('hex') }
        catch { receivedHex = receivedSig }
      }

      // Timing-safe comparison — hash both to equal length before comparing
      const a = createHash('sha256').update(expectedHex).digest()
      const b = createHash('sha256').update(receivedHex).digest()

      if (!timingSafeEqual(a, b)) {
        await config.onFailure?.(req, 'HMAC mismatch')
        throw AppError.custom('WEBHOOK_SIGNATURE_INVALID',
          'Webhook signature verification failed — payload may have been tampered with', 401)
      }

      // Delivery-ID deduplication — check AFTER signature passes to avoid
      // enumeration attacks (attacker can't learn valid delivery IDs via errors).
      if (config.dedup) {
        const deliveryHeader = (preset as unknown as { deliveryHeader?: string } | undefined)?.deliveryHeader
        const deliveryId     = deliveryHeader ? (req.headers[deliveryHeader] as string | undefined) : undefined
        if (deliveryId) {
          const alreadySeen = await Promise.resolve(config.dedup.has(deliveryId))
          if (alreadySeen) {
            await config.onFailure?.(req, `Duplicate delivery ID: ${deliveryId}`)
            throw AppError.custom(
              'WEBHOOK_DELIVERY_DUPLICATE',
              'Webhook delivery already processed — possible replay attack',
              400,
            )
          }
          await Promise.resolve(config.dedup.add(deliveryId))
        }
      }

      await config.onSuccess?.(req)
      next()
    } catch (err) {
      next(err)
    }
  }
}

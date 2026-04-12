// ─────────────────────────────────────────────
// examples/production-setup — shapeguard
// Demonstrates all production-readiness features:
//   • healthCheck() for k8s liveness/readiness probes
//   • gracefulShutdown() for zero-downtime deploys
//   • Per-route timeout to protect against slow handlers
//   • GitHub webhook with delivery deduplication
// ─────────────────────────────────────────────

import express from 'express'
import { z } from 'zod'
import {
  shapeguard, defineRoute, handle, createDTO,
  AppError, errorHandler, notFoundHandler,
  healthCheck, gracefulShutdown, logger,
  verifyWebhook, inMemoryDeduplicator,
} from 'shapeguard'

const app    = express()
const router = express.Router()
app.use(express.json())
app.use(shapeguard({ logger: { level: 'info' } }))

// ── Health check ──────────────────────────────────────────────────────────────
// Returns 200 when all checks pass, 503 if any fail.
// Kubernetes liveness probe: GET /health
// Kubernetes readiness probe: GET /health/ready
app.use('/health', healthCheck({
  checks: {
    mem: healthCheck.memory({ maxPercent: 90 }),
    env: healthCheck.env(['NODE_ENV']),
  },
  timeout: 3_000,
}))

// ── Route with per-route timeout ──────────────────────────────────────────────
const SlowResourceDTO = createDTO(z.object({ delay: z.number().max(60_000) }))

const SlowRoute = defineRoute({
  body:    SlowResourceDTO,
  timeout: 5_000,  // abort with 408 if handler takes > 5s
})

router.post('/slow', ...handle(SlowRoute, async (req, res) => {
  await new Promise(r => setTimeout(r, req.body.delay))
  res.ok({ data: { done: true }, message: 'Completed' })
}))

// ── GitHub webhook with delivery deduplication ────────────────────────────────
// Prevents replayed deliveries from being processed twice.
const githubDedup = inMemoryDeduplicator()

app.post('/webhooks/github',
  express.raw({ type: 'application/json' }),
  verifyWebhook({
    provider: 'github',
    secret:   process.env['GITHUB_WEBHOOK_SECRET'] ?? 'dev-secret',
    dedup:    githubDedup,
  }),
  (req, res) => {
    const event = req.headers['x-github-event'] ?? 'unknown'
    logger.info({ event }, 'GitHub webhook received')
    res.json({ ok: true })
  }
)

// ── Standard routes ───────────────────────────────────────────────────────────
const PingResponse = z.object({ pong: z.boolean(), uptime: z.number() })

router.get('/ping', ...handle(
  defineRoute({ response: PingResponse }),
  (_req, res) => {
    res.ok({ data: { pong: true, uptime: Math.round(process.uptime()) } })
  }
))

app.use('/api/v1', router)
app.use(notFoundHandler())
app.use(errorHandler())

// ── Server start + graceful shutdown ─────────────────────────────────────────
const PORT   = Number(process.env['PORT']) || 3000
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server started')
  logger.info({ url: `http://localhost:${PORT}/health` }, 'Health check')
})

// Zero-downtime deploys: SIGTERM drains in-flight requests, then closes
const stopShutdown = gracefulShutdown(server, {
  drainMs:    30_000,
  onShutdown: async () => {
    logger.info({}, 'Cleanup complete')
    // await db.close()
    // await redis.quit()
  },
  onDrained: () => logger.info({}, 'All requests drained'),
  logger,
})

export { stopShutdown }

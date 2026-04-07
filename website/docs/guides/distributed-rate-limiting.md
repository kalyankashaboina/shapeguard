---
title: Distributed rate limiting
description: How to use shapeguard's rate limiting across multiple processes or Kubernetes pods using a Redis store.
---

# Distributed rate limiting

## The limitation

shapeguard's built-in rate limiter uses an **in-memory Map per route**. This works correctly for single-process deployments.

In multi-process deployments (PM2 cluster, Kubernetes), each process has its own counter. With 5 pods and `max: 100`, a client can make 500 requests in the window.

## The fix — Redis store

Pass a `store` to `rateLimit` that uses Redis atomic operations:

```ts
import { createClient } from 'redis'
import { defineRoute } from 'shapeguard'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

// Build a Redis-backed store
const redisStore = {
  async get(key: string) {
    const data = await redis.get(`rl:${key}`)
    return data ? JSON.parse(data) : null
  },
  async set(key: string, value: { count: number; reset: number }) {
    const ttlMs = value.reset - Date.now()
    if (ttlMs > 0) {
      await redis.set(`rl:${key}`, JSON.stringify(value), { PX: ttlMs })
    }
  },
}

// Use it per-route
const ProtectedRoute = defineRoute({
  rateLimit: {
    windowMs: 60_000,
    max:      100,
    store:    redisStore,  // ← distributed, works across all pods
  },
})
```

## Trust proxy

If you run behind a load balancer, the default rate limit key (IP + path) uses `x-forwarded-for`. This header is spoofable without Express's trust proxy setting:

```ts
app.set('trust proxy', 1)  // Must be set before shapeguard()
app.use(shapeguard())
```

Without this, clients can bypass rate limiting by sending a fake `X-Forwarded-For` header.

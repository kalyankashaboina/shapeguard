// ─────────────────────────────────────────────
// core/sse.ts — shapeguard
// Server-Sent Events (SSE) helper.
// Structured, typed streaming for real-time data without WebSockets.
//
// Usage:
//   app.get('/events', (req, res) => {
//     const stream = sseStream(res)
//     stream.send({ type: 'update', data: { count: 42 } })
//     stream.send({ type: 'heartbeat' })
//     req.on('close', () => stream.close())
//   })
// ─────────────────────────────────────────────

import type { Response, Request, RequestHandler } from 'express'

export interface SSEEvent<T = unknown> {
  /** Event type — clients listen with `source.addEventListener(type, handler)` */
  type?:  string
  /** Data payload — serialized to JSON automatically */
  data:   T
  /** Optional event ID for reconnection resumption */
  id?:    string
  /** Retry hint in milliseconds */
  retry?: number
}

export interface SSEStream<T = unknown> {
  /**
   * Send an event to the client.
   * @example
   * stream.send({ type: 'user.created', data: { id: '123', name: 'Alice' } })
   */
  send(event: SSEEvent<T>): void

  /**
   * Send a comment/heartbeat — keeps the connection alive through proxies.
   * Call every 15-30 seconds to prevent idle timeouts.
   */
  heartbeat(): void

  /**
   * Close the stream and end the response.
   */
  close(): void

  /**
   * Whether the client has disconnected.
   */
  readonly closed: boolean
}

/**
 * Opens a Server-Sent Events stream on the response.
 * Sets all required SSE headers automatically.
 *
 * @example
 * app.get('/live-prices', (req, res) => {
 *   const stream = sseStream<{ symbol: string; price: number }>(res)
 *
 *   const interval = setInterval(() => {
 *     if (stream.closed) { clearInterval(interval); return }
 *     stream.send({ type: 'price', data: { symbol: 'AAPL', price: getPriceOf('AAPL') } })
 *   }, 1000)
 *
 *   // Heartbeat every 20s to keep connection alive through proxies
 *   const hb = setInterval(() => { if (!stream.closed) stream.heartbeat() }, 20_000)
 *
 *   req.on('close', () => {
 *     clearInterval(interval)
 *     clearInterval(hb)
 *   })
 * })
 */
export function sseStream<T = unknown>(res: Response): SSEStream<T> {
  let closed = false

  // Required SSE headers
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // disable nginx buffering

  // Flush headers immediately so the client sees an open connection
  if (typeof (res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as Response & { flushHeaders: () => void }).flushHeaders()
  }

  res.once('close', () => { closed = true })

  function write(chunk: string): void {
    if (closed || res.writableEnded) return
    res.write(chunk)
  }

  return {
    send(event: SSEEvent<T>): void {
      if (closed) return
      let out = ''
      if (event.id    !== undefined) out += `id: ${event.id}\n`
      if (event.retry !== undefined) out += `retry: ${event.retry}\n`
      if (event.type  !== undefined) out += `event: ${event.type}\n`
      out += `data: ${JSON.stringify(event.data)}\n\n`
      write(out)
    },

    heartbeat(): void {
      write(': heartbeat\n\n')
    },

    close(): void {
      if (!closed) {
        closed = true
        if (!res.writableEnded) res.end()
      }
    },

    get closed() { return closed },
  }
}

/**
 * Express middleware that enables SSE on a route.
 * Disables response buffering — required for events to reach the client immediately.
 *
 * @example
 * app.get('/events', enableSSE, (req, res) => {
 *   const stream = sseStream(res)
 *   ...
 * })
 */
export const enableSSE: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  next()
}

/**
 * Helper to wire SSE cleanup on client disconnect.
 * Returns a stop function — call it to close the stream when your data source ends.
 *
 * @example
 * app.get('/events', (req, res) => {
 *   const stream = sseStream(res)
 *   const stop = onClientDisconnect(req, stream, () => {
 *     clearInterval(priceInterval)
 *   })
 * })
 */
export function onClientDisconnect(
  req:     Request,
  stream:  SSEStream,
  cleanup: () => void,
): () => void {
  const handler = () => {
    if (!stream.closed) stream.close()
    cleanup()
  }
  req.once('close', handler)
  return handler
}
